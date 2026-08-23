import type { CapacityGapContext, ReconciliationContext } from "./reconciliation.js";

/**
 * Recalcul déterministe des gaps résultants après application d'une option de
 * réconciliation — fait par l'app, jamais par le LLM (voir docs/calculations.md,
 * "Propositions de réconciliation (LLM)"). Le LLM ne fait que désigner QUOI
 * déplacer/dupliquer/fermer (machine, mois, ligne) ; tous les chiffres
 * résultants (heures, %) sont recalculés ici à partir du contexte déjà fourni.
 *
 * Hypothèses de calcul (actées avec l'utilisateur le 2026-08-21) :
 * - lissage_temporel : l'excès du mois source (heures planifiées au-delà du
 *   seuil d'alerte) est déplacé vers le mois cible, dans la limite de la
 *   capacité disponible restante à ce mois cible sur la même machine.
 * - ouverture_ligne : la nouvelle ligne DUPLIQUE à l'identique les machines et
 *   capacités de la ligne de référence désignée (pas de montée en puissance,
 *   pas de coût d'investissement modélisé). Les heures planifiées de la ligne
 *   de référence se répartissent alors sur une capacité disponible doublée.
 * - fermeture_ligne : la ligne source est fermée (plus aucune charge) et ses
 *   heures planifiées sont absorbées intégralement par la ligne cible
 *   désignée, dont la capacité disponible ne change pas — ce qui peut réveler
 *   un nouveau gap sur la ligne cible.
 */

export interface ReconciliationAction {
  action_type: "lissage_temporel" | "ouverture_ligne" | "fermeture_ligne";
  machine_id: string | null;
  from_month: string | null;
  to_month: string | null;
  production_line: string | null;
  site: string | null;
  target_production_line: string | null;
  target_site: string | null;
  months: string[];
}

export interface ResultingGapEntry {
  scope: string;
  month: string;
  /** machine_id précis pour les entrées lissage_temporel (1 machine) ; null pour les entrées agrégées par ligne (ouverture/fermeture, plusieurs machines) — voir client Reconciliation.tsx, l'aperçu heatmap ne s'active que sur les entrées avec machine_id. */
  machine_id: string | null;
  before_utilization_pct: number | null;
  after_utilization_pct: number | null;
  note: string | null;
}

export interface RecalcResult {
  applicable: boolean;
  entries: ResultingGapEntry[];
  unavailable_reason: string | null;
}

export function computeResultingGaps(action: ReconciliationAction, context: ReconciliationContext): RecalcResult {
  switch (action.action_type) {
    case "lissage_temporel":
      return recalcTemporalShift(action, context);
    case "ouverture_ligne":
      return recalcLineOpen(action, context);
    case "fermeture_ligne":
      return recalcLineClose(action, context);
    default:
      return { applicable: false, entries: [], unavailable_reason: "Type d'action non reconnu." };
  }
}

function findMachineMonth(context: ReconciliationContext, machineId: string, month: string): CapacityGapContext | undefined {
  return context.capacityGaps.find((r) => r.machine_id === machineId && r.month === month);
}

function recalcTemporalShift(action: ReconciliationAction, context: ReconciliationContext): RecalcResult {
  if (!action.machine_id || !action.from_month || !action.to_month) {
    return { applicable: false, entries: [], unavailable_reason: "Machine ou mois source/cible non désignés par la proposition." };
  }
  const from = findMachineMonth(context, action.machine_id, action.from_month);
  const to = findMachineMonth(context, action.machine_id, action.to_month);
  if (!from || !to) {
    return {
      applicable: false,
      entries: [],
      unavailable_reason: "Mois source ou cible hors du contexte fourni (hors période gelée non gelée / horizon).",
    };
  }

  const thresholdHours = (context.thresholdPct / 100) * from.available_hours;
  const excess = Math.max(0, from.planned_hours - thresholdHours);
  const headroomAtTarget = Math.max(0, to.available_hours - to.planned_hours);
  const shifted = Math.min(excess, headroomAtTarget);

  const newFromPlanned = from.planned_hours - shifted;
  const newToPlanned = to.planned_hours + shifted;
  const newFromUtil = from.available_hours > 0 ? round2((newFromPlanned / from.available_hours) * 100) : null;
  const newToUtil = to.available_hours > 0 ? round2((newToPlanned / to.available_hours) * 100) : null;

  const shortfallNote = shifted < excess ? `Capacité insuffisante à ${action.to_month} pour absorber tout l'excès (${round2(excess - shifted)} h non résolues).` : null;

  return {
    applicable: true,
    entries: [
      {
        scope: `${from.machine_name} — ${action.from_month}`,
        month: action.from_month,
        machine_id: action.machine_id,
        before_utilization_pct: from.utilization_pct,
        after_utilization_pct: newFromUtil,
        note: null,
      },
      {
        scope: `${to.machine_name} — ${action.to_month}`,
        month: action.to_month,
        machine_id: action.machine_id,
        before_utilization_pct: to.utilization_pct,
        after_utilization_pct: newToUtil,
        note: shortfallNote,
      },
    ],
    unavailable_reason: null,
  };
}

function aggregateLine(context: ReconciliationContext, site: string | null, line: string, month: string): { available: number; planned: number } | null {
  const rows = context.capacityGaps.filter((r) => r.production_line === line && r.month === month && (site ? r.site === site : true));
  if (rows.length === 0) return null;
  return {
    available: round2(rows.reduce((a, r) => a + r.available_hours, 0)),
    planned: round2(rows.reduce((a, r) => a + r.planned_hours, 0)),
  };
}

function recalcLineOpen(action: ReconciliationAction, context: ReconciliationContext): RecalcResult {
  if (!action.production_line || action.months.length === 0) {
    return { applicable: false, entries: [], unavailable_reason: "Ligne de référence ou mois non désignés par la proposition." };
  }
  const entries: ResultingGapEntry[] = [];
  for (const month of action.months) {
    const agg = aggregateLine(context, action.site, action.production_line, month);
    if (!agg) {
      entries.push({
        scope: `${action.production_line} (jumelle) — ${month}`,
        month,
        machine_id: null,
        before_utilization_pct: null,
        after_utilization_pct: null,
        note: "Ligne de référence non trouvée dans le contexte pour ce mois.",
      });
      continue;
    }
    const beforeUtil = agg.available > 0 ? round2((agg.planned / agg.available) * 100) : null;
    const newAvailable = agg.available * 2;
    const afterUtil = newAvailable > 0 ? round2((agg.planned / newAvailable) * 100) : null;
    entries.push({
      scope: `${action.production_line} + jumelle — ${month}`,
      month,
      machine_id: null,
      before_utilization_pct: beforeUtil,
      after_utilization_pct: afterUtil,
      note: "Hypothèse : nouvelle ligne strictement identique (mêmes machines, même capacité) à la ligne de référence.",
    });
  }
  return { applicable: true, entries, unavailable_reason: null };
}

function recalcLineClose(action: ReconciliationAction, context: ReconciliationContext): RecalcResult {
  if (!action.production_line || !action.target_production_line || action.months.length === 0) {
    return { applicable: false, entries: [], unavailable_reason: "Ligne source, ligne cible ou mois non désignés par la proposition." };
  }
  const entries: ResultingGapEntry[] = [];
  for (const month of action.months) {
    const source = aggregateLine(context, action.site, action.production_line, month);
    const target = aggregateLine(context, action.target_site, action.target_production_line, month);
    if (!source || !target) {
      entries.push({
        scope: `${action.production_line} → ${action.target_production_line} — ${month}`,
        month,
        machine_id: null,
        before_utilization_pct: null,
        after_utilization_pct: null,
        note: "Ligne source ou cible non trouvée dans le contexte pour ce mois.",
      });
      continue;
    }
    const newTargetPlanned = target.planned + source.planned;
    const afterUtil = target.available > 0 ? round2((newTargetPlanned / target.available) * 100) : null;
    const beforeUtil = target.available > 0 ? round2((target.planned / target.available) * 100) : null;
    entries.push({
      scope: `${action.production_line} (fermée) — ${month}`,
      month,
      machine_id: null,
      before_utilization_pct: source.available > 0 ? round2((source.planned / source.available) * 100) : null,
      after_utilization_pct: 0,
      note: null,
    });
    entries.push({
      scope: `${action.target_production_line} (absorbe ${action.production_line}) — ${month}`,
      month,
      machine_id: null,
      before_utilization_pct: beforeUtil,
      after_utilization_pct: afterUtil,
      note: afterUtil !== null && afterUtil > context.thresholdPct ? "La consolidation crée un nouveau gap sur la ligne cible." : null,
    });
  }
  return { applicable: true, entries, unavailable_reason: null };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
