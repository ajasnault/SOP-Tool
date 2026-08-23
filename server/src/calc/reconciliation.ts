import type { DatabaseSync } from "node:sqlite";
import { computeDashboard, type MachineMonthCapacity } from "./index.js";
import { demandTrend } from "./demand.js";
import { getThreshold } from "../config.js";

/**
 * Contexte chiffré fourni au LLM pour la génération des propositions de
 * réconciliation (voir docs/calculations.md, "Propositions de réconciliation
 * (LLM)"). Toutes les valeurs ici sont calculées par l'application — le LLM
 * ne fait qu'interpréter ce contexte, jamais inventer un chiffre.
 */

export interface CapacityGapContext {
  machine_id: string;
  machine_name: string;
  site: string | null;
  production_line: string | null;
  month: string;
  available_hours: number;
  planned_hours: number;
  utilization_pct: number | null;
  is_gap: boolean;
}

export type ChronicPattern = "surcharge_chronique" | "sous_utilisation_chronique" | "normal";

export interface LineUtilizationTrend {
  production_line: string;
  site: string | null;
  months_covered: number;
  avg_utilization_pct: number | null;
  months_over_threshold: number;
  months_under_low_threshold: number;
  chronic_pattern: ChronicPattern;
}

export interface DemandShockMonth {
  month: string;
  actual_qty_units: number;
  baseline_qty_units: number | null;
  deviation_pct: number | null;
  is_shock: boolean;
}

export interface ProductCostContext {
  product_id: string;
  product_name: string;
  family: string | null;
  standard_cost_eur_per_unit: number | null;
}

export interface ReconciliationContext {
  cycleReferenceMonth: string;
  site: string | undefined;
  frozenPeriodEndMonth: string;
  /** Mois de chartHorizon strictement après la période gelée — seule zone où une option peut agir. */
  unfrozenMonths: string[];
  thresholdPct: number;
  demandShockThresholdPct: number;
  capacityGaps: CapacityGapContext[];
  lineUtilizationTrend: LineUtilizationTrend[];
  demandShock: DemandShockMonth[];
  relevantProductCosts: ProductCostContext[];
}

// Seuil de sous-utilisation "basse" pour qualifier une ligne de candidate à la
// consolidation/fermeture — distinct du seuil de gap haut (`thresholdPct`,
// configurable). Volontairement fixe pour l'instant : voir docs/calculations.md.
const LOW_UTILIZATION_THRESHOLD_PCT = 50;
// Une ligne est "chronique" (en surcharge ou sous-utilisation) si au moins
// cette proportion des mois du chartHorizon dépasse/passe sous le seuil.
const CHRONIC_MONTH_RATIO = 0.7;
// Fenêtre de mois précédents utilisée comme référence pour détecter un choc de demande.
const BASELINE_WINDOW_MONTHS = 6;

export function buildReconciliationContext(db: DatabaseSync, cycleReferenceMonth: string, site?: string): ReconciliationContext {
  const dashboard = computeDashboard(db, site, cycleReferenceMonth);
  const unfrozenMonths = dashboard.chartHorizon.filter((m) => m > dashboard.frozenPeriodEndMonth);
  const unfrozenSet = new Set(unfrozenMonths);

  const capacityGaps: CapacityGapContext[] = dashboard.capacityTrend
    .filter((r) => unfrozenSet.has(r.month))
    .map((r) => ({
      machine_id: r.machine_id,
      machine_name: r.machine_name,
      site: r.site,
      production_line: r.production_line,
      month: r.month,
      available_hours: r.available_hours,
      planned_hours: r.planned_hours,
      utilization_pct: r.utilization_pct,
      is_gap: r.utilization_pct !== null && r.utilization_pct > dashboard.thresholdPct,
    }));

  const lineUtilizationTrend = computeLineUtilizationTrend(dashboard.capacityTrend, dashboard.thresholdPct);

  const demandShockThresholdPct = getThreshold(db, "demand_shock_threshold_pct", 20);
  const demandShock = computeDemandShock(db, site, unfrozenMonths, demandShockThresholdPct);

  const relevantProductCosts = queryRelevantProductCosts(db, capacityGaps.filter((g) => g.is_gap));

  return {
    cycleReferenceMonth: dashboard.cycleReferenceMonth,
    site,
    frozenPeriodEndMonth: dashboard.frozenPeriodEndMonth,
    unfrozenMonths,
    thresholdPct: dashboard.thresholdPct,
    demandShockThresholdPct,
    capacityGaps,
    lineUtilizationTrend,
    demandShock,
    relevantProductCosts,
  };
}

/** Agrège capacityTrend (déjà calculé, tout le chartHorizon) par ligne pour détecter un motif chronique. */
function computeLineUtilizationTrend(capacityTrend: MachineMonthCapacity[], thresholdPct: number): LineUtilizationTrend[] {
  const byLine = new Map<string, MachineMonthCapacity[]>();
  for (const r of capacityTrend) {
    if (!r.production_line) continue;
    const key = `${r.site ?? ""}|${r.production_line}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key)!.push(r);
  }

  const result: LineUtilizationTrend[] = [];
  for (const [key, rows] of byLine) {
    const [site, production_line] = key.split("|");
    const byMonth = new Map<string, { available: number; planned: number }>();
    for (const r of rows) {
      const cur = byMonth.get(r.month) ?? { available: 0, planned: 0 };
      cur.available += r.available_hours;
      cur.planned += r.planned_hours;
      byMonth.set(r.month, cur);
    }
    const monthPcts = [...byMonth.values()].map((m) => (m.available > 0 ? (m.planned / m.available) * 100 : null));
    const validPcts = monthPcts.filter((p): p is number => p !== null);
    const total = validPcts.length;
    const avg = total > 0 ? round2(validPcts.reduce((a, b) => a + b, 0) / total) : null;
    const monthsOver = validPcts.filter((p) => p > thresholdPct).length;
    const monthsUnder = validPcts.filter((p) => p < LOW_UTILIZATION_THRESHOLD_PCT).length;

    let chronic_pattern: ChronicPattern = "normal";
    if (total > 0 && monthsOver / total >= CHRONIC_MONTH_RATIO) chronic_pattern = "surcharge_chronique";
    else if (total > 0 && monthsUnder / total >= CHRONIC_MONTH_RATIO) chronic_pattern = "sous_utilisation_chronique";

    result.push({
      production_line,
      site: site || null,
      months_covered: total,
      avg_utilization_pct: avg,
      months_over_threshold: monthsOver,
      months_under_low_threshold: monthsUnder,
      chronic_pattern,
    });
  }
  return result;
}

/** Baseline = moyenne des BASELINE_WINDOW_MONTHS mois précédents (parmi tous les mois avec forecast, pas seulement chartHorizon). */
function computeDemandShock(
  db: DatabaseSync,
  site: string | undefined,
  unfrozenMonths: string[],
  thresholdPct: number
): DemandShockMonth[] {
  const trend = demandTrend(db, site);
  const byMonth = new Map(trend.map((r) => [r.month, r.qty_units]));
  const sortedMonths = trend.map((r) => r.month);

  return unfrozenMonths.map((month) => {
    const actual = byMonth.get(month) ?? 0;
    const idx = sortedMonths.indexOf(month);
    const priorMonths =
      idx >= 0
        ? sortedMonths.slice(Math.max(0, idx - BASELINE_WINDOW_MONTHS), idx)
        : sortedMonths.filter((m) => m < month).slice(-BASELINE_WINDOW_MONTHS);
    const priorValues = priorMonths.map((m) => byMonth.get(m) ?? 0);

    if (priorValues.length < 2) {
      return { month, actual_qty_units: round2(actual), baseline_qty_units: null, deviation_pct: null, is_shock: false };
    }
    const baseline = priorValues.reduce((a, b) => a + b, 0) / priorValues.length;
    const deviationPct = baseline > 0 ? round2(((actual - baseline) / baseline) * 100) : null;
    const is_shock = deviationPct !== null && Math.abs(deviationPct) >= thresholdPct;
    return {
      month,
      actual_qty_units: round2(actual),
      baseline_qty_units: round2(baseline),
      deviation_pct: deviationPct,
      is_shock,
    };
  });
}

/** Coûts standards des produits réellement planifiés sur les machines/mois en gap — pas le catalogue entier. */
function queryRelevantProductCosts(db: DatabaseSync, gapRows: CapacityGapContext[]): ProductCostContext[] {
  if (gapRows.length === 0) return [];
  const machineIds = [...new Set(gapRows.map((g) => g.machine_id))];
  const months = [...new Set(gapRows.map((g) => g.month))];
  const machinePlaceholders = machineIds.map(() => "?").join(",");
  const monthPlaceholders = months.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT DISTINCT p.product_id, p.product_name, p.family, p.standard_cost_eur_per_unit
       FROM production_orders po
       JOIN products p ON p.product_id = po.product_id
       WHERE po.machine_id IN (${machinePlaceholders})
         AND substr(po.planned_start, 1, 7) IN (${monthPlaceholders})`
    )
    .all(...machineIds, ...months) as unknown as ProductCostContext[];
  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
