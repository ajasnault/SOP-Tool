import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/connection.js";
import { computeDashboard } from "../calc/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "..", "data", "sop.db");

const db = openDb(dbPath);
const summary = computeDashboard(db);

console.log(JSON.stringify(summary, null, 2));
const gaps = summary.capacity.filter((r) => r.utilization_pct !== null && r.utilization_pct > summary.thresholdPct);
console.error(
  `\n[calc] cycle: ${summary.cycleReferenceMonth} (${summary.isCurrentCycle ? "cycle courant" : "cycle historique"}), ` +
    `chartHorizon: ${summary.chartHorizon[0]} → ${summary.chartHorizon[summary.chartHorizon.length - 1]}, ` +
    `gaps détectés: ${gaps.length}/${summary.capacity.length} (seuil ${summary.thresholdPct}%)`
);
