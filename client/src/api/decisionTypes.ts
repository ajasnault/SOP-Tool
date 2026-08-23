import type { ReconciliationOption } from "./reconciliationTypes";

export type DecisionStatus = "a_faire" | "en_cours" | "fait" | "abandonne";

export interface OptionSnapshot {
  option: ReconciliationOption;
  thresholdPct: number;
}

export interface Decision {
  id: number;
  description: string;
  owner: string | null;
  due_date: string | null;
  status: DecisionStatus;
  site: string | null;
  source_option_title: string | null;
  option_snapshot: OptionSnapshot | null;
  cycle_reference_month: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionInput {
  description: string;
  owner?: string | null;
  due_date?: string | null;
  status?: DecisionStatus;
  site?: string | null;
  source_option_title?: string | null;
  option_snapshot?: OptionSnapshot | null;
  cycle_reference_month?: string | null;
}

export interface DecisionUpdate {
  description?: string;
  owner?: string | null;
  due_date?: string | null;
  status?: DecisionStatus;
}
