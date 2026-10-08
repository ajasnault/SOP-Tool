import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { importEntity } from "./importEntity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "renamed");

const ENTITY_FILES: [string, string][] = [
  ["products", "01_products.csv"],
  ["machines", "02_machines.csv"],
  ["employees", "07_hr_resources.csv"],
  ["forecasts", "03_forecasts.csv"],
  ["production_orders", "04_production_plan.csv"],
  ["maintenance_plans", "05_maintenance_plan.csv"],
  ["shutdowns", "06_shutdowns.csv"],
  ["absences", "08_hr_absences.csv"],
];

test("le mapping fuzzy importe les CSV aux colonnes renommées sans intervention manuelle", () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db");
  const db = openDb(dbPath);

  for (const [entity, filename] of ENTITY_FILES) {
    const report = importEntity(db, entity, path.join(fixturesDir, filename));
    assert.equal(report.rowsQuarantined, 0, `${entity}: des lignes ont été mises en quarantaine`);
    // Ces fixtures datent d'avant les gammes : un plan sans lot ni étape reste
    // valide (lot_id/step_no optionnels), tout autre champ doit être mappé.
    const allowedUnmapped =
      entity === "production_orders" ? ["lot_id", "step_no"] : entity === "machines" ? ["line_clearance_hours"] : [];
    const unexpected = report.unmappedFields.filter((f) => !allowedUnmapped.includes(f));
    assert.equal(unexpected.length, 0, `${entity}: champs non mappés ${unexpected.join(", ")}`);
    assert.equal(report.rowsImported, report.rowsTotal, `${entity}: toutes les lignes attendues n'ont pas été importées`);
  }

  const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  assert.equal(productCount.c, 35);
});
