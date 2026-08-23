import { createContext, useContext } from "react";
import type { ReconciliationOption } from "@/api/reconciliationTypes";

/**
 * Permet à la vue Réconciliation de pré-remplir une décision (depuis une
 * option) et de basculer vers la vue Décisions, sans coupler leurs props ni
 * toucher aux vues qui n'ont rien à voir avec ça (Synthèse, Demande, Capacité).
 * `optionSnapshot` porte l'option complète (avec gaps résultants) pour que la
 * décision créée puisse plus tard générer un export "Plan de lissage".
 */
export interface DecisionDraft {
  description: string;
  sourceOptionTitle: string;
  optionSnapshot: ReconciliationOption;
  thresholdPct: number;
}

export interface DecisionDraftContextValue {
  draft: DecisionDraft | null;
  setDraft: (d: DecisionDraft | null) => void;
  goToDecisions: () => void;
}

export const DecisionDraftContext = createContext<DecisionDraftContextValue | null>(null);

export function useDecisionDraft(): DecisionDraftContextValue {
  const ctx = useContext(DecisionDraftContext);
  if (!ctx) throw new Error("useDecisionDraft doit être utilisé sous DecisionDraftContext.Provider");
  return ctx;
}
