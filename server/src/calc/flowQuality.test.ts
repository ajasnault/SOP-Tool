import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { capacityForMonth } from "./capacity.js";
import { serviceLevelForMonth } from "./serviceLevel.js";
import { qualitySummary } from "./quality.js";
import { flowsForMonth } from "./flow.js";

/**
 * Un produit à 2 étapes (Mélange → QC vrac → Remplissage → libération produit fini)
 * sur 2 machines du même site. 3 lots :
 * - LOT-1 : conforme partout, libéré en septembre (fin de remplissage en août) ;
 * - LOT-2 : hors spécifications au contrôle vrac → aucun OF de remplissage ;
 * - LOT-3 : conforme au vrac, rejeté à la libération produit fini.
 */
function seed() {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db"));
  db.exec(`
    INSERT INTO products (product_id, product_name, family, dosage_form, site, standard_cost_eur_per_unit)
    VALUES ('PRD-1', 'Sirop test', 'Formulation Liquide', 'Sirop', 'Site A - Lyon', 2),
           ('PRD-2', 'Autre sirop', 'Formulation Liquide', 'Sirop', 'Site A - Lyon', 1);

    INSERT INTO machines (machine_id, machine_name, machine_type, site, production_line, capacity_per_hour_units, changeover_time_hours, line_clearance_hours)
    VALUES ('MCH-MIX', 'Cuve · Lyon', 'Cuve de mélange', 'Site A - Lyon', 'Ligne Liquides', 100, 5, 1),
           ('MCH-FILL', 'Remplissage · Lyon', 'Ligne remplissage liquide', 'Site A - Lyon', 'Ligne Liquides', 10, 2, 0.5);

    INSERT INTO routings (routing_id, product_id, step_no, operation, machine_type, site, qc_point, qc_lead_time_mean_hours)
    VALUES ('R1-10', 'PRD-1', 10, 'Mélange', 'Cuve de mélange', 'Site A - Lyon', 'Contrôle en cours (vrac)', 24),
           ('R1-20', 'PRD-1', 20, 'Remplissage', 'Ligne remplissage liquide', 'Site A - Lyon', 'Libération produit fini', 168),
           ('R2-10', 'PRD-2', 10, 'Mélange', 'Cuve de mélange', 'Site A - Lyon', 'Contrôle en cours (vrac)', 24),
           ('R2-20', 'PRD-2', 20, 'Remplissage', 'Ligne remplissage liquide', 'Site A - Lyon', 'Libération produit fini', 168);

    INSERT INTO production_orders (order_id, lot_id, product_id, step_no, machine_id, planned_start, planned_end, batch_qty_units, status)
    VALUES ('OF-1', 'LOT-1', 'PRD-1', 10, 'MCH-MIX', '2026-08-01 00:00', '2026-08-01 10:00', 1000, 'Terminé'),
           ('OF-2', 'LOT-2', 'PRD-1', 10, 'MCH-MIX', '2026-08-01 10:00', '2026-08-01 20:00', 1000, 'Terminé'),
           ('OF-3', 'LOT-3', 'PRD-1', 10, 'MCH-MIX', '2026-08-01 20:00', '2026-08-02 06:00', 1000, 'Terminé'),
           ('OF-4', 'LOT-4', 'PRD-2', 10, 'MCH-MIX', '2026-08-02 06:00', '2026-08-02 16:00', 1000, 'Terminé'),
           ('OF-5', 'LOT-1', 'PRD-1', 20, 'MCH-FILL', '2026-08-03 00:00', '2026-08-07 04:00', 1000, 'Terminé'),
           ('OF-6', 'LOT-3', 'PRD-1', 20, 'MCH-FILL', '2026-08-08 00:00', '2026-08-12 04:00', 1000, 'Terminé');

    INSERT INTO quality_results (qc_id, lot_id, product_id, step_no, qc_point, sample_date, release_date, measured_value, spec_lower, spec_upper, result)
    VALUES ('QC-1', 'LOT-1', 'PRD-1', 10, 'Contrôle en cours (vrac)', '2026-08-01 10:00', '2026-08-02 10:00', 100.2, 95, 105, 'Conforme'),
           ('QC-2', 'LOT-2', 'PRD-1', 10, 'Contrôle en cours (vrac)', '2026-08-01 20:00', '2026-08-02 20:00', 106.1, 95, 105, 'Hors spécifications'),
           ('QC-3', 'LOT-3', 'PRD-1', 10, 'Contrôle en cours (vrac)', '2026-08-02 06:00', '2026-08-03 06:00', 99.0, 95, 105, 'Conforme'),
           ('QC-4', 'LOT-1', 'PRD-1', 20, 'Libération produit fini', '2026-08-07 04:00', '2026-09-02 04:00', 100.5, 95, 105, 'Conforme'),
           ('QC-5', 'LOT-3', 'PRD-1', 20, 'Libération produit fini', '2026-08-12 04:00', '2026-09-03 04:00', 94.2, 95, 105, 'Hors spécifications');

    INSERT INTO forecasts (product_id, month, market, forecast_qty_units) VALUES ('PRD-1', '2026-09', 'France', 3000);
  `);
  return db;
}

test("capacité : changement de série au changement de produit, vide de ligne entre lots du même produit", () => {
  const db = seed();
  const mix = capacityForMonth(db, "2026-08").find((r) => r.machine_id === "MCH-MIX")!;
  // 4 lots × 1000 / 100 u/h = 40 h ; 2 changements de série (début PRD-1, passage à PRD-2) × 5 h = 10 h ;
  // 2 vides de ligne (LOT-2 et LOT-3 après un lot du même produit) × 1 h = 2 h.
  assert.equal(mix.planned_hours, 52);
  assert.equal(mix.machine_type, "Cuve de mélange");
});

test("taux de service : seule la dernière étape produit du fini, au mois de libération QC, hors lots rejetés", () => {
  const db = seed();
  const sep = serviceLevelForMonth(db, "2026-09");
  // Demande 3000. LOT-2 (rejeté au vrac) n'a pas de remplissage, LOT-3 est rejeté
  // à la libération : seul LOT-1 (1000) est disponible, en septembre (pas en août,
  // mois de fin de l'OF de remplissage).
  assert.equal(sep.demand_units, 3000);
  assert.equal(sep.covered_units, 1000);
  assert.equal(serviceLevelForMonth(db, "2026-08").covered_units, 0);
});

test("taux de service : un plan sans gamme (un OF = un lot fini) garde l'ancien calcul", () => {
  const db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db"));
  db.exec(`
    INSERT INTO products (product_id, product_name, site) VALUES ('PRD-1', 'Produit', 'Site A - Lyon');
    INSERT INTO machines (machine_id, machine_name) VALUES ('MCH-1', 'Machine');
    INSERT INTO production_orders (order_id, product_id, machine_id, planned_start, planned_end, batch_qty_units)
    VALUES ('OF-1', 'PRD-1', 'MCH-1', '2026-09-01 00:00', '2026-09-02 00:00', 400),
           ('OF-2', 'PRD-1', 'MCH-1', '2026-09-03 00:00', '2026-09-04 00:00', 400);
    INSERT INTO forecasts (product_id, month, market, forecast_qty_units) VALUES ('PRD-1', '2026-09', 'France', 1000);
  `);
  assert.equal(serviceLevelForMonth(db, "2026-09").covered_units, 800);
});

test("qualité : taux de rejet par point de contrôle, valeur perdue, délai prévu pondéré par lot", () => {
  const db = seed();
  const q = qualitySummary(db, "2026-09");
  assert.deepEqual(q.windowMonths, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(q.controlled, 5);
  assert.equal(q.rejected, 2);
  assert.equal(q.rejection_rate_pct, 40);
  assert.equal(q.rejected_units, 2000);
  assert.equal(q.rejected_value_eur, 4000);

  const vrac = q.byQcPoint.find((p) => p.qc_point === "Contrôle en cours (vrac)")!;
  assert.equal(vrac.controlled, 3);
  assert.equal(vrac.rejected, 1);
  assert.equal(vrac.avg_lead_time_hours, 24);
  assert.equal(vrac.planned_lead_time_hours, 24);

  assert.equal(q.rejectedLots[0].lot_id, "LOT-3", "plus récent d'abord");
  assert.equal(q.rejectedLots[1].measured_value, 106.1);

  // Fenêtre sans aucun résultat décidé : vide, mais hasData reste vrai.
  const later = qualitySummary(db, "2027-06");
  assert.equal(later.hasData, true);
  assert.equal(later.controlled, 0);
  assert.equal(later.rejection_rate_pct, null);
});

test("flux : étapes dans l'ordre de la gamme, goulot = étape la plus chargée", () => {
  const db = seed();
  const capacity = capacityForMonth(db, "2026-08");
  const flows = flowsForMonth(db, capacity);
  assert.equal(flows.length, 1, "PRD-1 et PRD-2 suivent la même gamme : un seul flux");
  const [flow] = flows;
  assert.equal(flow.product_count, 2);
  assert.deepEqual(
    flow.steps.map((s) => s.machine_type),
    ["Cuve de mélange", "Ligne remplissage liquide"]
  );
  // Remplissage : 2 lots × 1000 / 10 u/h + 1 changement de série + 1 vide de ligne = 202,5 h, bien au-dessus de la cuve (52 h).
  assert.equal(flow.bottleneck_step_no, 20);
  assert.equal(flow.steps[1].qc_point, "Libération produit fini");
});
