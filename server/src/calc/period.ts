export interface MonthBounds {
  start: Date;
  end: Date; // exclusif (début du mois suivant)
}

export function monthBounds(month: string): MonthBounds {
  const [year, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(year, m, 1));
  return { start, end };
}

export function hoursInMonth(month: string): number {
  const { start, end } = monthBounds(month);
  return (end.getTime() - start.getTime()) / 3_600_000;
}

export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function quarterOf(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const q = Math.ceil(m / 3);
  return `${year}-Q${q}`;
}

/** Chevauchement en heures entre [aStart, aEnd) et [bStart, bEnd), aux formats ISO. */
export function overlapHours(aStart: string, aEnd: string, bStart: Date, bEnd: Date): number {
  const s = new Date(aStart.length === 10 ? `${aStart}T00:00:00Z` : `${aStart.replace(" ", "T")}Z`);
  const e = new Date(aEnd.length === 10 ? `${aEnd}T00:00:00Z` : `${aEnd.replace(" ", "T")}Z`);
  const overlapStart = Math.max(s.getTime(), bStart.getTime());
  const overlapEnd = Math.min(e.getTime(), bEnd.getTime());
  return Math.max(0, overlapEnd - overlapStart) / 3_600_000;
}

/** `count` mois consécutifs "YYYY-MM" à partir de `startMonth` (inclus). */
export function rollingMonths(startMonth: string, count: number): string[] {
  const [year, m] = startMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(year, m - 1 + i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

/**
 * Mois "YYYY-MM" contenant (premier jour de `startMonth` + `weeks` semaines).
 * Utilisé pour la période gelée : granularité mensuelle assumée (les données
 * de capacité/demande sont mensuelles, une précision au jour serait une
 * fausse précision) — voir docs/calculations.md, "Période gelée".
 */
export function monthAfterWeeks(startMonth: string, weeks: number): string {
  const { start } = monthBounds(startMonth);
  const end = new Date(start.getTime() + weeks * 7 * 86_400_000);
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Liste les mois "YYYY-MM" présents entre deux dates ISO (bornes incluses). */
export function monthsBetween(minDateStr: string, maxDateStr: string): string[] {
  const months: string[] = [];
  const start = new Date(`${minDateStr.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${maxDateStr.slice(0, 7)}-01T00:00:00Z`);
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
