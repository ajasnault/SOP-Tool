import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { buildReconciliationContext } from "./reconciliation.js";
import { computeResultingGaps, type ReconciliationAction } from "./reconciliationRecalc.js";

const CYCLE = "2026-08"; // frozen_period_weeks défaut 8 -> frozenPeriodEndMonth ~ 2026-10 ; chartHorizon 2026-08..2027-01 (18 mois)

function monthPlus(month: string, n: number): string {
  let [y, m] = month.split("-").map(Number);
  m += n;
  while (m > 12) {
    m -= 12;
    y++;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function freshDb() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sop-reconciliation-test-")), "test.db");
  const db = openDb(dbPath);
  db.exec(`
    INSERT INTO products (product_id, product_name, family, standard_cost_eur_per_unit, site)
    VALUES ('PRD-1', 'Produit surchargé', 'Famille A', 12.5, 'Site A - Lyon');

    -- Ligne chroniquement en surcharge : 2 machines, chargées à bloc sur tout l'horizon
    INSERT INTO machines (machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours)
    VALUES ('MCH-OVER-1', 'Machine surcharge 1', 'Site A - Lyon', 'Ligne Surcharge', 10, 0);

    -- Ligne chroniquement sous-utilisée : aucune commande sur tout l'horizon
    INSERT INTO machines (machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours)
    VALUES ('MCH-UNDER-1', 'Machine sous-util 1', 'Site A - Lyon', 'Ligne Creuse', 10, 0);

    -- Machine dédiée au test de lissage temporel : gap sur le mois cycle, capacité libre au mois +3
    INSERT INTO machines (machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours)
    VALUES ('MCH-SHIFT-1', 'Machine lissage', 'Site A - Lyon', 'Ligne Lissage', 10, 0);
  `);

  // 18 mois de charge lourde sur MCH-OVER-1 (chronic surcharge attendu)
  const insertOrder = db.prepare(
    `INSERT INTO production_orders (order_id, product_id, machine_id, planned_start, planned_end, batch_qty_units, status)
     VALUES (?, 'PRD-1', ?, ?, ?, 7000, 'Planifié')`
  );
  for (let i = 0; i < 18; i++) {
    const month = monthPlus(CYCLE, i);
    insertOrder.run(`OF-OVER-${i}`, "MCH-OVER-1", `${month}-01 00:00`, `${month}-02 00:00`);
  }

  // Gap au mois cycle+3 sur MCH-SHIFT-1 (charge lourde), rien au mois cycle+6 (capacité libre pour absorber).
  // cycle+3 doit être hors période gelée (défaut 8 semaines ≈ 2 mois) pour apparaître dans capacityGaps.
  const shiftSourceMonth = monthPlus(CYCLE, 3);
  insertOrder.run("OF-SHIFT-SOURCE", "MCH-SHIFT-1", `${shiftSourceMonth}-01 00:00`, `${shiftSourceMonth}-02 00:00`);

  // Choc de demande : forecast plat puis un pic sur un mois de l'horizon non gelé
  const insertForecast = db.prepare(
    `INSERT INTO forecasts (product_id, month, market, forecast_type, forecast_qty_units) VALUES ('PRD-1', ?, 'EU', 'baseline', ?)`
  );
  for (let i = -6; i < 18; i++) {
    const month = monthPlus(CYCLE, i);
    const qty = i === 5 ? 10000 : 1000; // pic net au 6e mois du chartHorizon
    insertForecast.run(month, qty);
  }

  return db;
}

test("buildReconciliationContext : périmètre limité aux mois non gelés, gaps et coûts produits cohérents", () => {
  const db = freshDb();
  const context = buildReconciliationContext(db, CYCLE);

  assert.ok(context.unfrozenMonths.length > 0 && context.unfrozenMonths.length < 18, "des mois sont exclus par la période gelée");
  assert.ok(!context.unfrozenMonths.includes(context.frozenPeriodEndMonth), "le dernier mois gelé n'est pas dans unfrozenMonths");
  assert.ok(context.capacityGaps.every((g) => context.unfrozenMonths.includes(g.month)), "aucun gap hors des mois non gelés");

  const overGap = context.capacityGaps.find((g) => g.machine_id === "MCH-OVER-1");
  assert.ok(overGap && overGap.is_gap, "MCH-OVER-1 est bien détectée en gap sur les mois non gelés");

  const overLine = context.lineUtilizationTrend.find((l) => l.production_line === "Ligne Surcharge");
  assert.equal(overLine?.chronic_pattern, "surcharge_chronique");
  const underLine = context.lineUtilizationTrend.find((l) => l.production_line === "Ligne Creuse");
  assert.equal(underLine?.chronic_pattern, "sous_utilisation_chronique");

  const cost = context.relevantProductCosts.find((p) => p.product_id === "PRD-1");
  assert.ok(cost && cost.standard_cost_eur_per_unit === 12.5, "coût standard du produit en gap remonté, non inventé");

  const shockMonths = context.demandShock.filter((m) => m.is_shock);
  assert.ok(shockMonths.length > 0, "le choc de demande est détecté sur au moins un mois");
});

test("computeResultingGaps : lissage temporel déplace uniquement l'excès, borné par la capacité cible", () => {
  const db = freshDb();
  const context = buildReconciliationContext(db, CYCLE);

  const sourceMonth = monthPlus(CYCLE, 3);
  const targetMonth = monthPlus(CYCLE, 6);
  const action: ReconciliationAction = {
    action_type: "lissage_temporel",
    machine_id: "MCH-SHIFT-1",
    from_month: sourceMonth,
    to_month: targetMonth,
    production_line: null,
    site: null,
    target_production_line: null,
    target_site: null,
    months: [],
  };

  const result = computeResultingGaps(action, context);
  assert.equal(result.applicable, true);
  assert.equal(result.entries.length, 2);
  const [from, to] = result.entries;
  assert.ok(from.after_utilization_pct !== null && from.after_utilization_pct! <= context.thresholdPct, "le mois source repasse sous le seuil");
  assert.ok(to.after_utilization_pct !== null && to.after_utilization_pct! > (to.before_utilization_pct ?? 0), "le mois cible absorbe l'excès");
  assert.equal(from.machine_id, "MCH-SHIFT-1", "machine_id porté sur l'entrée, pour le mapping précis vers la heatmap côté client");
  assert.equal(to.machine_id, "MCH-SHIFT-1");
});

test("computeResultingGaps : ouverture de ligne duplique la ligne de référence (capacité doublée)", () => {
  const db = freshDb();
  const context = buildReconciliationContext(db, CYCLE);
  const month = context.unfrozenMonths[0];

  const action: ReconciliationAction = {
    action_type: "ouverture_ligne",
    machine_id: null,
    from_month: null,
    to_month: null,
    production_line: "Ligne Surcharge",
    site: "Site A - Lyon",
    target_production_line: null,
    target_site: null,
    months: [month],
  };

  const result = computeResultingGaps(action, context);
  assert.equal(result.applicable, true);
  const entry = result.entries[0];
  assert.ok(entry.before_utilization_pct !== null && entry.after_utilization_pct !== null);
  assert.ok(entry.after_utilization_pct! < entry.before_utilization_pct!, "la duplication de capacité réduit l'utilisation");
  assert.ok(Math.abs(entry.after_utilization_pct! - entry.before_utilization_pct! / 2) < 0.01, "utilisation après ouverture ≈ moitié de l'utilisation avant");
});

test("computeResultingGaps : fermeture de ligne absorbée par la cible, peut créer un nouveau gap", () => {
  const db = freshDb();
  const context = buildReconciliationContext(db, CYCLE);
  const month = context.unfrozenMonths[0];

  const action: ReconciliationAction = {
    action_type: "fermeture_ligne",
    machine_id: null,
    from_month: null,
    to_month: null,
    production_line: "Ligne Creuse",
    site: "Site A - Lyon",
    target_production_line: "Ligne Surcharge",
    target_site: "Site A - Lyon",
    months: [month],
  };

  const result = computeResultingGaps(action, context);
  assert.equal(result.applicable, true);
  assert.equal(result.entries.length, 2);
  const [closed, target] = result.entries;
  assert.equal(closed.after_utilization_pct, 0, "la ligne fermée tombe à 0% d'utilisation");
  assert.ok(target.after_utilization_pct !== null && target.after_utilization_pct! >= (target.before_utilization_pct ?? 0), "la ligne cible absorbe la charge de la ligne fermée");
});
