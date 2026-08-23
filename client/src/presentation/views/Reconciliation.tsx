import { useEffect, useMemo, useState } from "react";
import type { DashboardSummary, MachineMonthCapacity } from "@/api/types";
import type { ReconciliationOption, ReconciliationResponse, RecalcResult } from "@/api/reconciliationTypes";
import { fetchReconciliation, generateReconciliation } from "@/api/client";
import { formatDateTimeFr } from "@/lib/formatMonth";
import { useDecisionDraft } from "../decisionDraftContext";
import { CapacityHeatmap } from "../components/CapacityHeatmap";

const TYPE_LABELS: Record<ReconciliationOption["type"], string> = {
  lissage_temporel: "Lissage temporel",
  ouverture_ligne: "Ouverture de ligne",
  fermeture_ligne: "Fermeture de ligne",
  mixte: "Mixte",
};

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function Reconciliation({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const cycleReferenceMonth = data.cycleReferenceMonth;
  const [response, setResponse] = useState<ReconciliationResponse | null>(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCache(true);
    setError(null);
    fetchReconciliation(site, cycleReferenceMonth)
      .then((r) => {
        if (!cancelled) setResponse(r);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingCache(false);
      });
    return () => {
      cancelled = true;
    };
  }, [site, cycleReferenceMonth]);

  const handleGenerate = () => {
    setGenerating(true);
    setError(null);
    generateReconciliation(site, cycleReferenceMonth)
      .then(setResponse)
      .catch((e) => setError((e as Error).message))
      .finally(() => setGenerating(false));
  };

  const generation = response?.generation ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-12 py-10">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">04 · Réconciliation</div>
          <h1 className="font-serif text-4xl text-navy">Propositions au-delà de la période gelée</h1>
        </div>
        <div className="flex flex-col items-end gap-1">
          {generation && (
            <div className="text-[12px] text-slate">
              Générées le {formatDateTimeFr(generation.generatedAt)} · modèle {generation.model}
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || loadingCache}
            className="rounded-sm bg-navy px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {generating ? "Génération en cours…" : generation ? "Régénérer pour ce cycle" : "Générer les propositions pour ce cycle"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 border border-red bg-red-pale px-4 py-3 text-[13px] text-red">
          Échec de la génération : {error}
        </div>
      )}

      {generating && (
        <div className="mt-6 flex flex-1 items-center justify-center text-[14px] text-slate">
          Appel au modèle en cours — la génération réelle peut prendre jusqu'à une minute, pas de résultat instantané simulé.
        </div>
      )}

      {!generating && loadingCache && <div className="mt-6 text-[14px] text-slate">Chargement…</div>}

      {!generating && !loadingCache && !generation && (
        <div className="mt-10 flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="text-[15px] font-semibold text-ink">Aucune proposition générée pour ce cycle.</div>
          <div className="max-w-md text-[13px] text-slate">
            Cliquez sur « Générer les propositions pour ce cycle » pour obtenir 2 à 3 options de réconciliation, fondées
            uniquement sur les données déjà calculées (gaps de capacité, tendance par ligne, choc de demande) — au-delà de
            la période gelée ({formatFrozenNote(data)}).
          </div>
        </div>
      )}

      {!generating && generation && (
        <>
          <div className="mt-4 border border-border bg-bg-alt px-4 py-3 text-[13px] text-ink">
            <span className="font-semibold text-teal-dark">Recommandation :</span> {generation.recommendationJustification}
          </div>

          <div className="mt-6 grid flex-1 grid-cols-1 gap-5 pb-4 lg:grid-cols-3">
            {generation.options.map((option, i) => (
              <OptionCard key={i} option={option} recommended={i === generation.recommendedOptionIndex} data={data} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatFrozenNote(data: DashboardSummary): string {
  return `gelée jusqu'à ${data.frozenPeriodEndMonth}`;
}

function OptionCard({ option, recommended, data }: { option: ReconciliationOption; recommended: boolean; data: DashboardSummary }) {
  const { setDraft, goToDecisions } = useDecisionDraft();
  const [showPreview, setShowPreview] = useState(false);
  const thresholdPct = data.thresholdPct;

  const createDecision = () => {
    setDraft({
      description: `${option.title} — ${option.description_bullets[0] ?? ""}`,
      sourceOptionTitle: option.title,
      optionSnapshot: option,
      thresholdPct,
    });
    goToDecisions();
  };

  // Seules les entrées de lissage temporel portent un machine_id précis (1 machine) — les
  // entrées agrégées par ligne (ouverture/fermeture) ne peuvent pas se superposer proprement
  // sur une grille par machine, donc l'aperçu ne les couvre pas (voir reconciliationRecalc.ts).
  const previewableEntries = option.resulting_gaps.flatMap((g) => g.entries).filter((e) => e.machine_id !== null);

  const previewTrend = useMemo<MachineMonthCapacity[]>(() => {
    if (previewableEntries.length === 0) return [];
    const affectedMachines = new Set(previewableEntries.map((e) => e.machine_id));
    const overrides = new Map(previewableEntries.map((e) => [`${e.machine_id}|${e.month}`, e.after_utilization_pct]));
    // Ne garder que les machines concernées par cette option (pas les 26 du parc) — l'aperçu doit
    // rester lisible dans une colonne de 3, pas reproduire toute la heatmap de la vue Capacité.
    return data.capacityTrend
      .filter((row) => affectedMachines.has(row.machine_id))
      .map((row) => {
        const override = overrides.get(`${row.machine_id}|${row.month}`);
        return override !== undefined && override !== null ? { ...row, utilization_pct: override } : row;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.capacityTrend, option]);

  return (
    <div className={`flex flex-col border ${recommended ? "border-teal-dark ring-1 ring-teal-dark" : "border-border"} bg-white p-5`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-teal">{TYPE_LABELS[option.type]}</div>
        {recommended && <div className="rounded-sm bg-teal-dark px-2 py-0.5 text-[11px] font-semibold text-white">Recommandée</div>}
      </div>
      <h2 className="mt-1 font-serif text-xl text-navy">{option.title}</h2>

      <ul className="mt-3 list-disc space-y-1 pl-4 text-[13px] text-ink">
        {option.description_bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      {option.months_concerned.length > 0 && (
        <div className="mt-3 text-[12px] text-slate">Mois concernés : {option.months_concerned.join(", ")}</div>
      )}

      {option.missing_data_warning && (
        <div className="mt-3 border border-border bg-bg-alt px-3 py-2 text-[12px] text-slate">⚠ {option.missing_data_warning}</div>
      )}

      {option.resulting_gaps.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate">Gaps résultants (recalculés)</div>
          <div className="mt-2 space-y-2">
            {option.resulting_gaps.map((gap, i) => (
              <ResultingGap key={i} gap={gap} thresholdPct={thresholdPct} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-4">
        <button onClick={createDecision} className="self-start text-[12px] font-semibold text-teal-dark hover:underline">
          + Créer une décision à partir de cette option
        </button>
        {previewableEntries.length > 0 && (
          <button onClick={() => setShowPreview((v) => !v)} className="self-start text-[12px] font-semibold text-teal-dark hover:underline">
            {showPreview ? "Masquer l'aperçu heatmap" : "Voir l'impact sur la heatmap (aperçu)"}
          </button>
        )}
      </div>

      {showPreview && (
        <div className="mt-2 border border-dashed border-teal-dark bg-bg-alt p-4">
          <div className="mb-2 text-[12px] font-semibold text-teal-dark">
            Aperçu simulé — n'écrit rien dans le plan de production réel ; les valeurs "après" viennent du recalcul déjà affiché ci-dessus.
          </div>
          <CapacityHeatmap
            capacityTrend={previewTrend}
            chartHorizon={data.chartHorizon}
            thresholdPct={data.thresholdPct}
            frozenPeriodEndMonth={data.frozenPeriodEndMonth}
          />
        </div>
      )}
    </div>
  );
}

function ResultingGap({ gap, thresholdPct }: { gap: RecalcResult; thresholdPct: number }) {
  if (!gap.applicable) {
    return <div className="text-[12px] italic text-slate">Recalcul non disponible : {gap.unavailable_reason}</div>;
  }
  return (
    <div className="space-y-1">
      {gap.entries.map((entry, i) => {
        const isNewBreach = entry.after_utilization_pct !== null && entry.after_utilization_pct > thresholdPct;
        return (
          <div key={i} className="text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ink">{entry.scope}</span>
              <span className="whitespace-nowrap">
                <span className="text-slate">{formatPct(entry.before_utilization_pct)}</span>
                <span className="text-slate"> → </span>
                <span className={`font-semibold ${isNewBreach ? "text-red" : "text-ink"}`}>{formatPct(entry.after_utilization_pct)}</span>
              </span>
            </div>
            {entry.note && <div className="text-slate">{entry.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

function formatPct(v: number | null): string {
  return v !== null ? `${NUM.format(v)} %` : "n/a";
}
