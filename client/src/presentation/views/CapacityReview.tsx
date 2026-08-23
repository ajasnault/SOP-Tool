import type { DashboardSummary, MachineMonthCapacity } from "@/api/types";
import { formatMonthFr } from "@/lib/formatMonth";
import { CapacityHeatmap } from "../components/CapacityHeatmap";

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const SCALE_MAX = 120; // % — échelle commune fixe, seuil aligné dessus (cf. maquette)

function barColor(pct: number, threshold: number): string {
  if (pct > threshold) return "bg-red";
  if (pct >= 75) return "bg-teal";
  return "bg-navy";
}

export function CapacityReview({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const month = data.cycleReferenceMonth;
  const rows = data.capacity.slice().sort((a, b) => (b.utilization_pct ?? -1) - (a.utilization_pct ?? -1));

  const withUtil = rows.filter((r): r is MachineMonthCapacity & { utilization_pct: number } => r.utilization_pct !== null);
  const avg = withUtil.length > 0 ? withUtil.reduce((s, r) => s + r.utilization_pct, 0) / withUtil.length : null;
  const overThreshold = withUtil.filter((r) => r.utilization_pct > data.thresholdPct);
  const tension = withUtil.filter((r) => r.utilization_pct >= 75 && r.utilization_pct <= data.thresholdPct);

  const thresholdLeftPct = Math.min(100, (data.thresholdPct / SCALE_MAX) * 100);

  return (
    <div className="grid h-full grid-cols-[1fr_340px] gap-8 px-12 py-10">
      <div className="flex flex-col overflow-y-auto pr-1">
        <header className="border-b border-border pb-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">03 · Revue de la capacité</div>
          <h1 className="font-serif text-4xl text-navy">
            Utilisation planifiée — {formatMonthFr(month)}
          </h1>
        </header>

        <div className="mt-4 max-h-[220px] shrink-0 space-y-4 overflow-y-auto pr-2">
          {rows.length === 0 && <div className="text-[14px] text-slate">Aucune machine{site ? ` sur ${site}` : ""}.</div>}
          {rows.map((r) => {
            const pct = r.utilization_pct;
            return (
              <div key={r.machine_id} className="grid grid-cols-[220px_1fr_70px] items-center gap-4">
                <div>
                  <div className="text-[14px] font-semibold text-ink">{r.machine_name}</div>
                  <div className="text-[12px] text-slate">
                    {r.site?.replace("Site ", "").replace(/ - .*/, "")} · {r.production_line ?? "—"}
                  </div>
                </div>
                <div className="relative h-3 bg-bg-alt">
                  {pct !== null && (
                    <div className={`h-full ${barColor(pct, data.thresholdPct)}`} style={{ width: `${Math.min(100, (pct / SCALE_MAX) * 100)}%` }} />
                  )}
                  <div className="absolute inset-y-0 border-l border-navy" style={{ left: `${thresholdLeftPct}%` }} />
                </div>
                <div className={`text-right text-[14px] font-semibold ${pct !== null && pct > data.thresholdPct ? "text-red" : "text-ink"}`}>
                  {pct !== null ? `${NUM.format(pct)} %` : "n/a"}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-6 border-t border-border pt-3 text-[12px] text-slate">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 border-l-2 border-navy" /> Seuil {NUM.format(data.thresholdPct)} %
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 bg-red" /> Dépassement
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 bg-teal" /> Tension modérée (75–{NUM.format(data.thresholdPct)} %)
          </span>
          <span className="ml-auto">Source : production_orders (04) × capacité disponible machines (02)</span>
        </div>

        <CapacityHeatmap
          capacityTrend={data.capacityTrend}
          chartHorizon={data.chartHorizon}
          thresholdPct={data.thresholdPct}
          frozenPeriodEndMonth={data.frozenPeriodEndMonth}
        />
      </div>

      <div className="flex flex-col gap-5 border-l border-border pl-8 text-[14px]">
        <div>
          <div className="font-semibold text-ink">Moyenne des {rows.length} lignes affichées : {avg !== null ? NUM.format(avg) : "—"} %</div>
          <div className="mt-1 text-slate">
            Utilisation moyenne du parc{site ? ` (${site})` : ""} sur {formatMonthFr(month)}.
          </div>
        </div>

        {overThreshold.length > 0 ? (
          <div>
            <div className="font-semibold text-red">
              {overThreshold.length} ligne{overThreshold.length > 1 ? "s" : ""} en dépassement
            </div>
            <div className="mt-1 text-slate">{overThreshold.map((r) => r.machine_name).join(", ")}</div>
          </div>
        ) : (
          <div className="text-slate">Aucune ligne en dépassement.</div>
        )}

        {tension.length > 0 && (
          <div>
            <div className="font-semibold text-teal">Lignes en tension modérée à surveiller</div>
            <div className="mt-1 text-slate">{tension.map((r) => r.machine_name).join(", ")}</div>
          </div>
        )}

        <div className="mt-auto text-[12px] text-slate">
          Contraintes intégrées : maintenance préventive (05) et arrêts programmés (06) déduits de la capacité disponible.
        </div>
      </div>
    </div>
  );
}
