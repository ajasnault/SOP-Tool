import type { DatabaseSync } from "node:sqlite";
import { rollingMonths } from "./period.js";

export interface QcPointSummary {
  qc_point: string;
  controlled: number;
  rejected: number;
  rejection_rate_pct: number | null;
  /** Délai moyen prélèvement → libération observé (h). */
  avg_lead_time_hours: number | null;
  /** Délai moyen prévu par les gammes, pondéré par les mêmes lots que le délai observé (h). */
  planned_lead_time_hours: number | null;
}

export interface RejectedLot {
  lot_id: string;
  product_id: string;
  product_name: string;
  site: string | null;
  qc_point: string | null;
  qc_attribute: string | null;
  measured_value: number | null;
  spec_lower: number | null;
  spec_upper: number | null;
  release_date: string | null;
  qty_units: number | null;
}

export interface ProductRejection {
  product_id: string;
  product_name: string;
  controlled: number;
  rejected: number;
  rejection_rate_pct: number;
}

export interface QualitySummary {
  /** false si aucun résultat QC n'a été importé : la vue affiche alors "non disponible". */
  hasData: boolean;
  /** Mois couverts (fenêtre glissante se terminant au mois du cycle), par date de décision QC. */
  windowMonths: string[];
  controlled: number;
  rejected: number;
  rejection_rate_pct: number | null;
  rejected_units: number;
  /** Valeur des lots rejetés au coût standard (produits sans coût ignorés). */
  rejected_value_eur: number;
  /** Contrôles prélevés mais sans décision à date (file d'attente du laboratoire). */
  pending: number;
  byQcPoint: QcPointSummary[];
  /** Produits au taux de rejet le plus élevé (au moins MIN_CONTROLS_FOR_RANKING contrôles). */
  worstProducts: ProductRejection[];
  /** Lots rejetés les plus récents de la fenêtre. */
  rejectedLots: RejectedLot[];
}

const WINDOW_MONTHS = 3;
const MIN_CONTROLS_FOR_RANKING = 5;

/**
 * Synthèse qualité sur une fenêtre glissante de WINDOW_MONTHS mois se terminant
 * au mois du cycle — voir docs/calculations.md ("Contrôle qualité"). Seuls les
 * résultats décidés (Conforme / Hors spécifications) comptent, rattachés au mois
 * de leur date de libération. `site` filtre sur le site du produit.
 */
export function qualitySummary(db: DatabaseSync, cycleReferenceMonth: string, site?: string): QualitySummary {
  const hasData = (db.prepare("SELECT 1 AS x FROM quality_results LIMIT 1").get() as unknown as { x: number } | undefined) !== undefined;
  const windowMonths = rollingMonths(shiftMonth(cycleReferenceMonth, -(WINDOW_MONTHS - 1)), WINDOW_MONTHS);
  const empty: QualitySummary = {
    hasData,
    windowMonths,
    controlled: 0,
    rejected: 0,
    rejection_rate_pct: null,
    rejected_units: 0,
    rejected_value_eur: 0,
    pending: 0,
    byQcPoint: [],
    worstProducts: [],
    rejectedLots: [],
  };
  if (!hasData) return empty;

  const siteFilter = site ? "AND p.site = ?" : "";
  const monthPlaceholders = windowMonths.map(() => "?").join(",");
  const baseParams = [...windowMonths, ...(site ? [site] : [])];

  const rows = db
    .prepare(
      `SELECT q.lot_id, q.product_id, p.product_name, p.site, p.standard_cost_eur_per_unit AS cost,
              q.qc_point, q.qc_attribute, q.measured_value, q.spec_lower, q.spec_upper, q.release_date, q.result,
              (julianday(q.release_date) - julianday(q.sample_date)) * 24 AS lead_hours,
              (SELECT MAX(o.batch_qty_units) FROM production_orders o WHERE o.lot_id = q.lot_id) AS qty,
              rt.qc_lead_time_mean_hours AS planned_lead_hours
       FROM quality_results q JOIN products p ON p.product_id = q.product_id
       LEFT JOIN routings rt ON rt.product_id = q.product_id AND rt.step_no = q.step_no
       WHERE q.result IN ('Conforme', 'Hors spécifications')
         AND substr(q.release_date, 1, 7) IN (${monthPlaceholders}) ${siteFilter}`
    )
    .all(...baseParams) as unknown as {
    lot_id: string;
    product_id: string;
    product_name: string;
    site: string | null;
    cost: number | null;
    qc_point: string | null;
    qc_attribute: string | null;
    measured_value: number | null;
    spec_lower: number | null;
    spec_upper: number | null;
    release_date: string | null;
    result: string;
    lead_hours: number | null;
    qty: number | null;
    planned_lead_hours: number | null;
  }[];

  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM quality_results q JOIN products p ON p.product_id = q.product_id
       WHERE q.result = 'En cours d''analyse' ${siteFilter}`
    )
    .get(...(site ? [site] : [])) as unknown as { n: number };

  const rejectedRows = rows.filter((r) => r.result === "Hors spécifications");

  // Délai prévu pondéré par lot (même population que le délai observé), pas une
  // moyenne des gammes : 336 h pour un injectable et 48 h pour du façonnage ne
  // pèsent pas pareil selon le nombre de lots contrôlés.
  const byPoint = new Map<string, { controlled: number; rejected: number; leadSum: number; leadN: number; plannedSum: number; plannedN: number }>();
  const byProduct = new Map<string, { name: string; controlled: number; rejected: number }>();
  for (const r of rows) {
    const point = r.qc_point ?? "Non précisé";
    const cur = byPoint.get(point) ?? { controlled: 0, rejected: 0, leadSum: 0, leadN: 0, plannedSum: 0, plannedN: 0 };
    cur.controlled++;
    if (r.result === "Hors spécifications") cur.rejected++;
    if (r.lead_hours !== null) {
      cur.leadSum += r.lead_hours;
      cur.leadN++;
    }
    if (r.planned_lead_hours !== null) {
      cur.plannedSum += r.planned_lead_hours;
      cur.plannedN++;
    }
    byPoint.set(point, cur);

    const prod = byProduct.get(r.product_id) ?? { name: r.product_name, controlled: 0, rejected: 0 };
    prod.controlled++;
    if (r.result === "Hors spécifications") prod.rejected++;
    byProduct.set(r.product_id, prod);
  }

  return {
    hasData,
    windowMonths,
    controlled: rows.length,
    rejected: rejectedRows.length,
    rejection_rate_pct: rows.length > 0 ? round2((rejectedRows.length / rows.length) * 100) : null,
    rejected_units: rejectedRows.reduce((s, r) => s + (r.qty ?? 0), 0),
    rejected_value_eur: round2(rejectedRows.reduce((s, r) => s + (r.qty ?? 0) * (r.cost ?? 0), 0)),
    pending: pendingRow.n,
    byQcPoint: [...byPoint.entries()]
      .map(([qc_point, v]) => ({
        qc_point,
        controlled: v.controlled,
        rejected: v.rejected,
        rejection_rate_pct: v.controlled > 0 ? round2((v.rejected / v.controlled) * 100) : null,
        avg_lead_time_hours: v.leadN > 0 ? round2(v.leadSum / v.leadN) : null,
        planned_lead_time_hours: v.plannedN > 0 ? round2(v.plannedSum / v.plannedN) : null,
      }))
      .sort((a, b) => a.qc_point.localeCompare(b.qc_point)),
    worstProducts: [...byProduct.entries()]
      .filter(([, v]) => v.controlled >= MIN_CONTROLS_FOR_RANKING && v.rejected > 0)
      .map(([product_id, v]) => ({
        product_id,
        product_name: v.name,
        controlled: v.controlled,
        rejected: v.rejected,
        rejection_rate_pct: round2((v.rejected / v.controlled) * 100),
      }))
      .sort((a, b) => b.rejection_rate_pct - a.rejection_rate_pct || b.rejected - a.rejected)
      .slice(0, 3),
    rejectedLots: rejectedRows
      .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
      .slice(0, 8)
      .map((r) => ({
        lot_id: r.lot_id,
        product_id: r.product_id,
        product_name: r.product_name,
        site: r.site,
        qc_point: r.qc_point,
        qc_attribute: r.qc_attribute,
        measured_value: r.measured_value,
        spec_lower: r.spec_lower,
        spec_upper: r.spec_upper,
        release_date: r.release_date,
        qty_units: r.qty,
      })),
  };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
