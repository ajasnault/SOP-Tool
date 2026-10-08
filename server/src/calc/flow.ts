import type { DatabaseSync } from "node:sqlite";
import type { MachineMonthCapacity } from "./capacity.js";

export interface FlowStep {
  step_no: number;
  operation: string | null;
  machine_type: string;
  /** Machines du site de ce type (une seule dans le cas courant). */
  machine_names: string[];
  /** Σ heures planifiées / Σ heures disponibles des machines de ce type sur le site, ou null si aucune machine / aucune heure disponible. */
  utilization_pct: number | null;
  qc_point: string | null;
}

export interface ProductionFlow {
  site: string;
  /** Famille + formes galéniques des produits qui suivent cette gamme, ex. "Formulation Solide — Comprimé". */
  label: string;
  product_count: number;
  steps: FlowStep[];
  /** Étape la plus chargée du flux sur le mois : celle qui limite le débit de toute la chaîne. */
  bottleneck_step_no: number | null;
}

/**
 * Flux de production d'un mois : les gammes (`routings`) regroupées par site et
 * par enchaînement de types de machines, chaque étape portant l'utilisation du
 * mois de ses machines. Voir docs/calculations.md ("Flux et goulot").
 * `capacity` = capacité du mois déjà calculée (même filtre de site).
 */
export function flowsForMonth(db: DatabaseSync, capacity: MachineMonthCapacity[], site?: string): ProductionFlow[] {
  const rows = db
    .prepare(
      `SELECT r.product_id, r.step_no, r.operation, r.machine_type, r.qc_point,
              COALESCE(r.site, p.site) AS site, p.family, p.dosage_form
       FROM routings r JOIN products p ON p.product_id = r.product_id
       ${site ? "WHERE COALESCE(r.site, p.site) = ?" : ""}
       ORDER BY r.product_id, r.step_no`
    )
    .all(...(site ? [site] : [])) as unknown as {
    product_id: string;
    step_no: number;
    operation: string | null;
    machine_type: string;
    qc_point: string | null;
    site: string | null;
    family: string | null;
    dosage_form: string | null;
  }[];

  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.site) continue;
    const list = byProduct.get(r.product_id) ?? [];
    list.push(r);
    byProduct.set(r.product_id, list);
  }

  const groups = new Map<string, { site: string; steps: typeof rows; families: Set<string>; forms: Set<string>; products: number }>();
  for (const steps of byProduct.values()) {
    const site = steps[0].site!;
    const key = `${site}|${steps.map((s) => s.machine_type).join(">")}`;
    const g = groups.get(key) ?? { site, steps, families: new Set<string>(), forms: new Set<string>(), products: 0 };
    if (steps[0].family) g.families.add(steps[0].family);
    if (steps[0].dosage_form) g.forms.add(steps[0].dosage_form);
    g.products++;
    groups.set(key, g);
  }

  const byTypeAtSite = new Map<string, { planned: number; available: number; names: string[] }>();
  for (const c of capacity) {
    if (!c.site || !c.machine_type) continue;
    const key = `${c.site}|${c.machine_type}`;
    const cur = byTypeAtSite.get(key) ?? { planned: 0, available: 0, names: [] };
    cur.planned += c.planned_hours;
    cur.available += c.available_hours;
    cur.names.push(c.machine_name);
    byTypeAtSite.set(key, cur);
  }

  const flows: ProductionFlow[] = [...groups.values()].map((g) => {
    const steps: FlowStep[] = g.steps.map((s) => {
      const load = byTypeAtSite.get(`${g.site}|${s.machine_type}`);
      return {
        step_no: s.step_no,
        operation: s.operation,
        machine_type: s.machine_type,
        machine_names: load?.names ?? [],
        utilization_pct: load && load.available > 0 ? round2((load.planned / load.available) * 100) : null,
        qc_point: s.qc_point,
      };
    });
    const withUtil = steps.filter((s) => s.utilization_pct !== null);
    const bottleneck = withUtil.length > 0 ? withUtil.reduce((a, b) => (b.utilization_pct! > a.utilization_pct! ? b : a)) : null;
    return {
      site: g.site,
      label: `${[...g.families].join(", ")} — ${[...g.forms].sort().join(", ")}`,
      product_count: g.products,
      steps,
      bottleneck_step_no: bottleneck?.step_no ?? null,
    };
  });

  return flows.sort((a, b) => a.site.localeCompare(b.site) || b.steps.length - a.steps.length || a.label.localeCompare(b.label));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
