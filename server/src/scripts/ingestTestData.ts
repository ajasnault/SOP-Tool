/**
 * Script d'ingestion du jeu de test (les 8 CSV originaux, ou leur copie aux
 * colonnes renommées avec --renamed pour tester le mapping fuzzy). Sortie:
 * rapport JSON par entité sur stdout. Pas d'UI à ce stade — cf. plan V1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";
import { openDb } from "../db/connection.js";
import { importEntity } from "../ingestion/importEntity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const useRenamed = process.argv.includes("--renamed");
// --dir=<dossier> : ingère un autre jeu (ex. sortie de generateFlowDataset.ts) ;
// --db=<fichier> : vers une autre base que data/sop.db.
const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const sourceDir =
  argValue("dir") ??
  (useRenamed ? path.join(__dirname, "..", "..", "fixtures", "renamed") : path.join(__dirname, "..", "..", "..", "..", "Projet S&OP"));

const dbPath = argValue("db") ?? path.join(__dirname, "..", "..", "data", useRenamed ? "sop.renamed-test.db" : "sop.db");
mkdirSync(path.dirname(dbPath), { recursive: true });

const ENTITY_FILES: [string, string][] = [
  ["products", "01_products.csv"],
  ["machines", "02_machines.csv"],
  ["employees", "07_hr_resources.csv"],
  ["forecasts", "03_forecasts.csv"],
  ["routings", "09_routings.csv"],
  ["production_orders", "04_production_plan.csv"],
  ["quality_results", "10_quality_results.csv"],
  ["maintenance_plans", "05_maintenance_plan.csv"],
  ["shutdowns", "06_shutdowns.csv"],
  ["absences", "08_hr_absences.csv"],
];

const db = openDb(dbPath);
const reports = [];

for (const [entity, filename] of ENTITY_FILES) {
  const filePath = path.join(sourceDir, filename);
  // Gammes et résultats QC sont optionnels (absents des jeux antérieurs).
  if (!existsSync(filePath) && (entity === "routings" || entity === "quality_results")) continue;
  const report = importEntity(db, entity, filePath);
  reports.push(report);
}

console.log(JSON.stringify(reports, null, 2));

const pending = reports.filter((r) => r.status === "pending_confirmation");
for (const r of pending) {
  console.error(`\n[ingest] EN ATTENTE DE CONFIRMATION — ${r.entity} (${r.sourceFile}): ${r.message}`);
}

const totalErrors = reports.reduce((sum, r) => sum + r.rowsQuarantined, 0);
const totalUnmapped = reports.reduce((sum, r) => sum + r.unmappedFields.length, 0);
console.error(
  `\n[ingest] ${useRenamed ? "(colonnes renommées) " : ""}${reports.length} entités, ` +
    `${reports.reduce((s, r) => s + r.rowsImported, 0)} lignes importées, ` +
    `${totalErrors} lignes en quarantaine, ${totalUnmapped} champs non mappés, ` +
    `${pending.length} en attente de confirmation. DB: ${dbPath}`
);
