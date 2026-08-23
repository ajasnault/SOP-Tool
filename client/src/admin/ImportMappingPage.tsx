import { useEffect, useState } from "react";
import { fetchEntities } from "@/api/adminClient";
import { importFile, confirmImport } from "@/api/adminClient";
import type { EntityInfo, ImportReport } from "@/api/adminTypes";
import { MappingTable } from "./components/MappingTable";
import { ValidationPanel } from "./components/ValidationPanel";

type Step = "pick" | "mapping" | "done";

export function ImportMappingPage() {
  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [threshold, setThreshold] = useState(0.75);
  const [entityName, setEntityName] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("pick");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [manualFields, setManualFields] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEntities().then((list) => {
      setEntities(list);
      if (list.length > 0) setEntityName(list[0].entity);
    });
    fetch("/api/thresholds")
      .then((r) => r.json())
      .then((t) => setThreshold(t.mapping_confidence_min ?? 0.75));
  }, []);

  const entity = entities.find((e) => e.entity === entityName);

  async function handleImport() {
    if (!file || !entityName) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importFile(entityName, file);
      setReport(r);
      if (r.status === "pending_confirmation") {
        setMapping(r.mapping);
        setManualFields(new Set());
        setStep("mapping");
      } else {
        setStep("done");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMappingChange(column: string, newField: string | null) {
    if (!file) return;
    const next: Record<string, string | null> = { ...mapping };
    for (const f of Object.keys(next)) if (next[f] === column) next[f] = null;
    if (newField) next[newField] = column;
    setMapping(next);

    const nextManual = new Set(manualFields);
    if (newField) nextManual.add(newField);
    setManualFields(nextManual);

    setBusy(true);
    try {
      const preview = await confirmImport(entityName, file, next, [...nextManual], true);
      setReport(preview);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await confirmImport(entityName, file, mapping, [...manualFields], false);
      setReport(r);
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("pick");
    setFile(null);
    setReport(null);
    setMapping({});
    setManualFields(new Set());
    setError(null);
  }

  const blocked = (report?.lowConfidenceFields?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-8 py-5">
        <div className="text-[12px] text-slate">Administration / Import &amp; mapping</div>
        <h1 className="font-serif text-3xl text-navy">Import — correspondance des colonnes</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && <div className="mb-4 border-l-4 border-red bg-red-pale px-4 py-2 text-[13px] text-red">{error}</div>}

        {step === "pick" && (
          <div className="max-w-lg space-y-4">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-slate">Entité cible</label>
              <select
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                className="w-full rounded-sm border border-border bg-white px-3 py-2 text-[14px]"
              >
                {entities.map((e) => (
                  <option key={e.entity} value={e.entity}>
                    {e.entity}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-slate">Fichier (CSV, XLSX, JSON)</label>
              <input
                type="file"
                accept=".csv,.xlsx,.json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-[13px]"
              />
            </div>
            <button
              onClick={handleImport}
              disabled={!file || busy}
              className="rounded-sm bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
            >
              {busy ? "Import en cours…" : "Importer"}
            </button>
          </div>
        )}

        {step === "mapping" && report && entity && (
          <div className="pb-24">
            <div className="mb-5 border-l-4 border-red bg-red-pale px-4 py-3">
              <div className="text-[13px] font-semibold text-red">
                Import bloqué — {report.lowConfidenceFields?.length ?? 0} colonne(s) sous le seuil de confiance
              </div>
              <div className="mt-1 text-[13px] text-ink">
                Entité <span className="font-mono">{entity.entity}</span> · fichier{" "}
                <span className="font-mono">{file?.name}</span> · {report.columns.length} colonnes source. Aucune ligne écrite en
                base tant que le mapping n'est pas confirmé.
              </div>
            </div>

            <div className="grid grid-cols-[1fr_300px] gap-8">
              <div className="overflow-x-auto">
                <MappingTable
                  entity={entity}
                  columns={report.columns}
                  mapping={mapping}
                  manualFields={manualFields}
                  confidence={report.confidence}
                  threshold={threshold}
                  onChange={handleMappingChange}
                />
                <div className="mt-3 text-[12px] text-slate">
                  Seuil de confiance <span className="font-mono">mapping_confidence_min</span> = {threshold}. Un mapping modifié à
                  la main passe en confiance "manuel" et sera mémorisé pour cette signature.
                </div>
              </div>
              <ValidationPanel report={report} />
            </div>
          </div>
        )}

        {step === "done" && report && (
          <div className="max-w-3xl space-y-6">
            <div className={`border-l-4 px-4 py-3 ${report.rowsQuarantined > 0 ? "border-teal bg-bg-alt" : "border-navy bg-bg-alt"}`}>
              <div className="text-[13px] font-semibold text-ink">
                Import terminé — {report.rowsImported} ligne{report.rowsImported > 1 ? "s" : ""} importée
                {report.rowsImported > 1 ? "s" : ""}
                {report.rowsQuarantined > 0 ? `, ${report.rowsQuarantined} en quarantaine` : ""}.
              </div>
              <div className="mt-1 text-[12px] text-slate">
                Mapping : <span className="font-mono">{report.mappingSource}</span>
              </div>
            </div>
            {report.errors.length > 0 && <ValidationPanel report={report} />}
            <button onClick={reset} className="rounded-sm border border-border px-4 py-2 text-[13px] font-medium text-ink">
              Nouvel import
            </button>
          </div>
        )}
      </div>

      {step === "mapping" && (
        <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-white px-8 py-3">
          <div className="text-[12px] text-slate">
            {report?.rowsTotal ?? 0} lignes lues · {report?.rowsImported ?? 0} valides · {report?.rowsQuarantined ?? 0} en
            quarantaine
          </div>
          <div className="flex gap-3">
            <button onClick={reset} className="rounded-sm border border-border px-4 py-2 text-[13px] font-medium text-ink">
              Annuler l'import
            </button>
            <button
              onClick={handleConfirm}
              disabled={blocked || busy}
              className="rounded-sm bg-navy px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
            >
              {busy ? "…" : "Confirmer le mapping et importer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
