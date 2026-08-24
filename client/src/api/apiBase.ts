/**
 * Base URL du backend. Vide par défaut → chemins relatifs, qui fonctionnent en
 * dev local (proxy Vite vers localhost:4000, voir vite.config.ts) et en prod
 * si client et serveur partagent la même origine. Définir VITE_API_URL (sans
 * slash final, ex. https://sop-api.up.railway.app) quand le client est déployé
 * comme service séparé du backend.
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
