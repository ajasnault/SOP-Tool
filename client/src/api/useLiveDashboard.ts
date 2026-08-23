import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboard } from "./client";
import type { DashboardSummary } from "./types";

export type LiveStatus = "loading" | "nominal" | "refreshing" | "error";

export interface LiveDashboard {
  data: DashboardSummary | null;
  status: LiveStatus;
}

/**
 * Charge le dashboard et le tient à jour en direct via SSE (`/api/events`).
 * Règles (voir maquette + brief) : les chiffres affichés ne sont jamais vidés
 * — une erreur ou un rafraîchissement en cours conservent la dernière donnée
 * valide, seul `status` change pour piloter l'affichage (voile plein cadre en
 * "refreshing", bandeau persistant en "error").
 */
export function useLiveDashboard(site?: string, cycleReferenceMonth?: string): LiveDashboard {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [status, setStatus] = useState<LiveStatus>("loading");
  const hasDataRef = useRef(false);

  const load = useCallback(async (currentSite?: string, currentMonth?: string) => {
    setStatus((prev) => (hasDataRef.current ? "refreshing" : prev));
    try {
      const summary = await fetchDashboard(currentSite, currentMonth);
      setData(summary);
      hasDataRef.current = true;
      setStatus("nominal");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load(site, cycleReferenceMonth);
  }, [site, cycleReferenceMonth, load]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.addEventListener("data-changed", () => {
      load(site, cycleReferenceMonth);
    });
    source.onerror = () => {
      // La connexion SSE elle-même a un souci (pas la requête dashboard) :
      // pas d'impact sur `status` tant que le dashboard répond ; le navigateur
      // retente une reconnexion automatiquement.
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, cycleReferenceMonth]);

  return { data, status };
}
