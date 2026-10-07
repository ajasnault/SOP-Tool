import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { computeDashboard } from "./index.js";
import { serviceLevelForMonth } from "./serviceLevel.js";

function freshDb() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db");
  const db = openDb(dbPath);
  db.exec(`
    INSERT INTO machines (machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours)
    VALUES ('MCH-1', 'Machine', 'Site A - Lyon', 'Ligne 1', 100, 1);

    INSERT INTO products (product_id, product_name, site)
    VALUES ('PRD-1', 'Produit Lyon', 'Site A - Lyon'),
           ('PRD-2', 'Produit Cork', 'Site B - Cork');

    -- Octobre 2026 : PRD-1 demande 1000 (2 marchés), PRD-2 demande 1000
    INSERT INTO forecasts (product_id, month, market, forecast_type, forecast_qty_units)
    VALUES ('PRD-1', '2026-10', 'EU', 'Ventes', 600),
           ('PRD-1', '2026-10', 'US', 'Ventes', 400),
           ('PRD-2', '2026-10', 'EU', 'Ventes', 1000);

    INSERT INTO production_orders (order_id, product_id, machine_id, planned_start, planned_end, batch_qty_units, status)
    VALUES
      -- PRD-1 : 1500 planifiés — le surplus ne doit pas couvrir PRD-2
      ('OF-1', 'PRD-1', 'MCH-1', '2026-10-05 00:00', '2026-10-05 08:00', 1500, 'Planifié'),
      -- PRD-2 : 400 utiles ce mois-ci...
      ('OF-2', 'PRD-2', 'MCH-1', '2026-10-06 00:00', '2026-10-06 08:00', 400, 'En cours'),
      -- ...un ordre reporté (exclu)...
      ('OF-3', 'PRD-2', 'MCH-1', '2026-10-07 00:00', '2026-10-07 08:00', 500, 'Reporté'),
      -- ...et un ordre démarré en octobre mais terminé en novembre (compte pour novembre)
      ('OF-4', 'PRD-2', 'MCH-1', '2026-10-31 20:00', '2026-11-01 04:00', 300, 'Planifié');
  `);
  return db;
}

test("serviceLevel : couverture plafonnée par produit, ordres reportés exclus, rattachement à planned_end", () => {
  const sl = serviceLevelForMonth(freshDb(), "2026-10");
  assert.equal(sl.demand_units, 2000);
  assert.equal(sl.covered_units, 1400, "PRD-1 plafonné à 1000 + PRD-2 400 (OF-3 reporté, OF-4 en novembre)");
  assert.equal(sl.service_level_pct, 70);
  assert.equal(sl.products_with_demand, 2);
  assert.equal(sl.products_fully_covered, 1);
});

test("serviceLevel : filtre par site du produit", () => {
  const db = freshDb();
  assert.equal(serviceLevelForMonth(db, "2026-10", "Site A - Lyon").service_level_pct, 100);
  assert.equal(serviceLevelForMonth(db, "2026-10", "Site B - Cork").service_level_pct, 40);
});

test("serviceLevel : null quand le mois n'a aucune demande", () => {
  const sl = serviceLevelForMonth(freshDb(), "2027-03");
  assert.equal(sl.service_level_pct, null);
  assert.equal(sl.products_with_demand, 0);
});

test("serviceLevel : exposé par computeDashboard avec la cible par défaut", () => {
  const dashboard = computeDashboard(freshDb(), undefined, "2026-10");
  assert.equal(dashboard.serviceLevel.service_level_pct, 70);
  assert.equal(dashboard.serviceLevelTargetPct, 95);
});
