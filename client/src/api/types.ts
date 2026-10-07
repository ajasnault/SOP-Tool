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

export interface HrAvailabilityRow {
  site: string | null;
  team: string | null;
  role: string | null;
  headcount: number;
  fte_total: number;
  fte_available: number;
}

export interface DemandRow {
  group: string;
  period: string;
  qty_units: number;
}

export interface ServiceLevelSummary {
  month: string;
  demand_units: number;
  covered_units: number;
  service_level_pct: number | null;
  products_with_demand: number;
  products_fully_covered: number;
}

export interface DashboardSummary {
  /** Tous les mois avec au moins une donnée — bornes de navigation entre cycles. */
  dataHorizon: string[];
  /** 18 mois glissants ancrés sur cycleReferenceMonth — axe des graphiques. */
  chartHorizon: string[];
  /** Mois "YYYY-MM" du cycle consulté. */
  cycleReferenceMonth: string;
  /** true si cycleReferenceMonth est le mois calendaire réel actuel. */
  isCurrentCycle: boolean;
  lastImportAt: string | null;
  thresholdPct: number;
  frozenPeriodWeeks: number;
  frozenPeriodEndMonth: string;
  capacity: MachineMonthCapacity[];
  /** Capacité par machine sur chartHorizon (18 mois glissants) — heatmap d'évolution de charge. */
  capacityTrend: MachineMonthCapacity[];
  hrAvailability: HrAvailabilityRow[];
  /** Taux de service prévisionnel du cycle consulté (demande couverte par le plan, plafonnée par produit). */
  serviceLevel: ServiceLevelSummary;
  serviceLevelTargetPct: number;
  demandTrend: { month: string; qty_units: number }[];
  demandByFamily: DemandRow[];
}
