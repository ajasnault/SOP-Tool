export type ReconciliationActionType = "lissage_temporel" | "ouverture_ligne" | "fermeture_ligne";
export type ReconciliationOptionType = ReconciliationActionType | "mixte";

export interface ReconciliationAction {
  action_type: ReconciliationActionType;
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
  /** Précis pour une entrée de lissage temporel (1 machine) ; null pour une entrée agrégée par ligne (ouverture/fermeture, plusieurs machines) — l'aperçu heatmap ne s'active que sur les entrées avec machine_id. */
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

export interface ReconciliationOption {
  title: string;
  type: ReconciliationOptionType;
  description_bullets: string[];
  months_concerned: string[];
  actions: ReconciliationAction[];
  missing_data_warning: string | null;
  resulting_gaps: RecalcResult[];
}

export interface ReconciliationGeneration {
  generatedAt: string;
  model: string;
  options: ReconciliationOption[];
  recommendedOptionIndex: number;
  recommendationJustification: string;
}

export interface ReconciliationResponse {
  cycleReferenceMonth: string;
  site: string | null;
  cached: boolean;
  generation: ReconciliationGeneration | null;
}
