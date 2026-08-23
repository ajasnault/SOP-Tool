import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { ENTITIES } from "../ingestion/targetSchema.js";
import { importEntity, recordFailedImport } from "../ingestion/importEntity.js";
import { notifyDataChanged } from "../eventBus.js";

interface BatchRow {
  id: number;
  source_filename: string | null;
  started_at: string;
  rows_total: number;
  rows_imported: number;
  rows_quarantined: number;
  status: "success" | "failed";
  error_message: string | null;
}

/** État réel des sources de données (dernier import par entité), pour l'écran "Sources connectées". */
export function sourcesRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/sources", (_req, res) => {
    const result = ENTITIES.map((entity) => {
      const lastBatch = db
        .prepare("SELECT * FROM import_batches WHERE entity = ? ORDER BY id DESC LIMIT 1")
        .get(entity.entity) as unknown as BatchRow | undefined;
      const currentRowCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${entity.table}`).get() as unknown as { c: number }).c;

      return {
        entity: entity.entity,
        table: entity.table,
        currentRowCount,
        lastImport: lastBatch
          ? {
              startedAt: lastBatch.started_at,
              sourceFilename: lastBatch.source_filename,
              rowsTotal: lastBatch.rows_total,
              rowsImported: lastBatch.rows_imported,
              rowsQuarantined: lastBatch.rows_quarantined,
              status: lastBatch.status,
              errorMessage: lastBatch.error_message,
              /** Le fichier de cet import est-il encore présent sur disque (pour "Relancer") ? */
              retryable: lastBatch.status === "failed" && !!lastBatch.source_filename && existsSync(lastBatch.source_filename),
            }
          : null,
      };
    });
    res.json(result);
  });

  router.post("/sources/:entity/retry", (req, res) => {
    const { entity } = req.params;
    const lastFailed = db
      .prepare("SELECT * FROM import_batches WHERE entity = ? AND status = 'failed' ORDER BY id DESC LIMIT 1")
      .get(entity) as unknown as BatchRow | undefined;

    if (!lastFailed || !lastFailed.source_filename || !existsSync(lastFailed.source_filename)) {
      res.status(400).json({
        error:
          "Fichier de la tentative précédente non disponible (les fichiers importés depuis l'écran Import & mapping ne sont pas conservés) — réimporte-le depuis Import & mapping.",
      });
      return;
    }

    try {
      const report = importEntity(db, entity, lastFailed.source_filename);
      if (report.status !== "pending_confirmation") notifyDataChanged(`import:${entity}`);
      res.json(report);
    } catch (err) {
      recordFailedImport(db, entity, lastFailed.source_filename, (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
