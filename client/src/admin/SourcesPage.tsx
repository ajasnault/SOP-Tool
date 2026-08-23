import { useEffect, useState } from "react";
import { fetchEntities, fetchSources, fetchThresholds, retrySource } from "@/api/adminClient";
import type { EntityInfo, SourceInfo, Thresholds } from "@/api/adminTypes";
import { formatRelative, hoursSince } from "@/lib/relativeTime";

function importOrder(entities: EntityInfo[]): EntityInfo[][] {
  const levelOf = new Map<string, number>();
  const byName = new Map(entities.map((e) => [e.entity, e]));
  function resolve(name: string, seen = new Set<string>()): number {
    if (levelOf.has(name)) return levelOf.get(name)!;
    if (seen.has(name)) return 0; // cycle de sécurité, ne devrait pas arriver
    seen.add(name);
    const entity = byName.get(name);
    const deps = entity?.dependsOn ?? [];
    const level = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => resolve(d, seen)));
    levelOf.set(name, level);
    return level;
  }
  for (const e of entities) resolve(e.entity);
  const maxLevel = Math.max(0, ...[...levelOf.values()]);
  const groups: EntityInfo[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const e of entities) groups[levelOf.get(e.entity)!].push(e);
  return groups.filter((g) => g.length > 0);
}

export function SourcesPage() {
  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [busyEntity, setBusyEntity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [e, s, t] = await Promise.all([fetchEntities(), fetchSources(), fetchThresholds()]);
    setEntities(e);
    setSources(s);
    setThresholds(t);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleRetry(entity: string) {
    setBusyEntity(entity);
    setError(null);
    try {
      await retrySource(entity);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyEntity(null);
    }
  }

  const staleHours = thresholds?.source_staleness_warning_hours ?? 24;
  const connected = sources.filter((s) => s.lastImport?.status === "success").length;
  const failed = sources.filter((s) => s.lastImport?.status === "failed");
  const stale = sources.filter((s) => s.lastImport?.status === "success" && hoursSince(s.lastImport.startedAt) > staleHours);
  const totalQuarantine = sources.reduce((sum, s) => sum + (s.lastImport?.rowsQuarantined ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-8 py-5">
        <div>
          <div className="text-[12px] text-slate">Administration / Sources connectées</div>
          <h1 className="font-serif text-3xl text-navy">Sources de données connectées</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && <div className="mb-4 border-l-4 border-red bg-red-pale px-4 py-2 text-[13px] text-red">{error}</div>}

        <div className="mb-8 grid grid-cols-4 gap-5">
          <StatCard label="Sources connectées" value={`${connected}`} caption={`sur ${sources.length} entités métier`} />
          <StatCard label="En échec" value={`${failed.length}`} caption={failed.map((s) => s.entity).join(", ") || "—"} tone={failed.length > 0 ? "red" : "navy"} />
          <StatCard
            label="Données périmées"
            value={`${stale.length}`}
            caption={`seuil ${staleHours} h`}
            tone={stale.length > 0 ? "red" : "navy"}
          />
          <StatCard label="Lignes en quarantaine" value={`${totalQuarantine}`} caption="dernier import de chaque source" tone={totalQuarantine > 0 ? "red" : "navy"} />
        </div>

        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-slate">
              <th className="py-2 pr-4 font-medium">Entité</th>
              <th className="py-2 pr-4 font-medium">Fichier source</th>
              <th className="py-2 pr-4 font-medium">Dernier import</th>
              <th className="py-2 pr-4 font-medium">Lignes</th>
              <th className="py-2 pr-4 font-medium">Quarantaine</th>
              <th className="py-2 pr-4 font-medium">Fraîcheur</th>
              <th className="py-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.entity} className="border-b border-border">
                <td className="py-2.5 pr-4 font-mono text-ink">{s.entity}</td>
                <td className="max-w-[220px] truncate py-2.5 pr-4 font-mono text-[12px] text-slate">
                  {s.lastImport?.sourceFilename ?? "—"}
                </td>
                <td className="py-2.5 pr-4 text-slate">{s.lastImport ? s.lastImport.startedAt : "jamais"}</td>
                <td className="py-2.5 pr-4 text-ink">{s.currentRowCount}</td>
                <td className={`py-2.5 pr-4 ${(s.lastImport?.rowsQuarantined ?? 0) > 0 ? "text-red" : "text-ink"}`}>
                  {s.lastImport?.rowsQuarantined ?? "—"}
                </td>
                <td className="py-2.5 pr-4 text-slate">{s.lastImport ? formatRelative(s.lastImport.startedAt) : "—"}</td>
                <td className="py-2.5">
                  <StatusBadge source={s} staleHours={staleHours} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {failed.length > 0 && (
          <div className="mt-6 space-y-3">
            {failed.map((s) => (
              <div key={s.entity} className="border-l-4 border-red bg-red-pale px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-red">
                    {s.lastImport?.sourceFilename ?? s.entity} — import du {s.lastImport?.startedAt} en échec
                  </div>
                  <button
                    onClick={() => handleRetry(s.entity)}
                    disabled={!s.lastImport?.retryable || busyEntity === s.entity}
                    className="rounded-sm border border-red px-3 py-1 text-[12px] font-medium text-red disabled:opacity-40"
                    title={s.lastImport?.retryable ? "" : "Fichier non disponible — réimporte depuis Import & mapping"}
                  >
                    {busyEntity === s.entity ? "…" : "Relancer"}
                  </button>
                </div>
                <div className="mt-1 font-mono text-[12px] text-ink">{s.lastImport?.errorMessage}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 border-t border-border pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate">Ordre d'import imposé</div>
          <div className="text-[13px] text-ink">
            {importOrder(entities)
              .map((group) => group.map((e) => e.entity).join(", "))
              .join(" → ")}
          </div>
          <div className="mt-1 text-[12px] text-slate">
            Les clés étrangères sont validées ligne à ligne à l'insertion, ce qui permet de mettre une ligne en quarantaine sans
            annuler le lot.
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, caption, tone = "navy" }: { label: string; value: string; caption: string; tone?: "navy" | "red" }) {
  return (
    <div className="rounded-sm border border-border bg-white px-5 py-4">
      <div className="text-[12px] text-slate">{label}</div>
      <div className={`font-serif text-3xl ${tone === "red" ? "text-red" : "text-navy"}`}>{value}</div>
      <div className="mt-1 truncate text-[12px] text-slate">{caption}</div>
    </div>
  );
}

function StatusBadge({ source, staleHours }: { source: SourceInfo; staleHours: number }) {
  if (!source.lastImport) return <span className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-slate">jamais importé</span>;
  if (source.lastImport.status === "failed")
    return <span className="rounded-sm bg-red px-2 py-0.5 text-[11px] font-medium text-white">en échec</span>;
  if (hoursSince(source.lastImport.startedAt) > staleHours)
    return <span className="rounded-sm border border-teal px-2 py-0.5 text-[11px] font-medium text-teal">périmé</span>;
  return <span className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-ink">à jour</span>;
}
