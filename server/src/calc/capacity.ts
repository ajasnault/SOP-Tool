import type { DatabaseSync } from "node:sqlite";
import { hoursInMonth, monthBounds, overlapHours } from "./period.js";

export interface Machine {
  machine_id: string;
  machine_name: string;
  site: string | null;
  production_line: string | null;
  capacity_per_hour_units: number | null;
  changeover_time_hours: number | null;
}

export interface MachineMonthCapacity {
  machine_id: string;
  machine_name: string;
  site: string | null;
  production_line: string | null;
  month: string;
  available_hours: number;
  maintenance_hours: number;
  shutdown_hours: number;
  planned_hours: number;
  utilization_pct: number | null;
}

/** Voir docs/calculations.md pour la formule exacte et ses hypothèses. `site` optionnel filtre sur le site de la machine (ex. "Site A - Lyon"). */
export function capacityForMonth(db: DatabaseSync, month: string, site?: string): MachineMonthCapacity[] {
  const machines = (
    site
      ? db.prepare("SELECT machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours FROM machines WHERE site = ?").all(site)
      : db.prepare("SELECT machine_id, machine_name, site, production_line, capacity_per_hour_units, changeover_time_hours FROM machines").all()
  ) as unknown as Machine[];
  const { start, end } = monthBounds(month);
  const calendarHours = hoursInMonth(month);

  const maintenanceStmt = db.prepare(
    "SELECT duration_hours FROM maintenance_plans WHERE machine_id = ? AND substr(planned_date, 1, 7) = ?"
  );
  const shutdownStmt = db.prepare(
    "SELECT start_date, end_date, impact_capacity_pct FROM shutdowns WHERE site = ? AND production_line = ?"
  );
  const ordersStmt = db.prepare(
    `SELECT po.batch_qty_units, m.capacity_per_hour_units, m.changeover_time_hours
     FROM production_orders po JOIN machines m ON m.machine_id = po.machine_id
     WHERE po.machine_id = ? AND substr(po.planned_start, 1, 7) = ?`
  );

  return machines.map((machine) => {
    const maintenanceRows = maintenanceStmt.all(machine.machine_id, month) as unknown as { duration_hours: number | null }[];
    const maintenanceHours = sum(maintenanceRows.map((r) => r.duration_hours ?? 0));

    let shutdownHours = 0;
    if (machine.site && machine.production_line) {
      const shutdownRows = shutdownStmt.all(machine.site, machine.production_line) as unknown as {
        start_date: string;
        end_date: string;
        impact_capacity_pct: number | null;
      }[];
      for (const s of shutdownRows) {
        const overlap = overlapHours(s.start_date, s.end_date, start, end);
        shutdownHours += overlap * ((s.impact_capacity_pct ?? 100) / 100);
      }
    }

    const availableHours = Math.max(0, calendarHours - maintenanceHours - shutdownHours);

    const orderRows = ordersStmt.all(machine.machine_id, month) as unknown as {
      batch_qty_units: number | null;
      capacity_per_hour_units: number | null;
      changeover_time_hours: number | null;
    }[];
    const plannedHours = sum(
      orderRows.map((o) => {
        const capacity = o.capacity_per_hour_units ?? 0;
        const production = capacity > 0 ? (o.batch_qty_units ?? 0) / capacity : 0;
        return production + (o.changeover_time_hours ?? 0);
      })
    );

    return {
      machine_id: machine.machine_id,
      machine_name: machine.machine_name,
      site: machine.site,
      production_line: machine.production_line,
      month,
      available_hours: round2(availableHours),
      maintenance_hours: round2(maintenanceHours),
      shutdown_hours: round2(shutdownHours),
      planned_hours: round2(plannedHours),
      utilization_pct: availableHours > 0 ? round2((plannedHours / availableHours) * 100) : null,
    };
  });
}

export function detectGaps(rows: MachineMonthCapacity[], thresholdPct: number): MachineMonthCapacity[] {
  return rows.filter((r) => r.utilization_pct !== null && r.utilization_pct > thresholdPct);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
