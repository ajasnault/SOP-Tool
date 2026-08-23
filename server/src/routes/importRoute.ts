import { Router } from "express";
import multer from "multer";
import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { importEntity, recordFailedImport } from "../ingestion/importEntity.js";
import { getEntity } from "../ingestion/targetSchema.js";
import { notifyDataChanged } from "../eventBus.js";

export function importRouter(db: DatabaseSync, uploadsDir: string): Router {
  mkdirSync(uploadsDir, { recursive: true });
  const upload = multer({ dest: uploadsDir });
  const router = Router();

  router.post("/import/:entity", upload.single("file"), (req, res) => {
    const { entity } = req.params;
    try {
      getEntity(entity);
    } catch {
      res.status(404).json({ error: `Entité inconnue: ${entity}` });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Fichier manquant (champ 'file')" });
      return;
    }

    // multer enlève l'extension ; importEntity/parseFile en a besoin pour choisir le parser.
    const filePath = `${req.file.path}${path.extname(req.file.originalname)}`;
    try {
      renameSync(req.file.path, filePath);
      const report = importEntity(db, entity, filePath, { sourceLabel: req.file.originalname });
      if (report.status === "pending_confirmation") {
        res.status(202).json(report);
        return;
      }
      notifyDataChanged(`import:${entity}`);
      res.json(report);
    } catch (err) {
      recordFailedImport(db, entity, req.file.originalname, (err as Error).message);
      notifyDataChanged(`import-failed:${entity}`);
      res.status(400).json({ error: (err as Error).message });
    } finally {
      try {
        unlinkSync(filePath);
      } catch {
        /* fichier déjà absent */
      }
    }
  });

  // Confirme (avec correction éventuelle) le mapping proposé pour une
  // signature d'en-têtes jamais vue et jamais confirmée ; mémorise le
  // mapping puis importe. Body multipart : "file" (le même fichier) +
  // "mapping" (JSON du mapping champ cible -> colonne source, à partir du
  // mapping proposé dans la réponse 202 précédente, corrigé si besoin) +
  // "manualFields" (JSON, optionnel : noms des champs édités à la main,
  // traités à confiance 1) + "dryRun" ("true", optionnel : aperçu sans
  // écrire en base, pour l'écran de mapping pendant l'édition).
  router.post("/import/:entity/confirm", upload.single("file"), (req, res) => {
    const { entity } = req.params;
    try {
      getEntity(entity);
    } catch {
      res.status(404).json({ error: `Entité inconnue: ${entity}` });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Fichier manquant (champ 'file')" });
      return;
    }
    if (!req.body?.mapping) {
      res.status(400).json({ error: "Champ 'mapping' manquant (JSON du mapping champ cible -> colonne source)" });
      return;
    }
    let forceMapping: Record<string, string | null>;
    let manualFields: string[] | undefined;
    try {
      forceMapping = JSON.parse(req.body.mapping);
      manualFields = req.body.manualFields ? JSON.parse(req.body.manualFields) : undefined;
    } catch {
      res.status(400).json({ error: "Champ 'mapping' ou 'manualFields' invalide (JSON attendu)" });
      return;
    }
    const dryRun = req.body.dryRun === "true";

    const filePath = `${req.file.path}${path.extname(req.file.originalname)}`;
    try {
      renameSync(req.file.path, filePath);
      const report = importEntity(db, entity, filePath, { forceMapping, manualFields, dryRun, sourceLabel: req.file.originalname });
      if (!dryRun) notifyDataChanged(`import:${entity}`);
      res.json(report);
    } catch (err) {
      if (!dryRun) recordFailedImport(db, entity, req.file.originalname, (err as Error).message);
      res.status(400).json({ error: (err as Error).message });
    } finally {
      try {
        unlinkSync(filePath);
      } catch {
        /* fichier déjà absent */
      }
    }
  });

  router.get("/import-batches", (_req, res) => {
    const batches = db
      .prepare("SELECT id, entity, source_filename, started_at, rows_total, rows_imported, rows_quarantined FROM import_batches ORDER BY id DESC LIMIT 50")
      .all();
    res.json(batches);
  });

  router.get("/import-batches/:id/errors", (req, res) => {
    const errors = db
      .prepare("SELECT row_number, field, message, raw_row_json FROM import_errors WHERE import_batch_id = ? ORDER BY row_number")
      .all(req.params.id);
    res.json(errors);
  });

  return router;
}
