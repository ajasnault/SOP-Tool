import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";

const VALID_STATUSES = new Set(["a_faire", "en_cours", "fait", "abandonne"]);

interface DecisionRow {
  id: number;
  description: string;
  owner: string | null;
  due_date: string | null;
  status: string;
  site: string | null;
  source_option_title: string | null;
  option_snapshot_json: string | null;
  cycle_reference_month: string | null;
  created_at: string;
  updated_at: string;
}

function serializeDecision(row: DecisionRow) {
  const { option_snapshot_json, ...rest } = row;
  return { ...rest, option_snapshot: option_snapshot_json ? JSON.parse(option_snapshot_json) : null };
}

/**
 * Décisions & plan d'action — CRUD humain, aucun LLM impliqué (voir
 * docs/calculations.md). `site` NULL = "tous sites" : visible depuis
 * n'importe quel filtre, y compris "tous sites" (site NULL en vue Consolidé
 * n'omet pas de filtre — voir GET ci-dessous — même sémantique que
 * `computeDashboard(db, undefined, ...)` : pas de `site` demandé = pas de
 * filtrage, donc tout remonte).
 */
export function decisionsRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/decisions", (req, res) => {
    const site = typeof req.query.site === "string" && req.query.site.length > 0 ? req.query.site : undefined;
    const rows = site
      ? (db
          .prepare("SELECT * FROM decisions WHERE site = ? OR site IS NULL ORDER BY (due_date IS NULL), due_date, created_at")
          .all(site) as unknown as DecisionRow[])
      : (db.prepare("SELECT * FROM decisions ORDER BY (due_date IS NULL), due_date, created_at").all() as unknown as DecisionRow[]);
    res.json(rows.map(serializeDecision));
  });

  router.post("/decisions", (req, res) => {
    const { description, owner, due_date, status, site, source_option_title, option_snapshot, cycle_reference_month } = req.body ?? {};
    if (typeof description !== "string" || description.trim().length === 0) {
      res.status(400).json({ error: "description est requise" });
      return;
    }
    const resolvedStatus = typeof status === "string" && VALID_STATUSES.has(status) ? status : "a_faire";

    const result = db
      .prepare(
        `INSERT INTO decisions (description, owner, due_date, status, site, source_option_title, option_snapshot_json, cycle_reference_month)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        description.trim(),
        typeof owner === "string" && owner.trim() ? owner.trim() : null,
        typeof due_date === "string" && due_date ? due_date : null,
        resolvedStatus,
        typeof site === "string" && site ? site : null,
        typeof source_option_title === "string" && source_option_title ? source_option_title : null,
        option_snapshot && typeof option_snapshot === "object" ? JSON.stringify(option_snapshot) : null,
        typeof cycle_reference_month === "string" && cycle_reference_month ? cycle_reference_month : null
      );

    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(result.lastInsertRowid) as unknown as DecisionRow;
    res.status(201).json(serializeDecision(row));
  });

  router.put("/decisions/:id", (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as unknown as DecisionRow | undefined;
    if (!existing) {
      res.status(404).json({ error: "décision introuvable" });
      return;
    }

    const { description, owner, due_date, status } = req.body ?? {};
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `status doit être l'un de : ${[...VALID_STATUSES].join(", ")}` });
      return;
    }
    if (description !== undefined && (typeof description !== "string" || description.trim().length === 0)) {
      res.status(400).json({ error: "description ne peut pas être vide" });
      return;
    }

    db.prepare(
      `UPDATE decisions SET
         description = ?, owner = ?, due_date = ?, status = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      description !== undefined ? description.trim() : existing.description,
      owner !== undefined ? (typeof owner === "string" && owner.trim() ? owner.trim() : null) : existing.owner,
      due_date !== undefined ? (typeof due_date === "string" && due_date ? due_date : null) : existing.due_date,
      status !== undefined ? status : existing.status,
      id
    );

    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as unknown as DecisionRow;
    res.json(serializeDecision(row));
  });

  router.delete("/decisions/:id", (req, res) => {
    const id = Number(req.params.id);
    const result = db.prepare("DELETE FROM decisions WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "décision introuvable" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
