import type { DashboardSummary, FlowStep, ProductionFlow, QualitySummary } from "@/api/types";
import { formatMonthFr } from "@/lib/formatMonth";
import { heatColor } from "@/lib/heatColor";

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function siteShort(site: string): string {
  return site.replace(/^Site . - /, "");
}

/** Délai en heures affiché en jours au-delà de 48 h (les libérations se comptent en jours). */
function formatLead(hours: number | null): string {
  if (hours === null) return "—";
  return hours >= 48 ? `${NUM.format(hours / 24)} j` : `${NUM.format(hours)} h`;
}

function StepChip({ step, isBottleneck, thresholdPct }: { step: FlowStep; isBottleneck: boolean; thresholdPct: number }) {
  const pct = step.utilization_pct;
  const over = pct !== null && pct > thresholdPct;
  return (
    <div
      className={`w-[104px] shrink-0 border bg-white px-2 py-1.5 ${isBottleneck ? "border-2 border-navy" : "border-border"}`}
      title={step.machine_names.join(", ") || "Aucune machine de ce type sur le site"}
    >
      <div className="truncate text-[12px] font-semibold text-ink">{step.operation ?? step.machine_type}</div>
      <div className="flex items-baseline justify-between">
        <span className={`text-[13px] font-semibold ${over ? "text-red" : "text-ink"}`}>{pct !== null ? `${NUM.format(pct)} %` : "n/a"}</span>
        {isBottleneck && <span className="text-[10px] font-semibold uppercase tracking-wide text-navy">goulot</span>}
      </div>
      <div className="mt-1 h-[3px] w-full" style={{ backgroundColor: heatColor(pct, thresholdPct) }} />
    </div>
  );
}

function FlowRow({ flow, thresholdPct }: { flow: ProductionFlow; thresholdPct: number }) {
  return (
    <div className="grid grid-cols-[170px_1fr] items-center gap-3 border-b border-border py-2.5">
      <div>
        <div className="text-[13px] font-semibold text-ink">{flow.label}</div>
        <div className="text-[12px] text-slate">
          {flow.product_count} produit{flow.product_count > 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex items-center gap-1 overflow-x-auto">
        {flow.steps.map((step, i) => (
          <div key={step.step_no} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate">→</span>}
            <StepChip step={step} isBottleneck={step.step_no === flow.bottleneck_step_no} thresholdPct={thresholdPct} />
            {step.qc_point && (
              <span
                className="shrink-0 border border-teal px-1 text-[10px] font-semibold uppercase tracking-wide text-teal"
                title={step.qc_point}
              >
                QC
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityPanel({ quality }: { quality: QualitySummary }) {
  if (!quality.hasData) {
    return (
      <div className="text-slate">
        Données qualité non disponibles — importer les résultats de contrôle (<span className="font-mono text-[12px]">quality_results</span>).
      </div>
    );
  }
  const window = `${formatMonthFr(quality.windowMonths[0])} – ${formatMonthFr(quality.windowMonths[quality.windowMonths.length - 1])}`;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-[13px] font-medium text-slate">Lots rejetés (hors spécifications)</div>
        <div className="my-1">
          <span className="font-serif text-4xl text-navy">{quality.rejection_rate_pct !== null ? NUM.format(quality.rejection_rate_pct) : "—"}</span>
          <span className="ml-1 text-lg text-navy">%</span>
        </div>
        <div className="text-[13px] text-slate">
          {INT.format(quality.rejected)} / {INT.format(quality.controlled)} contrôles décidés · {window}
        </div>
        {quality.rejected > 0 && (
          <div className="mt-1 text-[13px] text-slate">
            {INT.format(quality.rejected_units)} unités perdues · {EUR.format(quality.rejected_value_eur)} au coût standard
          </div>
        )}
      </div>

      {quality.byQcPoint.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-slate">
              <th className="py-1 font-medium">Point de contrôle</th>
              <th className="py-1 text-right font-medium">Rejet</th>
              <th className="py-1 text-right font-medium">Délai réel / prévu</th>
            </tr>
          </thead>
          <tbody>
            {quality.byQcPoint.map((p) => (
              <tr key={p.qc_point} className="border-b border-border">
                <td className="py-1 text-ink">{p.qc_point}</td>
                <td className="py-1 text-right text-ink">{p.rejection_rate_pct !== null ? `${NUM.format(p.rejection_rate_pct)} %` : "—"}</td>
                <td className="py-1 text-right text-ink">
                  {formatLead(p.avg_lead_time_hours)} / {formatLead(p.planned_lead_time_hours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {quality.worstProducts.length > 0 && (
        <div>
          <div className="font-semibold text-ink">Produits les plus rejetés</div>
          <div className="mt-1 space-y-0.5 text-[13px] text-slate">
            {quality.worstProducts.map((p) => (
              <div key={p.product_id}>
                <span className="text-ink">{p.product_name}</span> — {p.rejected}/{p.controlled} ({NUM.format(p.rejection_rate_pct)} %)
              </div>
            ))}
          </div>
        </div>
      )}

      {quality.rejectedLots.length > 0 && (
        <div>
          <div className="font-semibold text-ink">Derniers lots rejetés</div>
          <div className="mt-1 space-y-1 text-[12px] text-slate">
            {quality.rejectedLots.slice(0, 5).map((l) => (
              <div key={`${l.lot_id}-${l.qc_point}`}>
                <span className="font-mono text-ink">{l.lot_id}</span> · {l.product_name} · {l.qc_point}
                <br />
                {l.qc_attribute} : <span className="font-semibold text-ink">{l.measured_value !== null ? NUM.format(l.measured_value) : "—"}</span>{" "}
                (spec {l.spec_lower ?? "—"}–{l.spec_upper ?? "—"}) — étapes suivantes annulées
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[12px] text-slate">
        {INT.format(quality.pending)} contrôle{quality.pending > 1 ? "s" : ""} en cours d'analyse au laboratoire (à date d'extraction). Les
        lots planifiés au-delà ne sont pas encore contrôlés : le plan les suppose conformes.
      </div>
    </div>
  );
}

export function FlowQuality({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const month = data.cycleReferenceMonth;
  const sites = [...new Set(data.flows.map((f) => f.site))];

  return (
    <div className="grid h-full grid-cols-[1fr_360px] gap-8 px-12 py-10">
      <div className="flex min-h-0 flex-col">
        <header className="border-b border-border pb-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">04 · Flux & qualité</div>
          <h1 className="font-serif text-4xl text-navy">Flux de production — {formatMonthFr(month)}</h1>
          <div className="mt-1 text-[13px] text-slate">
            Étapes dans l'ordre de la gamme. Le goulot est l'étape la plus chargée du flux : il fixe le débit de toute la chaîne en aval.
          </div>
        </header>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {data.flows.length === 0 && (
            <div className="mt-4 text-[14px] text-slate">
              Aucune gamme importée{site ? ` pour ${site}` : ""} — importer les gammes (<span className="font-mono text-[12px]">routings</span>) pour
              voir les flux.
            </div>
          )}
          {sites.map((s) => (
            <section key={s} className="mt-3">
              {!site && <div className="text-[12px] font-semibold uppercase tracking-wide text-slate">{siteShort(s)}</div>}
              {data.flows
                .filter((f) => f.site === s)
                .map((f) => (
                  <FlowRow key={`${f.site}-${f.label}`} flow={f} thresholdPct={data.thresholdPct} />
                ))}
            </section>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-6 border-t border-border pt-3 text-[12px] text-slate">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 border-2 border-navy" /> Goulot du flux
          </span>
          <span className="flex items-center gap-1.5">
            <span className="border border-teal px-1 text-[10px] font-semibold text-teal">QC</span> Contrôle qualité avant l'étape suivante
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 bg-red" /> Au-dessus du seuil {NUM.format(data.thresholdPct)} %
          </span>
          <span className="ml-auto">Source : gammes (09) × capacité du mois</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-y-auto border-l border-border pl-8 pr-1 text-[14px]">
        <div className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-teal">Contrôle qualité</div>
        <QualityPanel quality={data.quality} />
      </div>
    </div>
  );
}
