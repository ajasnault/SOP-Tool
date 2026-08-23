import type { DatabaseSync } from "node:sqlite";
import { quarterOf } from "./period.js";

export type DemandGroupBy = "family" | "product" | "market";
export type DemandPeriod = "month" | "quarter";

export interface DemandRow {
  group: string;
  period: string;
  qty_units: number;
}

/** Voir docs/calculations.md — somme forecast_qty_units groupée par dimension/période. `site` optionnel filtre sur le site du produit. */
export function consolidatedDemand(db: DatabaseSync, groupBy: DemandGroupBy, period: DemandPeriod = "month", site?: string): DemandRow[] {
  const groupColumn = groupBy === "family" ? "p.family" : groupBy === "product" ? "f.product_id" : "f.market";
  const whereClause = site ? "WHERE p.site = ?" : "";
  const rows = (
    site
      ? db
          .prepare(
            `SELECT ${groupColumn} AS grp, f.month AS month, SUM(f.forecast_qty_units) AS qty
             FROM forecasts f JOIN products p ON p.product_id = f.product_id
             ${whereClause}
             GROUP BY grp, f.month
             ORDER BY f.month`
          )
          .all(site)
      : db
          .prepare(
            `SELECT ${groupColumn} AS grp, f.month AS month, SUM(f.forecast_qty_units) AS qty
             FROM forecasts f JOIN products p ON p.product_id = f.product_id
             GROUP BY grp, f.month
             ORDER BY f.month`
          )
          .all()
  ) as unknown as { grp: string | null; month: string; qty: number }[];

  if (period === "month") {
    return rows.map((r) => ({ group: r.grp ?? "(non renseigné)", period: r.month, qty_units: round2(r.qty) }));
  }

  const byQuarter = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.grp ?? "(non renseigné)"}|${quarterOf(r.month)}`;
    byQuarter.set(key, (byQuarter.get(key) ?? 0) + r.qty);
  }
  return [...byQuarter.entries()].map(([key, qty]) => {
    const [group, quarter] = key.split("|");
    return { group, period: quarter, qty_units: round2(qty) };
  });
}

/** Tendance de la demande totale (tous produits confondus), par mois. `site` optionnel filtre sur le site du produit. */
export function demandTrend(db: DatabaseSync, site?: string): { month: string; qty_units: number }[] {
  const rows = (
    site
      ? db
          .prepare(
            `SELECT f.month AS month, SUM(f.forecast_qty_units) AS qty
             FROM forecasts f JOIN products p ON p.product_id = f.product_id
             WHERE p.site = ?
             GROUP BY f.month ORDER BY f.month`
          )
          .all(site)
      : db.prepare("SELECT month, SUM(forecast_qty_units) AS qty FROM forecasts GROUP BY month ORDER BY month").all()
  ) as unknown as { month: string; qty: number }[];
  return rows.map((r) => ({ month: r.month, qty_units: round2(r.qty) }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
