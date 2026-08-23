interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  caption: string;
  barPct?: number | null;
  tone?: "navy" | "red";
}

export function KpiCard({ label, value, unit, caption, barPct, tone = "navy" }: KpiCardProps) {
  const valueColor = tone === "red" ? "text-red" : "text-navy";
  const barColor = tone === "red" ? "bg-red" : "bg-navy";

  return (
    <div className="flex flex-col justify-between rounded-sm border border-border bg-white px-6 py-5 min-h-[150px]">
      <div className="text-[13px] font-medium text-slate">{label}</div>
      <div className="my-1">
        <span className={`font-serif text-4xl ${valueColor}`}>{value}</span>
        {unit && <span className={`ml-1 text-lg ${valueColor}`}>{unit}</span>}
      </div>
      <div className="text-[13px] text-slate">{caption}</div>
      <div className="mt-3 h-[3px] w-full bg-border">
        {barPct !== undefined && barPct !== null && (
          <div className={`h-full ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, barPct))}%` }} />
        )}
      </div>
    </div>
  );
}

export function KpiCardUnavailable({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex flex-col justify-between rounded-sm border border-border bg-white px-6 py-5 min-h-[150px]">
      <div className="text-[13px] font-medium text-slate">{label}</div>
      <div className="my-1">
        <span className="font-serif text-4xl text-border">—</span>
      </div>
      <div className="text-[13px] text-slate">donnée non disponible — {caption}</div>
      <div className="mt-3 h-[3px] w-full bg-border" />
    </div>
  );
}
