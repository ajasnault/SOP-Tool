import { StateSwitch } from "./StateSwitch";
import { SiteFilter } from "./SiteFilter";
import { CycleNav } from "./CycleNav";
import type { LiveStatus } from "@/api/useLiveDashboard";

interface SlideFooterProps {
  cycleReferenceMonth: string;
  isCurrentCycle: boolean;
  dataHorizon: string[];
  onNavigateCycle: (month: string | undefined) => void;
  slideIndex: number;
  slideCount: number;
  slideLabel: string;
  sites: string[];
  site: string | undefined;
  onSiteChange: (site: string | undefined) => void;
  status: LiveStatus;
  exportHref: string;
}

export function SlideFooter({
  cycleReferenceMonth,
  isCurrentCycle,
  dataHorizon,
  onNavigateCycle,
  slideIndex,
  slideCount,
  slideLabel,
  sites,
  site,
  onSiteChange,
  status,
  exportHref,
}: SlideFooterProps) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-white px-8 py-3">
      <div className="flex items-center gap-4">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-ink">Revue S&OP</span>
        <CycleNav
          cycleReferenceMonth={cycleReferenceMonth}
          isCurrentCycle={isCurrentCycle}
          dataHorizon={dataHorizon}
          onNavigate={onNavigateCycle}
        />
        <div className="flex gap-1.5">
          {Array.from({ length: slideCount }).map((_, i) => (
            <span key={i} className={`h-[3px] w-6 ${i === slideIndex ? "bg-navy" : "bg-border"}`} />
          ))}
        </div>
        <span className="text-[13px] text-slate">
          {slideIndex + 1} / {slideCount} · {slideLabel}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <a href={exportHref} className="text-[12px] text-teal hover:underline">
          Exporter ce cycle (PPTX)
        </a>
        <SiteFilter sites={sites} value={site} onChange={onSiteChange} />
        <StateSwitch status={status} />
      </div>
    </div>
  );
}
