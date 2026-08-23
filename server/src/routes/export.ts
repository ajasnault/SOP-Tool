import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { computeDashboard } from "../calc/index.js";
import { buildPptx } from "../export/pptx.js";
import { buildReconciliationPlanPptx, type DecisionForExport, type OptionSnapshot } from "../export/reconciliationPlan.js";

export function exportRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/export/pptx", async (req, res) => {
    const site = typeof req.query.site === "string" && req.query.site.length > 0 ? req.query.site : undefined;
    const cycleReferenceMonth =
      typeof req.query.cycleReferenceMonth === "string" && /^\d{4}-\d{2}$/.test(req.query.cycleReferenceMonth)
        ? req.query.cycleReferenceMonth
        : undefined;
    try {
      const dashboard = computeDashboard(db, site, cycleReferenceMonth);
      const buffer = await buildPptx(dashboard, site);
      const filename = `sop-${dashboard.cycleReferenceMonth}${site ? `-${site.replace(/[^a-z0-9]+/gi, "_")}` : ""}.pptx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/export/reconciliation-plan/:decisionId", async (req, res) => {
    const id = Number(req.params.decisionId);
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as unknown as
      | (DecisionForExport & { option_snapshot_json: string | null })
      | undefined;

    if (!row) {
      res.status(404).json({ error: "décision introuvable" });
      return;
    }
    if (!row.option_snapshot_json) {
      res.status(400).json({ error: "cette décision n'est pas associée à une proposition de réconciliation — rien à exporter." });
      return;
    }

    try {
      const snapshot = JSON.parse(row.option_snapshot_json) as OptionSnapshot;
      const buffer = await buildReconciliationPlanPptx(row, snapshot);
      const filename = `plan-lissage-${id}.pptx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
