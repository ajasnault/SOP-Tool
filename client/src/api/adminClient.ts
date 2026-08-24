import type { EntityInfo, ImportReport, SourceInfo, Thresholds } from "./adminTypes";
import { apiUrl } from "./apiBase";

export async function fetchEntities(): Promise<EntityInfo[]> {
  const res = await fetch(apiUrl("/api/entities"));
  if (!res.ok) throw new Error(`GET /api/entities -> ${res.status}`);
  return res.json();
}

export async function fetchSources(): Promise<SourceInfo[]> {
  const res = await fetch(apiUrl("/api/sources"));
  if (!res.ok) throw new Error(`GET /api/sources -> ${res.status}`);
  return res.json();
}

export async function retrySource(entity: string): Promise<ImportReport> {
  const res = await fetch(apiUrl(`/api/sources/${encodeURIComponent(entity)}/retry`), { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error ?? `POST /api/sources/${entity}/retry -> ${res.status}`);
  return res.json();
}

export async function fetchThresholds(): Promise<Thresholds> {
  const res = await fetch(apiUrl("/api/thresholds"));
  if (!res.ok) throw new Error(`GET /api/thresholds -> ${res.status}`);
  return res.json();
}

export async function updateThreshold(key: string, value: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/thresholds/${encodeURIComponent(key)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? `PUT /api/thresholds/${key} -> ${res.status}`);
}

export async function importFile(entity: string, file: File): Promise<ImportReport> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl(`/api/import/${encodeURIComponent(entity)}`), { method: "POST", body: form });
  if (!res.ok && res.status !== 202) throw new Error((await res.json()).error ?? `POST /api/import/${entity} -> ${res.status}`);
  return res.json();
}

export async function confirmImport(
  entity: string,
  file: File,
  mapping: Record<string, string | null>,
  manualFields: string[],
  dryRun: boolean
): Promise<ImportReport> {
  const form = new FormData();
  form.append("file", file);
  form.append("mapping", JSON.stringify(mapping));
  form.append("manualFields", JSON.stringify(manualFields));
  form.append("dryRun", String(dryRun));
  const res = await fetch(apiUrl(`/api/import/${encodeURIComponent(entity)}/confirm`), { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json()).error ?? `POST /api/import/${entity}/confirm -> ${res.status}`);
  return res.json();
}
