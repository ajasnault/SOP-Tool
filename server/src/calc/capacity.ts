import type { DatabaseSync } from "node:sqlite";
import { hoursInMonth, monthBounds, overlapHours } from "./period.js";

export interface Machine {
  machine_id: string;
  machine_name: string;
  machine_type: string | null;
  site: string | null;
  production_line: string | null;
  capacity_per_hour_units: number | null;
  changeover_time_hours: number | null;
  line_clearance_hours: number | null;
}

export interface MachineMonthCapacity {
  machine_id: string;
  machine_name: string;
  machine_type: string | null;
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
  return capacityForMonths(db, [month], site);
}

/**
 * Même calcul que `capacityForMonth`, pour plusieurs mois en une passe (les OF
 * sont lus une seule fois). Résultat ordonné par mois puis par machine.
 *
 * Entre deux OF d'une machine (ordre de planned_start) : changement de série
 * complet si le produit change (ou premier OF connu), sinon vide de ligne — il
 * est obligatoire même entre deux lots du même produit. Voir docs/calculations.md.
 */
export function capacityForMonths(db: DatabaseSync, months: string[], site?: string): MachineMonthCapacity[] {
  const machines = (
    site
      ? db
          .prepare(
            "SELECT machine_id, machine_name, machine_type, site, production_line, capacity_per_hour_units, changeover_time_hours, line_clearance_hours FROM machines WHERE site = ?"
          )
          .all(site)
      : db
          .prepare(
            "SELECT machine_id, machine_name, machine_type, site, production_line, capacity_per_hour_units, changeover_time_hours, line_clearance_hours FROM machines"
          )
          .all()
  ) as unknown as Machine[];
  if (months.length === 0 || machines.length === 0) return [];

  const plannedByKey = new Map<string, number>();
  // LAG sur tout l'historique de la machine (l'OF précédent peut dater d'avant
  // la fenêtre), lu dans l'ordre de l'index couvrant idx_production_orders_seq
  // (pas de tri), agrégé en SQL : ~100k OF ne transitent pas par JS.
  const loadRows = db
    .prepare(
      `SELECT machine_id, month, SUM(COALESCE(batch_qty_units, 0)) AS qty,
              SUM(CASE WHEN prev_product_id IS product_id THEN 0 ELSE 1 END) AS changeovers,
              SUM(CASE WHEN prev_product_id IS product_id THEN 1 ELSE 0 END) AS clearances
       FROM (
         SELECT machine_id, substr(planned_start, 1, 7) AS month, batch_qty_units, product_id,
                LAG(product_id) OVER (PARTITION BY machine_id ORDER BY planned_start, order_id) AS prev_product_id
         FROM production_orders
       )
       WHERE month IN (${months.map(() => "?").join(",")})
       GROUP BY machine_id, month`
    )
    .all(...months) as unknown as {
    machine_id: string;
    month: string;
    qty: number;
    changeovers: number;
    clearances: number;
  }[];
  const machineById = new Map(machines.map((m) => [m.machine_id, m]));
  for (const r of loadRows) {
    const machine = machineById.get(r.machine_id);
    if (!machine) continue;
    const capacity = machine.capacity_per_hour_units ?? 0;
    const production = capacity > 0 ? r.qty / capacity : 0;
    const setup = r.changeovers * (machine.changeover_time_hours ?? 0) + r.clearances * (machine.line_clearance_hours ?? 0);
    plannedByKey.set(`${r.machine_id}|${r.month}`, production + setup);
  }

  const maintenanceStmt = db.prepare(
    "SELECT duration_hours FROM maintenance_plans WHERE machine_id = ? AND substr(planned_date, 1, 7) = ?"
  );
  const shutdownStmt = db.prepare(
    "SELECT start_date, end_date, impact_capacity_pct FROM shutdowns WHERE site = ? AND production_line = ?"
  );

  return months.flatMap((month) => {
    const { start, end } = monthBounds(month);
    const calendarHours = hoursInMonth(month);

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
      const plannedHours = plannedByKey.get(`${machine.machine_id}|${month}`) ?? 0;

      return {
        machine_id: machine.machine_id,
        machine_name: machine.machine_name,
        machine_type: machine.machine_type,
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
