import { useEffect, useMemo, useState } from "react";
import { fetchSites } from "@/api/client";
import { useLiveDashboard } from "@/api/useLiveDashboard";
import { apiUrl } from "@/api/apiBase";
import { ExecutiveSummary } from "./views/ExecutiveSummary";
import { DemandReview } from "./views/DemandReview";
import { CapacityReview } from "./views/CapacityReview";
import { FlowQuality } from "./views/FlowQuality";
import { Reconciliation } from "./views/Reconciliation";
import { Decisions } from "./views/Decisions";
import { SlideFooter } from "./components/SlideFooter";
import { formatDateTimeFr } from "@/lib/formatMonth";
import { DecisionDraftContext, type DecisionDraft } from "./decisionDraftContext";

/** URL d'export construite sur le cycle réellement affiché (`data.cycleReferenceMonth`, résolu côté serveur), pas sur l'état local (qui peut valoir "undefined = aujourd'hui" et dériver d'ici l'export). */
function exportUrl(site: string | undefined, cycleReferenceMonth: string): string {
  const params = new URLSearchParams({ cycleReferenceMonth });
  if (site) params.set("site", site);
  return apiUrl(`/api/export/pptx?${params.toString()}`);
}

const SLIDES = [
  { label: "Synthèse", Component: ExecutiveSummary },
  { label: "Demande", Component: DemandReview },
  { label: "Capacité", Component: CapacityReview },
  { label: "Flux & qualité", Component: FlowQuality },
  { label: "Réconciliation", Component: Reconciliation },
  { label: "Décisions", Component: Decisions },
];
const DECISIONS_SLIDE_INDEX = SLIDES.findIndex((s) => s.label === "Décisions");

export function PresentationApp() {
  const [slideIndex, setSlideIndex] = useState(0);
  const [site, setSite] = useState<string | undefined>(undefined);
  const [sites, setSites] = useState<string[]>([]);
  // undefined = cycle courant réel (résolu côté serveur) ; une valeur explicite = cycle historique consulté.
  const [cycleReferenceMonth, setCycleReferenceMonth] = useState<string | undefined>(undefined);
  const { data, status } = useLiveDashboard(site, cycleReferenceMonth);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(null);
  const decisionDraftValue = useMemo(
    () => ({ draft: decisionDraft, setDraft: setDecisionDraft, goToDecisions: () => setSlideIndex(DECISIONS_SLIDE_INDEX) }),
    [decisionDraft]
  );

  useEffect(() => {
    fetchSites().then(setSites).catch(() => setSites([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setSlideIndex((i) => Math.min(SLIDES.length - 1, i + 1));
      if (e.key === "ArrowLeft") setSlideIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { Component } = SLIDES[slideIndex];

  return (
    <DecisionDraftContext.Provider value={decisionDraftValue}>
      <div className="fixed inset-0 flex flex-col bg-bg">
        {status === "error" && (
          <div className="border-b-2 border-red bg-red-pale px-8 py-2 text-center text-[13px] font-medium text-red">
            Connexion aux données interrompue — dernières valeurs connues affichées ci-dessous.
          </div>
        )}

        <div className={`relative flex-1 overflow-hidden ${status === "error" ? "ring-1 ring-inset ring-red" : ""}`}>
          {!data ? (
            <div className="flex h-full items-center justify-center text-[15px] text-slate">Chargement du dashboard…</div>
          ) : (
            <Component data={data} site={site} />
          )}

          {status === "refreshing" && data && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
              <div className="rounded-sm border border-border bg-white px-4 py-2 text-[13px] text-slate shadow-sm">
                Recalcul en cours…
              </div>
            </div>
          )}

          {slideIndex > 0 && (
            <button
              onClick={() => setSlideIndex((i) => i - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-3xl text-slate hover:text-navy"
              aria-label="Vue précédente"
            >
              ‹
            </button>
          )}
          {slideIndex < SLIDES.length - 1 && (
            <button
              onClick={() => setSlideIndex((i) => i + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-3xl text-slate hover:text-navy"
              aria-label="Vue suivante"
            >
              ›
            </button>
          )}
        </div>

        {data && (
          <SlideFooter
            cycleReferenceMonth={data.cycleReferenceMonth}
            isCurrentCycle={data.isCurrentCycle}
            dataHorizon={data.dataHorizon}
            onNavigateCycle={setCycleReferenceMonth}
            slideIndex={slideIndex}
            slideCount={SLIDES.length}
            slideLabel={SLIDES[slideIndex].label}
            sites={sites}
            site={site}
            onSiteChange={setSite}
            status={status}
            exportHref={exportUrl(site, data.cycleReferenceMonth)}
          />
        )}

        {data?.lastImportAt && (
          <div className="absolute right-8 top-2 text-[11px] text-slate">Données au {formatDateTimeFr(data.lastImportAt)}</div>
        )}
      </div>
    </DecisionDraftContext.Provider>
  );
}
