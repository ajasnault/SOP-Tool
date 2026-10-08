import type { DatabaseSync } from "node:sqlite";

export interface ServiceLevelSummary {
  month: string;
  /** Demande prévue du mois (somme forecast_qty_units, tous marchés). */
  demand_units: number;
  /** Part de la demande couverte par le plan, plafonnée produit par produit. */
  covered_units: number;
  /** covered_units / demand_units × 100, ou null si aucune demande ce mois-ci. */
  service_level_pct: number | null;
  /** Produits ayant une demande ce mois-ci. */
  products_with_demand: number;
  /** Produits dont la demande est entièrement couverte par le plan. */
  products_fully_covered: number;
}

/**
 * Taux de service prévisionnel — voir docs/calculations.md ("Taux de service prévisionnel").
 * Par produit : min(production disponible, demande prévue), puis somme / demande totale.
 *
 * Production disponible :
 * - OF avec gamme (`step_no` renseigné, gamme importée) : seule la dernière opération
 *   de la gamme produit du fini, rattachée au mois de libération QC (`quality_results.release_date`,
 *   sinon `planned_end`). Les lots hors spécifications sont exclus ;
 * - OF sans gamme (`step_no` NULL, jeux antérieurs, ou produit sans gamme importée) : chaque OF est un lot fini,
 *   rattaché au mois de `planned_end`.
 * Ordres "Reporté" exclus (ils ne livreront pas sur le mois). `site` filtre sur le site du produit.
 */
export function serviceLevelForMonth(db: DatabaseSync, month: string, site?: string): ServiceLevelSummary {
  const siteFilter = site ? "AND p.site = ?" : "";
  const params = site ? [month, site, month, month, month, site] : [month, month, month, month];
  const rows = db
    .prepare(
      `WITH demand AS (
         SELECT f.product_id, SUM(f.forecast_qty_units) AS qty
         FROM forecasts f JOIN products p ON p.product_id = f.product_id
         WHERE f.month = ? ${siteFilter}
         GROUP BY f.product_id
       ),
       final_step AS (
         SELECT product_id, MAX(step_no) AS step_no FROM routings GROUP BY product_id
       ),
       output AS (
         SELECT o.product_id, o.batch_qty_units AS qty, COALESCE(q.release_date, o.planned_end) AS available_at
         FROM production_orders o
         JOIN final_step fs ON fs.product_id = o.product_id AND fs.step_no = o.step_no
         LEFT JOIN quality_results q ON q.lot_id = o.lot_id AND q.step_no = o.step_no
         -- La libération suit la fin de l'OF de quelques jours à quelques semaines :
         -- inutile de regarder les OF terminés plus de 3 mois avant le mois visé.
         WHERE o.planned_end >= date(? || '-01', '-3 months') AND o.planned_end < date(? || '-01', '+1 month')
           AND COALESCE(o.status, '') <> 'Reporté'
           AND NOT EXISTS (
             SELECT 1 FROM quality_results r WHERE r.lot_id = o.lot_id AND r.result = 'Hors spécifications'
           )
         UNION ALL
         SELECT o.product_id, o.batch_qty_units, o.planned_end
         FROM production_orders o
         WHERE (o.step_no IS NULL OR o.product_id NOT IN (SELECT product_id FROM final_step))
           AND COALESCE(o.status, '') <> 'Reporté'
       ),
       supply AS (
         SELECT o.product_id, SUM(COALESCE(o.qty, 0)) AS qty
         FROM output o JOIN products p ON p.product_id = o.product_id
         WHERE substr(o.available_at, 1, 7) = ? ${siteFilter}
         GROUP BY o.product_id
       )
       SELECT d.qty AS demand, COALESCE(s.qty, 0) AS supply
       FROM demand d LEFT JOIN supply s ON s.product_id = d.product_id
       WHERE d.qty > 0`
    )
    .all(...params) as unknown as { demand: number; supply: number }[];

  let demand = 0;
  let covered = 0;
  let fullyCovered = 0;
  for (const r of rows) {
    demand += r.demand;
    covered += Math.min(r.supply, r.demand);
    if (r.supply >= r.demand) fullyCovered++;
  }

  return {
    month,
    demand_units: round2(demand),
    covered_units: round2(covered),
    service_level_pct: demand > 0 ? round2((covered / demand) * 100) : null,
    products_with_demand: rows.length,
    products_fully_covered: fullyCovered,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
