import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
  return db;
}

/**
 * Migrations additives pour les bases déjà créées avant l'ajout d'une colonne
 * (schema.sql avec CREATE TABLE IF NOT EXISTS ne les rétrofite pas). Chaque
 * ALTER est idempotent : on ignore l'erreur "duplicate column name".
 */
function migrate(db: DatabaseSync): void {
  const alters = [
    "ALTER TABLE import_batches ADD COLUMN status TEXT NOT NULL DEFAULT 'success'",
    "ALTER TABLE import_batches ADD COLUMN error_message TEXT",
    "ALTER TABLE decisions ADD COLUMN site TEXT",
    "ALTER TABLE decisions ADD COLUMN option_snapshot_json TEXT",
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!(err as Error).message.includes("duplicate column name")) throw err;
    }
  }
}

export type Db = DatabaseSync;
