import type { DashboardSummary } from "./types";
import type { ReconciliationResponse } from "./reconciliationTypes";
import type { Decision, DecisionInput, DecisionUpdate } from "./decisionTypes";

export async function fetchDashboard(site?: string, cycleReferenceMonth?: string): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (site) params.set("site", site);
  if (cycleReferenceMonth) params.set("cycleReferenceMonth", cycleReferenceMonth);
  const qs = params.toString();
  const url = qs ? `/api/dashboard?${qs}` : "/api/dashboard";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

export async function fetchSites(): Promise<string[]> {
  const res = await fetch("/api/sites");
  if (!res.ok) throw new Error(`GET /api/sites -> ${res.status}`);
  return res.json();
}

function reconciliationQuery(site: string | undefined, cycleReferenceMonth: string | undefined): string {
  const params = new URLSearchParams();
  if (site) params.set("site", site);
  if (cycleReferenceMonth) params.set("cycleReferenceMonth", cycleReferenceMonth);
  return params.toString();
}

/** Lecture seule : renvoie la dernière génération en cache, sans jamais appeler le LLM. */
export async function fetchReconciliation(site: string | undefined, cycleReferenceMonth: string | undefined): Promise<ReconciliationResponse> {
  const qs = reconciliationQuery(site, cycleReferenceMonth);
  const url = qs ? `/api/reconciliation?${qs}` : "/api/reconciliation";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

/** Déclenchement explicite (bouton) — seul point d'entrée qui facture un appel LLM. */
export async function generateReconciliation(site: string | undefined, cycleReferenceMonth: string | undefined): Promise<ReconciliationResponse> {
  const qs = reconciliationQuery(site, cycleReferenceMonth);
  const url = qs ? `/api/reconciliation/generate?${qs}` : "/api/reconciliation/generate";
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `POST ${url} -> ${res.status}`);
  }
  return res.json();
}

async function decisionRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${init?.method ?? "GET"} ${url} -> ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export function fetchDecisions(site: string | undefined): Promise<Decision[]> {
  const qs = site ? `?site=${encodeURIComponent(site)}` : "";
  return decisionRequest(`/api/decisions${qs}`);
}

export function createDecision(input: DecisionInput): Promise<Decision> {
  return decisionRequest("/api/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDecision(id: number, update: DecisionUpdate): Promise<Decision> {
  return decisionRequest(`/api/decisions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

export function deleteDecision(id: number): Promise<void> {
  return decisionRequest(`/api/decisions/${id}`, { method: "DELETE" });
}
