import type { DatabaseSync } from "node:sqlite";
import { monthBounds } from "./period.js";

export interface HrAvailabilityRow {
  site: string | null;
  team: string | null;
  role: string | null;
  headcount: number;
  fte_total: number;
  fte_available: number;
}

/**
 * Disponibilité RH par site/équipe/rôle pour un mois donné : FTE total moins
 * la fraction de FTE absente. Pas de charge réelle — voir docs/calculations.md
 * et la limite documentée dans docs/data-model.md (pas de lien employé <-> OF).
 */
export function hrAvailabilityForMonth(db: DatabaseSync, month: string, site?: string): HrAvailabilityRow[] {
  const { start, end } = monthBounds(month);
  const daysInMonth = (end.getTime() - start.getTime()) / 86_400_000;

  const employees = (
    site
      ? db.prepare("SELECT employee_id, role, site, team, fte FROM employees WHERE site = ?").all(site)
      : db.prepare("SELECT employee_id, role, site, team, fte FROM employees").all()
  ) as unknown as { employee_id: string; role: string | null; site: string | null; team: string | null; fte: number | null }[];

  const absenceStmt = db.prepare("SELECT start_date, end_date FROM absences WHERE employee_id = ?");

  const groups = new Map<string, HrAvailabilityRow>();
  for (const emp of employees) {
    const key = `${emp.site ?? ""}|${emp.team ?? ""}|${emp.role ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, { site: emp.site, team: emp.team, role: emp.role, headcount: 0, fte_total: 0, fte_available: 0 });
    }
    const group = groups.get(key)!;
    const fte = emp.fte ?? 0;

    const absences = absenceStmt.all(emp.employee_id) as unknown as { start_date: string; end_date: string }[];
    let absentDays = 0;
    for (const a of absences) {
      absentDays += overlapDays(a.start_date, a.end_date, start, end);
    }
    const absentFraction = daysInMonth > 0 ? Math.min(1, absentDays / daysInMonth) : 0;

    group.headcount += 1;
    group.fte_total = round2(group.fte_total + fte);
    group.fte_available = round2(group.fte_available + fte * (1 - absentFraction));
  }

  return [...groups.values()];
}

function overlapDays(aStart: string, aEnd: string, bStart: Date, bEnd: Date): number {
  const s = new Date(`${aStart}T00:00:00Z`);
  const e = new Date(`${aEnd}T00:00:00Z`);
  const overlapStart = Math.max(s.getTime(), bStart.getTime());
  const overlapEnd = Math.min(e.getTime(), bEnd.getTime());
  return Math.max(0, overlapEnd - overlapStart) / 86_400_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
