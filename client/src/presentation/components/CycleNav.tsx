import { formatMonthFr, shiftMonth } from "@/lib/formatMonth";

interface CycleNavProps {
  cycleReferenceMonth: string;
  isCurrentCycle: boolean;
  dataHorizon: string[];
  onNavigate: (month: string | undefined) => void;
}

/** Navigation entre cycles (mois de référence) — discrète, dans le style de la barre de pied. */
export function CycleNav({ cycleReferenceMonth, isCurrentCycle, dataHorizon, onNavigate }: CycleNavProps) {
  const min = dataHorizon[0];
  const max = dataHorizon[dataHorizon.length - 1];
  const canPrev = !min || cycleReferenceMonth > min;
  const canNext = !max || cycleReferenceMonth < max;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onNavigate(shiftMonth(cycleReferenceMonth, -1))}
        disabled={!canPrev}
        aria-label="Cycle précédent"
        className="px-1 text-[15px] text-slate hover:text-navy disabled:pointer-events-none disabled:opacity-30"
      >
        ‹
      </button>
      <span className="min-w-[7.5rem] text-center text-[13px] font-semibold uppercase tracking-wide text-ink">
        {formatMonthFr(cycleReferenceMonth)}
      </span>
      <button
        onClick={() => onNavigate(shiftMonth(cycleReferenceMonth, 1))}
        disabled={!canNext}
        aria-label="Cycle suivant"
        className="px-1 text-[15px] text-slate hover:text-navy disabled:pointer-events-none disabled:opacity-30"
      >
        ›
      </button>
      {isCurrentCycle ? (
        <span className="rounded-sm bg-teal px-2 py-0.5 text-[11px] font-medium text-white">Aujourd'hui</span>
      ) : (
        <button
          onClick={() => onNavigate(undefined)}
          className="rounded-sm border border-teal px-2 py-0.5 text-[11px] font-medium text-teal hover:bg-teal hover:text-white"
        >
          Revenir à aujourd'hui
        </button>
      )}
    </div>
  );
}
