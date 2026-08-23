const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

/** "2026-08" -> "Août 2026" */
export function formatMonthFr(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTHS_FR[m - 1]} ${year}`;
}

/** "2026-08" + 1 -> "2026-09" ; + -1 -> "2026-07" */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ISO datetime -> "18/08/2026 06:10" */
export function formatDateTimeFr(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
