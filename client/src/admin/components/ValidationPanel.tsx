import type { ImportReport } from "@/api/adminTypes";

export function ValidationPanel({ report }: { report: ImportReport }) {
  return (
    <div className="flex flex-col gap-4 border-l border-border pl-6">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-slate">Rapport de validation</div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="font-serif text-2xl text-navy">{report.rowsTotal}</div>
          <div className="text-[11px] text-slate">lignes lues</div>
        </div>
        <div>
          <div className="font-serif text-2xl text-navy">{report.rowsImported}</div>
          <div className="text-[11px] text-slate">lignes valides</div>
        </div>
        <div>
          <div className={`font-serif text-2xl ${report.rowsQuarantined > 0 ? "text-red" : "text-navy"}`}>{report.rowsQuarantined}</div>
          <div className="text-[11px] text-slate">en quarantaine</div>
        </div>
      </div>

      {report.errors.length > 0 && (
        <div className="flex flex-col gap-3 overflow-y-auto">
          {Object.entries(groupByField(report.errors)).map(([field, errs]) => (
            <div key={field} className="border-t border-border pt-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[12px] font-semibold text-ink">{field}</span>
                <span className="text-[11px] text-slate">
                  {errs.length} ligne{errs.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="text-[12px] text-slate">{errs[0].message}</div>
              <div className="mt-1 overflow-x-auto whitespace-nowrap rounded-sm bg-bg-alt px-2 py-1 font-mono text-[11px] text-slate">
                ligne {errs[0].rowNumber}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.unmappedFields.length > 0 && (
        <div className="border-t border-border pt-2 text-[12px] text-slate">
          Champs cibles non mappés : <span className="font-mono">{report.unmappedFields.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function groupByField(errors: ImportReport["errors"]): Record<string, ImportReport["errors"]> {
  const groups: Record<string, ImportReport["errors"]> = {};
  for (const err of errors) {
    const key = err.field ?? "(général)";
    (groups[key] ??= []).push(err);
  }
  return groups;
}
