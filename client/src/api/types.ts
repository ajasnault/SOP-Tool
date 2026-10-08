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
  /** Flux de production (gammes) du cycle, avec l'utilisation de chaque étape et le goulot. Vide si aucune gamme importée. */
  flows: ProductionFlow[];
  /** Contrôle qualité sur 3 mois glissants se terminant au cycle. */
  quality: QualitySummary;
}

export interface FlowStep {
  step_no: number;
  operation: string | null;
  machine_type: string;
  machine_names: string[];
  utilization_pct: number | null;
  qc_point: string | null;
}

export interface ProductionFlow {
  site: string;
  label: string;
  product_count: number;
  steps: FlowStep[];
  bottleneck_step_no: number | null;
}

export interface QcPointSummary {
  qc_point: string;
  controlled: number;
  rejected: number;
  rejection_rate_pct: number | null;
  avg_lead_time_hours: number | null;
  planned_lead_time_hours: number | null;
}

export interface RejectedLot {
  lot_id: string;
  product_id: string;
  product_name: string;
  site: string | null;
  qc_point: string | null;
  qc_attribute: string | null;
  measured_value: number | null;
  spec_lower: number | null;
  spec_upper: number | null;
  release_date: string | null;
  qty_units: number | null;
}

export interface QualitySummary {
  hasData: boolean;
  windowMonths: string[];
  controlled: number;
  rejected: number;
  rejection_rate_pct: number | null;
  rejected_units: number;
  rejected_value_eur: number;
  pending: number;
  byQcPoint: QcPointSummary[];
  worstProducts: { product_id: string; product_name: string; controlled: number; rejected: number; rejection_rate_pct: number }[];
  rejectedLots: RejectedLot[];
}
