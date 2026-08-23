/** ISO/SQLite datetime (UTC, "YYYY-MM-DD HH:MM:SS") -> heures écoulées depuis maintenant. */
export function hoursSince(iso: string): number {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso.replace(" ", "T")}Z`);
  return (Date.now() - d.getTime()) / 3_600_000;
}

/** "4h", "7j", "à l'instant" */
export function formatRelative(iso: string): string {
  const hours = hoursSince(iso);
  if (hours < 1) return "à l'instant";
  if (hours < 24) return `il y a ${Math.round(hours)} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}
