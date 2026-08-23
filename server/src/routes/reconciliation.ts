import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { horizonMonths, resolveCycleReferenceMonth } from "../calc/index.js";
import { buildReconciliationContext } from "../calc/reconciliation.js";
import { generateReconciliationOptions } from "../llm/reconciliationClient.js";

function resolveCycle(db: DatabaseSync, requested: string | undefined): string {
  const dataHorizon = horizonMonths(db);
  const todayMonth = new Date().toISOString().slice(0, 7);
  return resolveCycleReferenceMonth(dataHorizon, requested, todayMonth);
}

/** site="" représente "tous sites" dans la table de cache — voir schema.sql. */
function siteKey(site: string | undefined): string {
  return site ?? "";
}

function parseQuery(req: { query: Record<string, unknown> }): { site: string | undefined; requested: string | undefined } {
  const site = typeof req.query.site === "string" && req.query.site.length > 0 ? req.query.site : undefined;
  const requested =
    typeof req.query.cycleReferenceMonth === "string" && /^\d{4}-\d{2}$/.test(req.query.cycleReferenceMonth)
      ? req.query.cycleReferenceMonth
      : undefined;
  return { site, requested };
}

export function reconciliationRouter(db: DatabaseSync): Router {
  const router = Router();

  // Lecture seule : renvoie la dernière génération en cache pour ce cycle/site, sans jamais appeler le LLM.
  router.get("/reconciliation", (req, res) => {
    const { site, requested } = parseQuery(req);
    const cycle = resolveCycle(db, requested);

    const row = db
      .prepare("SELECT generated_at, model, options_json FROM reconciliation_proposals WHERE cycle_reference_month = ? AND site = ?")
      .get(cycle, siteKey(site)) as unknown as { generated_at: string; model: string; options_json: string } | undefined;

    if (!row) {
      res.json({ cycleReferenceMonth: cycle, site: site ?? null, cached: false, generation: null });
      return;
    }
    res.json({
      cycleReferenceMonth: cycle,
      site: site ?? null,
      cached: true,
      generation: { generatedAt: row.generated_at, model: row.model, ...JSON.parse(row.options_json) },
    });
  });

  // Déclenchement explicite (bouton "Générer les propositions pour ce cycle") : appelle toujours le LLM,
  // même si un cache existe déjà — c'est le seul point d'entrée qui facture un appel API.
  router.post("/reconciliation/generate", async (req, res) => {
    const { site, requested } = parseQuery(req);
    const cycle = resolveCycle(db, requested);

    const context = buildReconciliationContext(db, cycle, site);
    const outcome = await generateReconciliationOptions(context);

    if (!outcome.ok) {
      res.status(502).json({ error: outcome.errorType, message: outcome.message });
      return;
    }

    const optionsJson = JSON.stringify({
      options: outcome.result.options,
      recommendedOptionIndex: outcome.result.recommendedOptionIndex,
      recommendationJustification: outcome.result.recommendationJustification,
    });

    db.prepare(
      `INSERT INTO reconciliation_proposals (cycle_reference_month, site, model, context_json, options_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cycle_reference_month, site) DO UPDATE SET
         generated_at = datetime('now'), model = excluded.model, context_json = excluded.context_json, options_json = excluded.options_json`
    ).run(cycle, siteKey(site), outcome.result.model, JSON.stringify(context), optionsJson);

    const row = db
      .prepare("SELECT generated_at FROM reconciliation_proposals WHERE cycle_reference_month = ? AND site = ?")
      .get(cycle, siteKey(site)) as unknown as { generated_at: string };

    res.json({
      cycleReferenceMonth: cycle,
      site: site ?? null,
      cached: false,
      generation: { generatedAt: row.generated_at, model: outcome.result.model, ...JSON.parse(optionsJson) },
    });
  });

  return router;
}
