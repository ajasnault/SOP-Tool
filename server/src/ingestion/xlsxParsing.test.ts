import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import { openDb } from "../db/connection.js";
import { importEntity } from "./importEntity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("XLSX : un classeur réel s'importe correctement (régression XLSX.readFile cassé par l'interop ESM/CJS)", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "sop-test-"));
  const xlsxPath = path.join(tmpDir, "machines.xlsx");

  const rows = [
    { machine_id: "MCH-901", machine_name: "Test XLSX", machine_type: "Encartonneuse", process_family: "Packaging", site: "Site A - Lyon", production_line: "Ligne 1", capacity_per_hour_units: 400, changeover_time_hours: 1.2, oee_target_pct: 80, status: "Opérationnelle", commissioning_year: 2022 },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  XLSX.writeFile(workbook, xlsxPath);

  const db = openDb(path.join(tmpDir, "test.db"));
  const report = importEntity(db, "machines", xlsxPath);

  assert.equal(report.status, "imported");
  assert.equal(report.rowsImported, 1);
  assert.equal(report.rowsQuarantined, 0);

  const machine = db.prepare("SELECT machine_name, capacity_per_hour_units FROM machines WHERE machine_id = 'MCH-901'").get() as {
    machine_name: string;
    capacity_per_hour_units: number;
  };
  assert.equal(machine.machine_name, "Test XLSX");
  assert.equal(machine.capacity_per_hour_units, 400);
});
