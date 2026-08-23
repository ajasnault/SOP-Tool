const NAVY: [number, number, number] = [0x21, 0x29, 0x5c];
const TEAL: [number, number, number] = [0x1c, 0x72, 0x93];
const RED = "#B23A2E";
const NO_DATA = "#EDEFF3";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Couleur d'une cellule de la heatmap capacité. Respecte la règle du projet :
 * le rouge n'apparaît que sur un vrai dépassement de seuil, jamais en dégradé
 * d'alerte progressif. De 0 % au seuil, dégradé continu navy -> teal.
 */
export function heatColor(utilizationPct: number | null, thresholdPct: number): string {
  if (utilizationPct === null) return NO_DATA;
  if (utilizationPct > thresholdPct) return RED;
  const ratio = thresholdPct > 0 ? Math.max(0, Math.min(1, utilizationPct / thresholdPct)) : 0;
  const [r, g, b] = [lerp(NAVY[0], TEAL[0], ratio), lerp(NAVY[1], TEAL[1], ratio), lerp(NAVY[2], TEAL[2], ratio)];
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
