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
 * Par produit : min(production planifiée, demande prévue), puis somme / demande totale.
 * Production rattachée au mois de `planned_end` (date de disponibilité du lot) ; ordres
 * "Reporté" exclus (ils ne livreront pas sur le mois). `site` filtre sur le site du produit.
 */
export function serviceLevelForMonth(db: DatabaseSync, month: string, site?: string): ServiceLevelSummary {
  const siteFilter = site ? "AND p.site = ?" : "";
  const params = site ? [month, site, month, site] : [month, month];
  const rows = db
    .prepare(
      `WITH demand AS (
         SELECT f.product_id, SUM(f.forecast_qty_units) AS qty
         FROM forecasts f JOIN products p ON p.product_id = f.product_id
         WHERE f.month = ? ${siteFilter}
         GROUP BY f.product_id
       ),
       supply AS (
         SELECT o.product_id, SUM(COALESCE(o.batch_qty_units, 0)) AS qty
         FROM production_orders o JOIN products p ON p.product_id = o.product_id
         WHERE substr(o.planned_end, 1, 7) = ? ${siteFilter}
           AND COALESCE(o.status, '') <> 'Reporté'
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
