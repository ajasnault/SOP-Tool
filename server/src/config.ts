import type { DatabaseSync } from "node:sqlite";

/**
 * Store clé/valeur générique (table `alert_thresholds`), utilisé aussi bien
 * pour les seuils métier (ex. `capacity_utilization_gap_pct`) que pour la
 * config de l'ingestion (ex. `mapping_confidence_min`).
 */
export function getThreshold(db: DatabaseSync, key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM alert_thresholds WHERE key = ?").get(key) as unknown as { value: number } | undefined;
  return row?.value ?? fallback;
}

export function setThreshold(db: DatabaseSync, key: string, value: number): void {
  db.prepare("INSERT INTO alert_thresholds (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** Modèle Claude utilisé pour la génération des propositions de réconciliation — configurable via env, jamais codé en dur. */
export function getLlmModel(): string {
  return process.env.SOP_LLM_MODEL ?? "claude-sonnet-5";
}
