import type { ColumnInfo, EntityInfo } from "@/api/adminTypes";

interface MappingTableProps {
  entity: EntityInfo;
  columns: ColumnInfo[];
  mapping: Record<string, string | null>;
  manualFields: Set<string>;
  confidence: Record<string, number>;
  threshold: number;
  onChange: (column: string, newField: string | null) => void;
}

function fieldForColumn(mapping: Record<string, string | null>, column: string): string | null {
  for (const [field, col] of Object.entries(mapping)) if (col === column) return field;
  return null;
}

export function MappingTable({ entity, columns, mapping, manualFields, confidence, threshold, onChange }: MappingTableProps) {
  return (
    <table className="w-full text-left text-[13px]">
      <thead>
        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-slate">
          <th className="py-2 pr-4 font-medium">Colonne source</th>
          <th className="py-2 pr-4 font-medium">Aperçu (ligne 1)</th>
          <th className="py-2 pr-4 font-medium">Type inféré</th>
          <th className="py-2 pr-4 font-medium">Champ cible</th>
          <th className="py-2 font-medium">Confiance</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => {
          const field = fieldForColumn(mapping, col.column);
          const isManual = field ? manualFields.has(field) : false;
          const score = field ? confidence[field] : undefined;
          const isLow = field !== null && !isManual && score !== undefined && score < threshold;
          const fieldDef = field ? entity.fields.find((f) => f.name === field) : undefined;

          return (
            <tr key={col.column} className={`border-b border-border ${isLow ? "bg-red-pale" : ""}`}>
              <td className="py-2.5 pr-4 font-mono text-ink">{col.column}</td>
              <td className="max-w-[160px] truncate py-2.5 pr-4 text-slate">{col.sampleValue || "—"}</td>
              <td className="py-2.5 pr-4">
                <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] uppercase text-slate">
                  {col.inferredType}
                </span>
              </td>
              <td className="py-2.5 pr-4">
                <select
                  value={field ?? ""}
                  onChange={(e) => onChange(col.column, e.target.value || null)}
                  className={`w-full rounded-sm border bg-white px-2 py-1 font-mono text-[13px] ${isLow ? "border-red text-red" : "border-border text-ink"}`}
                >
                  <option value="">— non mappé —</option>
                  {entity.fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                      {f.required ? " *" : ""}
                    </option>
                  ))}
                </select>
                {fieldDef?.required && !field && <div className="mt-0.5 text-[11px] text-red">requis</div>}
              </td>
              <td className="py-2.5">
                {field === null ? (
                  <span className="text-slate">—</span>
                ) : isManual ? (
                  <span className="text-[12px] font-medium text-teal">manuel</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="h-[3px] w-16 bg-border">
                      <div className={`h-full ${isLow ? "bg-red" : "bg-navy"}`} style={{ width: `${Math.round((score ?? 0) * 100)}%` }} />
                    </div>
                    <span className={`text-[12px] ${isLow ? "text-red" : "text-ink"}`}>{(score ?? 0).toFixed(2)}</span>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
