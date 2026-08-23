import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardSummary } from "@/api/types";
import { formatMonthFr } from "@/lib/formatMonth";

const NUM = new Intl.NumberFormat("fr-FR");
const FAMILY_COLORS = ["#21295C", "#0A4A73", "#065A82", "#1C7293", "#6E9FB4", "#A9CBD9"];

function quarterOf(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${year} T${Math.ceil(m / 3)}`;
}

export function DemandReview({ data, site }: { data: DashboardSummary; site: string | undefined }) {
  const trend = data.demandTrend;
  const first = trend[0]?.qty_units;
  const last = trend[trend.length - 1]?.qty_units;
  const trendPct = first ? ((last - first) / first) * 100 : null;
  const peak = trend.reduce((max, r) => (r.qty_units > (max?.qty_units ?? -Infinity) ? r : max), trend[0]);
  const low = trend.reduce((min, r) => (r.qty_units < (min?.qty_units ?? Infinity) ? r : min), trend[0]);

  const families = [...new Set(data.demandByFamily.map((r) => r.group))].sort();
  const quarterMap = new Map<string, Record<string, number>>();
  for (const row of data.demandByFamily) {
    const q = quarterOf(row.period);
    if (!quarterMap.has(q)) quarterMap.set(q, {});
    const bucket = quarterMap.get(q)!;
    bucket[row.group] = (bucket[row.group] ?? 0) + row.qty_units;
  }
  const quarterData = [...quarterMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, values]) => ({ quarter, ...values }));

  return (
    <div className="grid h-full grid-cols-[1fr_340px] gap-8 px-12 py-10">
      <div className="flex flex-col gap-8 overflow-y-auto">
        <header className="border-b border-border pb-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-teal">02 · Revue de la demande</div>
          <h1 className="font-serif text-4xl text-navy">Forecast consensus — {site ?? "tous sites"}</h1>
        </header>

        <div className="h-[260px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ left: -10 }}>
              <CartesianGrid stroke="#EDEFF3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#5B6480" }} axisLine={{ stroke: "#D9DCE3" }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#5B6480" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => NUM.format(v)} labelFormatter={(m: string) => formatMonthFr(m)} />
              {trend.some((r) => r.month === data.frozenPeriodEndMonth) && (
                <ReferenceArea x1={data.cycleReferenceMonth} x2={data.frozenPeriodEndMonth} fill="#1C7293" fillOpacity={0.07} />
              )}
              <Line type="monotone" dataKey="qty_units" stroke="#21295C" strokeWidth={2} dot={false} />
              {trend.some((r) => r.month === data.frozenPeriodEndMonth) && (
                <ReferenceLine
                  x={data.frozenPeriodEndMonth}
                  stroke="#1C7293"
                  strokeDasharray="3 3"
                  label={{ value: "Période gelée", position: "insideTopLeft", fontSize: 10, fill: "#1C7293" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <div className="mb-3 text-[15px] font-semibold text-ink">
            Répartition par famille <span className="font-normal text-slate">(k unités / trimestre)</span>
          </div>
          <div className="flex flex-wrap gap-3 text-[12px] text-slate">
            {families.map((f, i) => (
              <span key={f} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5" style={{ background: FAMILY_COLORS[i % FAMILY_COLORS.length] }} />
                {f}
              </span>
            ))}
          </div>
          <div className="h-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={quarterData} margin={{ left: -10 }}>
                <CartesianGrid stroke="#EDEFF3" vertical={false} />
                <XAxis dataKey="quarter" tick={{ fontSize: 12, fill: "#5B6480" }} axisLine={{ stroke: "#D9DCE3" }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#5B6480" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => NUM.format(v)} />
                {families.map((f, i) => (
                  <Bar key={f} dataKey={f} stackId="fam" fill={FAMILY_COLORS[i % FAMILY_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 border-l border-border pl-8 text-[14px]">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate">Lecture</div>
        {trendPct !== null && (
          <div>
            <div className="font-semibold text-ink">
              Tendance {trendPct >= 0 ? "haussière" : "baissière"} : {trendPct >= 0 ? "+" : ""}
              {trendPct.toFixed(0)} %
            </div>
            <div className="mt-1 text-slate">
              Entre {formatMonthFr(trend[0]?.month)} et {formatMonthFr(trend[trend.length - 1]?.month)}, demande consolidée
              {site ? ` sur ${site}` : ""}.
            </div>
          </div>
        )}
        {peak && (
          <div>
            <div className="font-semibold text-ink">Pic : {formatMonthFr(peak.month)}</div>
            <div className="mt-1 text-slate">{NUM.format(peak.qty_units)} unités.</div>
          </div>
        )}
        {low && (
          <div>
            <div className="font-semibold text-ink">Creux : {formatMonthFr(low.month)}</div>
            <div className="mt-1 text-slate">{NUM.format(low.qty_units)} unités.</div>
          </div>
        )}
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-teal">
            <span className="inline-block h-2.5 w-2.5" style={{ background: "#1C7293", opacity: 0.4 }} />
            Période gelée : {data.frozenPeriodWeeks} sem.
          </div>
          <div className="mt-1 text-slate">
            Repère organisationnel de {formatMonthFr(data.cycleReferenceMonth)} à {formatMonthFr(data.frozenPeriodEndMonth)} —
            n'empêche aucune écriture.
          </div>
        </div>
        <div className="mt-auto text-[12px] text-slate">
          Consensus par mois — source : forecasts (03), {data.chartHorizon.length} mois glissants depuis {formatMonthFr(data.cycleReferenceMonth)}.
        </div>
      </div>
    </div>
  );
}
