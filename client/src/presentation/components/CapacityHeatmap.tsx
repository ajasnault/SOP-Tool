import { useMemo, useState } from "react";
import type { MachineMonthCapacity } from "@/api/types";
import { heatColor } from "@/lib/heatColor";
import { formatMonthFr } from "@/lib/formatMonth";

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

interface CapacityHeatmapProps {
  capacityTrend: MachineMonthCapacity[];
  chartHorizon: string[];
  thresholdPct: number;
  frozenPeriodEndMonth: string;
}

interface HoverInfo {
  machineName: string;
  month: string;
  utilizationPct: number | null;
}

/**
 * Tri par pic d'utilisation décroissant sur l'horizon affiché — pas par
 * famille de process/nom — pour faire remonter les machines les plus
 * contraintes en haut de grille, y compris celles dont le pic se déplace
 * dans le temps. Voir docs/calculations.md ("Heatmap d'évolution de charge").
 */
export function CapacityHeatmap({ capacityTrend, chartHorizon, thresholdPct, frozenPeriodEndMonth }: CapacityHeatmapProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const machines = useMemo(() => {
    const byMachine = new Map<string, { machine_id: string; machine_name: string; byMonth: Map<string, number | null>; peak: number }>();
    for (const row of capacityTrend) {
      let entry = byMachine.get(row.machine_id);
      if (!entry) {
        entry = { machine_id: row.machine_id, machine_name: row.machine_name, byMonth: new Map(), peak: -1 };
        byMachine.set(row.machine_id, entry);
      }
      entry.byMonth.set(row.month, row.utilization_pct);
      if (row.utilization_pct !== null && row.utilization_pct > entry.peak) entry.peak = row.utilization_pct;
    }
    return [...byMachine.values()].sort((a, b) => b.peak - a.peak);
  }, [capacityTrend]);

  const frozenIndex = chartHorizon.indexOf(frozenPeriodEndMonth);

  if (machines.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[15px] font-semibold text-ink">
          Évolution du taux de charge <span className="font-normal text-slate">({chartHorizon.length} mois glissants)</span>
        </div>
        <div className="text-[12px] text-slate">
          {hover ? (
            <span>
              <span className="font-semibold text-ink">{hover.machineName}</span> · {formatMonthFr(hover.month)} ·{" "}
              <span className={hover.utilizationPct !== null && hover.utilizationPct > thresholdPct ? "font-semibold text-red" : "font-semibold text-ink"}>
                {hover.utilizationPct !== null ? `${NUM.format(hover.utilizationPct)} %` : "n/a"}
              </span>
            </span>
          ) : (
            "Survolez une cellule pour le détail"
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div
            className="grid text-[10px]"
            style={{ gridTemplateColumns: `140px repeat(${chartHorizon.length}, minmax(22px, 1fr))` }}
          >
            <div />
            {chartHorizon.map((month, i) => (
              <div
                key={month}
                className={`px-0.5 pb-1 text-center text-slate ${i === frozenIndex ? "border-r-2 border-dashed border-teal" : ""}`}
                title={formatMonthFr(month)}
              >
                {month.slice(5)}
              </div>
            ))}

            {machines.map((m) => (
              <HeatmapRow
                key={m.machine_id}
                machineName={m.machine_name}
                months={chartHorizon}
                byMonth={m.byMonth}
                frozenIndex={frozenIndex}
                thresholdPct={thresholdPct}
                onHoverCell={(month, value) => setHover({ machineName: m.machine_name, month, utilizationPct: value })}
                onLeave={() => setHover(null)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11px] text-slate">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5" style={{ background: "rgb(33,41,92)" }} /> 0 %
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5" style={{ background: "rgb(28,114,147)" }} /> {NUM.format(thresholdPct)} % (seuil)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-red" /> Dépassement réel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-bg-alt" /> Pas de donnée
        </span>
        {frozenIndex >= 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="inline-block h-2.5 border-l-2 border-dashed border-teal" /> Fin de période gelée
          </span>
        )}
      </div>
    </div>
  );
}

function HeatmapRow({
  machineName,
  months,
  byMonth,
  frozenIndex,
  thresholdPct,
  onHoverCell,
  onLeave,
}: {
  machineName: string;
  months: string[];
  byMonth: Map<string, number | null>;
  frozenIndex: number;
  thresholdPct: number;
  onHoverCell: (month: string, value: number | null) => void;
  onLeave: () => void;
}) {
  return (
    <>
      <div className="truncate py-[1px] pr-2 text-[11px] text-ink" title={machineName}>
        {machineName}
      </div>
      {months.map((month, i) => {
        const value = byMonth.get(month) ?? null;
        return (
          <div
            key={month}
            className={`h-[18px] cursor-default ${i === frozenIndex ? "border-r-2 border-dashed border-teal" : ""}`}
            style={{ background: heatColor(value, thresholdPct) }}
            onMouseEnter={() => onHoverCell(month, value)}
            onMouseLeave={onLeave}
          />
        );
      })}
    </>
  );
}
