import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { computeDashboard, getThreshold, setThreshold } from "../calc/index.js";
import { notifyDataChanged } from "../eventBus.js";

export function dashboardRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get("/dashboard", (req, res) => {
    const site = typeof req.query.site === "string" && req.query.site.length > 0 ? req.query.site : undefined;
    const cycleReferenceMonth =
      typeof req.query.cycleReferenceMonth === "string" && /^\d{4}-\d{2}$/.test(req.query.cycleReferenceMonth)
        ? req.query.cycleReferenceMonth
        : undefined;
    res.json(computeDashboard(db, site, cycleReferenceMonth));
  });

  // Sites distincts vus dans les données (machines/produits/employés), pour peupler
  // le filtre "Consolidé / <site>..." sans les coder en dur côté client.
  router.get("/sites", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT site FROM (
           SELECT site FROM machines WHERE site IS NOT NULL
           UNION SELECT site FROM products WHERE site IS NOT NULL
           UNION SELECT site FROM employees WHERE site IS NOT NULL
         ) ORDER BY site`
      )
      .all() as unknown as { site: string }[];
    res.json(rows.map((r) => r.site));
  });

  router.get("/thresholds", (_req, res) => {
    res.json({
      capacity_utilization_gap_pct: getThreshold(db, "capacity_utilization_gap_pct", 90),
      mapping_confidence_min: getThreshold(db, "mapping_confidence_min", 0.75),
      source_staleness_warning_hours: getThreshold(db, "source_staleness_warning_hours", 24),
      frozen_period_weeks: getThreshold(db, "frozen_period_weeks", 8),
    });
  });

  router.put("/thresholds/:key", (req, res) => {
    const value = Number(req.body?.value);
    if (!Number.isFinite(value)) {
      res.status(400).json({ error: "value doit être un nombre" });
      return;
    }
    setThreshold(db, req.params.key, value);
    notifyDataChanged(`threshold:${req.params.key}`);
    res.json({ key: req.params.key, value });
  });

  return router;
}
