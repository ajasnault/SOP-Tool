import type { DashboardSummary } from "@/api/types";
import { KpiCard, KpiCardUnavailable } from "../components/KpiCard";
import { formatMonthFr } from "@/lib/formatMonth";

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function ExecutiveSummary({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const month = data.cycleReferenceMonth;
  const capacityRows = data.capacity;
  const hrRows = data.hrAvailability;

  const utilRows = capacityRows.filter((r) => r.utilization_pct !== null);
  const avgUtil = utilRows.length > 0 ? utilRows.reduce((s, r) => s + (r.utilization_pct ?? 0), 0) / utilRows.length : null;

  const gapsCurrent = capacityRows.filter((r) => r.utilization_pct !== null && (r.utilization_pct as number) > data.thresholdPct);
  const totalMachines = capacityRows.length;

  const fteTotal = hrRows.reduce((s, r) => s + r.fte_total, 0);
  const fteAvailable = hrRows.reduce((s, r) => s + r.fte_available, 0);
  const hrAvailPct = fteTotal > 0 ? (fteAvailable / fteTotal) * 100 : null;

  const sl = data.serviceLevel;
  const serviceLevelPct = sl.service_level_pct;

  const worstGap = [...gapsCurrent].sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0))[0];

  return (
    <div className="flex h-full flex-col gap-8 px-12 py-10">
      <header className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">01 · Synthèse exécutive</div>
          <h1 className="font-serif text-4xl text-navy">Indicateurs clés du cycle</h1>
        </div>
        <div className="text-right text-[13px] text-slate">
          <div className="font-semibold text-ink">{site ?? "Consolidé — tous sites"}</div>
          {month && <div>Mois de référence : {formatMonthFr(month)}</div>}
        </div>
      </header>

      <div className="grid grid-cols-4 gap-5">
        <KpiCard
          label="Taux de service prévisionnel"
          value={serviceLevelPct !== null ? NUM.format(serviceLevelPct) : "—"}
          unit="%"
          caption={`demande couverte par le plan · ${sl.products_fully_covered}/${sl.products_with_demand} produits à 100 % · cible ${NUM.format(data.serviceLevelTargetPct)} %`}
          barPct={serviceLevelPct}
          tone={serviceLevelPct !== null && serviceLevelPct < data.serviceLevelTargetPct ? "red" : "navy"}
        />
        <KpiCard
          label="Utilisation moyenne capacité"
          value={avgUtil !== null ? NUM.format(avgUtil) : "—"}
          unit="%"
          caption={`parc ${site ? "du site" : "complet"} — ${totalMachines} machine${totalMachines > 1 ? "s" : ""}`}
          barPct={avgUtil}
          tone={avgUtil !== null && avgUtil > data.thresholdPct ? "red" : "navy"}
        />
        <KpiCard
          label="Machines en dépassement de seuil"
          value={`${gapsCurrent.length}`}
          unit={`/ ${totalMachines}`}
          caption={`seuil de sur-utilisation ${NUM.format(data.thresholdPct)} %`}
          barPct={totalMachines > 0 ? (gapsCurrent.length / totalMachines) * 100 : 0}
          tone={gapsCurrent.length > 0 ? "red" : "navy"}
        />
        <KpiCardUnavailable label="Écart demande vs plan" caption="pas d'instantané du cycle précédent" />
      </div>

      <div className="grid grid-cols-2 gap-8 border-t border-border pt-5 text-[15px]">
        <KpiCardUnavailable label="Couverture de stock" caption="nécessite données d'inventaire" />
        <KpiCard
          label="Disponibilité RH"
          value={hrAvailPct !== null ? NUM.format(hrAvailPct) : "—"}
          unit="%"
          caption="FTE nets d'absences — pas de charge réelle (V1)"
          barPct={hrAvailPct}
        />
      </div>

      <div className="flex-1" />

      {worstGap ? (
        <div className="border-l-4 border-red bg-red-pale px-6 py-4">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-red">Point d'attention</div>
          <div className="mt-1 text-[15px] text-ink">
            <span className="font-semibold">{worstGap.machine_name}</span> ({worstGap.site} · {worstGap.production_line}) est
            planifiée à <span className="font-semibold text-red">{NUM.format(worstGap.utilization_pct as number)} %</span> de sa
            capacité disponible sur {formatMonthFr(worstGap.month)} — seuil {NUM.format(data.thresholdPct)} %.
          </div>
        </div>
      ) : (
        <div className="border-l-4 border-border bg-white px-6 py-4 text-[15px] text-slate">
          Aucune machine au-dessus du seuil de {NUM.format(data.thresholdPct)} % ce mois-ci
          {site ? ` sur ${site}` : ""}.
        </div>
      )}
    </div>
  );
}
