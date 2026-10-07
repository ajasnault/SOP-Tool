import type { DatabaseSync } from "node:sqlite";
import { capacityForMonth, type MachineMonthCapacity } from "./capacity.js";
import { consolidatedDemand, demandTrend, type DemandRow } from "./demand.js";
import { hrAvailabilityForMonth, type HrAvailabilityRow } from "./hr.js";
import { rollingMonths, monthAfterWeeks } from "./period.js";
import { getThreshold } from "../config.js";
import { serviceLevelForMonth, type ServiceLevelSummary } from "./serviceLevel.js";

export * from "./capacity.js";
export * from "./demand.js";
export * from "./hr.js";
export * from "./serviceLevel.js";
export * from "./period.js";
export { getThreshold, setThreshold } from "../config.js";

const CHART_HORIZON_MONTHS = 18;

/** Tous les mois avec au moins une donnée (forecast ou plan de production) — bornes de navigation entre cycles. */
export function horizonMonths(db: DatabaseSync): string[] {
  const row = db
    .prepare(
      `SELECT MIN(month) AS min_month, MAX(month) AS max_month FROM (
         SELECT month FROM forecasts
         UNION ALL
         SELECT substr(planned_start, 1, 7) AS month FROM production_orders
       )`
    )
    .get() as unknown as { min_month: string | null; max_month: string | null };
  if (!row.min_month || !row.max_month) return [];
  const months: string[] = [];
  let [y, m] = row.min_month.split("-").map(Number);
  const [endY, endM] = row.max_month.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/**
 * Résout le mois de référence du cycle (voir docs/calculations.md, section
 * "Mois de référence du cycle") : `requested` s'il est fourni, sinon le mois
 * calendaire réel actuel — dans les deux cas, borné à `dataHorizon` (pas de
 * navigation vers un mois totalement sans donnée).
 */
export function resolveCycleReferenceMonth(dataHorizon: string[], requested: string | undefined, todayMonth: string): string {
  const candidate = requested ?? todayMonth;
  if (dataHorizon.length === 0) return candidate;
  const min = dataHorizon[0];
  const max = dataHorizon[dataHorizon.length - 1];
  if (candidate < min) return min;
  if (candidate > max) return max;
  return candidate;
}

export interface DashboardSummary {
  /** Tous les mois avec au moins une donnée — bornes de navigation entre cycles. */
  dataHorizon: string[];
  /** 18 mois glissants ancrés sur cycleReferenceMonth — axe des graphiques (demande). */
  chartHorizon: string[];
  /** Mois "YYYY-MM" retenu comme cycle consulté. Voir docs/calculations.md ("Mois de référence du cycle"). */
  cycleReferenceMonth: string;
  /** true si cycleReferenceMonth est le mois calendaire réel actuel (par opposition à un cycle historique consulté manuellement). */
  isCurrentCycle: boolean;
  /** Horodatage (ISO, UTC) du dernier import réussi toutes entités confondues, ou null si aucun import. */
  lastImportAt: string | null;
  thresholdPct: number;
  /** Durée de la période gelée en semaines (seuil `frozen_period_weeks`, défaut 8). */
  frozenPeriodWeeks: number;
  /** Dernier mois (inclus) couvert par la période gelée démarrant à cycleReferenceMonth — repère visuel uniquement, voir docs/calculations.md ("Période gelée"). */
  frozenPeriodEndMonth: string;
  /** Capacité par machine pour cycleReferenceMonth uniquement (scorecard + revue capacité). */
  capacity: MachineMonthCapacity[];
  /** Capacité par machine sur chartHorizon (18 mois glissants) — pour la heatmap d'évolution de charge. */
  capacityTrend: MachineMonthCapacity[];
  /** Disponibilité RH pour cycleReferenceMonth uniquement. */
  hrAvailability: HrAvailabilityRow[];
  /** Taux de service prévisionnel pour cycleReferenceMonth. Voir docs/calculations.md ("Taux de service prévisionnel"). */
  serviceLevel: ServiceLevelSummary;
  /** Cible de taux de service (seuil `service_level_target_pct`, défaut 95) — en dessous, le KPI passe en rouge. */
  serviceLevelTargetPct: number;
  /** Sur chartHorizon (18 mois glissants), mois sans forecast inclus à 0 — pour que l'axe avance visiblement même sans donnée. */
  demandTrend: { month: string; qty_units: number }[];
  demandByFamily: DemandRow[];
}

/**
 * Vue d'ensemble calculée pour un cycle donné. `site` optionnel restreint tous
 * les indicateurs à ce site ; omis = tous sites consolidés. `cycleReferenceMonth`
 * optionnel navigue vers un autre mois que le cycle réel actuel (borné à
 * `dataHorizon`, voir `resolveCycleReferenceMonth`).
 *
 * LIMITE ASSUMÉE (voir docs/calculations.md, "Mois de référence du cycle") :
 * naviguer vers un cycle passé recalcule les données ACTUELLES à travers le
 * prisme de ce mois — ce n'est PAS un instantané figé de ce qui était
 * affiché à l'époque. Si les sources ont été réimportées depuis, la vue d'un
 * ancien cycle reflète l'état présent des données, pas l'état historique
 * réel. Pas d'archivage par cycle dans cette version — choix délibéré.
 */
export function computeDashboard(db: DatabaseSync, site?: string, cycleReferenceMonth?: string): DashboardSummary {
  const dataHorizon = horizonMonths(db);
  const thresholdPct = getThreshold(db, "capacity_utilization_gap_pct", 90);
  const lastImportRow = db.prepare("SELECT MAX(started_at) AS at FROM import_batches").get() as unknown as { at: string | null };
  const lastImportAt = lastImportRow.at;

  const todayMonth = new Date().toISOString().slice(0, 7);
  const referenceMonth = resolveCycleReferenceMonth(dataHorizon, cycleReferenceMonth, todayMonth);
  const isCurrentCycle = referenceMonth === todayMonth;

  const capacity = capacityForMonth(db, referenceMonth, site);
  const hrAvailability = hrAvailabilityForMonth(db, referenceMonth, site);
  const serviceLevel = serviceLevelForMonth(db, referenceMonth, site);
  const serviceLevelTargetPct = getThreshold(db, "service_level_target_pct", 95);

  const chartHorizon = rollingMonths(referenceMonth, CHART_HORIZON_MONTHS);
  // ~20ms mesurées pour 18 mois × 26 machines (toutes) sur le jeu de test —
  // négligeable, cf. docs/calculations.md ("Heatmap d'évolution de charge").
  const capacityTrend = chartHorizon.flatMap((month) => capacityForMonth(db, month, site));

  const frozenPeriodWeeks = getThreshold(db, "frozen_period_weeks", 8);
  const frozenPeriodEndMonth = monthAfterWeeks(referenceMonth, frozenPeriodWeeks);

  const trendRaw = demandTrend(db, site);
  const trendByMonth = new Map(trendRaw.map((r) => [r.month, r.qty_units]));
  const paddedTrend = chartHorizon.map((month) => ({ month, qty_units: trendByMonth.get(month) ?? 0 }));

  const familyRaw = consolidatedDemand(db, "family", "month", site);
  const families = [...new Set(familyRaw.map((r) => r.group))];
  const familyByKey = new Map(familyRaw.map((r) => [`${r.group}|${r.period}`, r.qty_units]));
  const paddedByFamily = chartHorizon.flatMap((month) =>
    families.map((group) => ({ group, period: month, qty_units: familyByKey.get(`${group}|${month}`) ?? 0 }))
  );

  return {
    dataHorizon,
    chartHorizon,
    cycleReferenceMonth: referenceMonth,
    isCurrentCycle,
    lastImportAt,
    thresholdPct,
    frozenPeriodWeeks,
    frozenPeriodEndMonth,
    capacity,
    capacityTrend,
    hrAvailability,
    serviceLevel,
    serviceLevelTargetPct,
    demandTrend: paddedTrend,
    demandByFamily: paddedByFamily,
  };
}
