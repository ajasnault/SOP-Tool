import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { computeDashboard } from "./index.js";

function seed(db: ReturnType<typeof openDb>) {
  db.exec(`
    INSERT INTO machines (machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours)
    VALUES ('MCH-1', 'Machine Lyon', 'Site A - Lyon', 'Ligne 1', 100, 1),
           ('MCH-2', 'Machine Cork', 'Site B - Cork', 'Ligne 1', 100, 1);

    INSERT INTO products (product_id, product_name, site) VALUES ('PRD-1', 'Produit test', 'Site A - Lyon');

    -- MCH-1, août 2026 : charge très forte (dépassement réel attendu)
    INSERT INTO production_orders (order_id, product_id, machine_id, planned_start, planned_end, batch_qty_units, status)
    VALUES ('OF-1', 'PRD-1', 'MCH-1', '2026-08-01 00:00', '2026-08-02 00:00', 70000, 'Planifié');

    -- MCH-2, novembre 2026 (mois différent) : charge modérée
    INSERT INTO production_orders (order_id, product_id, machine_id, planned_start, planned_end, batch_qty_units, status)
    VALUES ('OF-2', 'PRD-1', 'MCH-2', '2026-11-01 00:00', '2026-11-02 00:00', 40000, 'Planifié');
  `);
}

function freshDb() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db");
  const db = openDb(dbPath);
  seed(db);
  return db;
}

test("capacityTrend : couvre chartHorizon (18 mois) x toutes les machines, filtrable par site", () => {
  const db = freshDb();
  const dashboard = computeDashboard(db, undefined, "2026-08");

  assert.equal(dashboard.chartHorizon.length, 18);
  assert.equal(dashboard.chartHorizon[0], "2026-08");
  assert.equal(dashboard.capacityTrend.length, 18 * 2, "18 mois x 2 machines");

  const filtered = computeDashboard(db, "Site A - Lyon", "2026-08");
  assert.equal(filtered.capacityTrend.length, 18 * 1, "filtré par site : 18 mois x 1 machine");
  assert.ok(filtered.capacityTrend.every((r) => r.site === "Site A - Lyon"));
});

test("capacityTrend : révèle des pics de charge à des mois différents selon la machine", () => {
  const db = freshDb();
  const dashboard = computeDashboard(db, undefined, "2026-08");

  const mch1Aug = dashboard.capacityTrend.find((r) => r.machine_id === "MCH-1" && r.month === "2026-08");
  const mch2Nov = dashboard.capacityTrend.find((r) => r.machine_id === "MCH-2" && r.month === "2026-11");
  const mch1Nov = dashboard.capacityTrend.find((r) => r.machine_id === "MCH-1" && r.month === "2026-11");

  assert.ok(mch1Aug && mch1Aug.utilization_pct !== null && mch1Aug.utilization_pct > dashboard.thresholdPct, "MCH-1 dépasse le seuil en août");
  assert.ok(mch2Nov && mch2Nov.utilization_pct !== null && mch2Nov.utilization_pct > 0, "MCH-2 a de la charge en novembre");
  assert.ok(mch1Nov && mch1Nov.utilization_pct === 0, "MCH-1 n'a pas de charge en novembre (le pic ne se répète pas partout)");
});
