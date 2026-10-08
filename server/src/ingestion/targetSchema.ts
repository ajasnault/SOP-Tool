/**
 * Schéma cible utilisé par le pipeline d'ingestion : un jeu de champs par
 * entité, avec les synonymes probables (pour le mapping fuzzy) et le type
 * attendu (pour l'inférence de type sur les valeurs échantillonnées).
 * Reflet fonctionnel de server/src/db/schema.sql — voir docs/data-model.md.
 */

export type FieldType = "text" | "number" | "integer" | "date" | "datetime" | "measurement";

export interface TargetField {
  name: string;
  type: FieldType;
  required: boolean;
  /** Autres noms probables pour cette colonne dans un fichier source. */
  synonyms: string[];
}

export interface EntityDef {
  entity: string;
  table: string;
  primaryKey: string;
  /** Champs d'autres entités que ce champ doit référencer (FK applicative). */
  foreignKeys?: Record<string, { table: string; column: string }>;
  fields: TargetField[];
}

export const ENTITIES: EntityDef[] = [
  {
    entity: "products",
    table: "products",
    primaryKey: "product_id",
    fields: [
      { name: "product_id", type: "text", required: true, synonyms: ["ref_produit", "product_ref", "sku", "id_produit", "code_produit"] },
      { name: "product_name", type: "text", required: true, synonyms: ["nom_produit", "name", "libelle", "designation"] },
      { name: "family", type: "text", required: false, synonyms: ["famille", "product_family", "category"] },
      { name: "dosage_form", type: "text", required: false, synonyms: ["forme_galenique", "forme_pharmaceutique", "form", "presentation"] },
      { name: "active_molecule", type: "text", required: false, synonyms: ["molecule", "molecule_active", "active_ingredient"] },
      { name: "strength", type: "measurement", required: false, synonyms: ["dosage_force", "concentration", "dosage", "dosage_strength"] },
      { name: "batch_size_units", type: "number", required: false, synonyms: ["taille_lot", "batch_size", "lot_size"] },
      { name: "unit_of_measure", type: "text", required: false, synonyms: ["unite", "uom", "unit"] },
      { name: "standard_cost_eur_per_unit", type: "number", required: false, synonyms: ["cout_standard", "cost_per_unit", "standard_cost"] },
      { name: "shelf_life_months", type: "number", required: false, synonyms: ["duree_vie", "shelf_life"] },
      { name: "regulatory_status", type: "text", required: false, synonyms: ["statut_reglementaire", "reg_status"] },
      { name: "site", type: "text", required: false, synonyms: ["usine", "plant", "location"] },
    ],
  },
  {
    entity: "machines",
    table: "machines",
    primaryKey: "machine_id",
    fields: [
      { name: "machine_id", type: "text", required: true, synonyms: ["ref_machine", "machine_ref", "id_machine", "equipment_id"] },
      { name: "machine_name", type: "text", required: true, synonyms: ["nom_machine", "name", "equipment_name"] },
      { name: "machine_type", type: "text", required: false, synonyms: ["type_machine", "type", "equipment_type"] },
      { name: "process_family", type: "text", required: false, synonyms: ["famille_process", "process"] },
      { name: "site", type: "text", required: false, synonyms: ["usine", "plant", "location"] },
      { name: "production_line", type: "text", required: false, synonyms: ["ligne", "line", "ligne_production"] },
      { name: "capacity_per_hour_units", type: "number", required: false, synonyms: ["capacite_horaire", "capacity_per_hour", "throughput"] },
      { name: "changeover_time_hours", type: "number", required: false, synonyms: ["temps_changeover", "changeover_hours", "setup_time"] },
      { name: "line_clearance_hours", type: "number", required: false, synonyms: ["vide_de_ligne", "temps_vide_ligne", "line_clearance", "clearance_time"] },
      { name: "oee_target_pct", type: "number", required: false, synonyms: ["oee_cible", "oee_target"] },
      { name: "status", type: "text", required: false, synonyms: ["statut", "state"] },
      { name: "commissioning_year", type: "integer", required: false, synonyms: ["annee_mise_en_service", "commissioning_year"] },
    ],
  },
  {
    entity: "employees",
    table: "employees",
    primaryKey: "employee_id",
    fields: [
      { name: "employee_id", type: "text", required: true, synonyms: ["ref_employe", "employee_ref", "matricule", "id_employe"] },
      { name: "role", type: "text", required: false, synonyms: ["poste", "job_role", "fonction"] },
      { name: "site", type: "text", required: false, synonyms: ["usine", "plant", "location"] },
      { name: "team", type: "text", required: false, synonyms: ["equipe", "crew"] },
      { name: "shift", type: "text", required: false, synonyms: ["poste_horaire", "quart"] },
      { name: "skills", type: "text", required: false, synonyms: ["competences", "qualifications"] },
      { name: "seniority_years", type: "number", required: false, synonyms: ["anciennete", "seniority"] },
      { name: "fte", type: "number", required: false, synonyms: ["etp", "full_time_equivalent"] },
    ],
  },
  {
    entity: "forecasts",
    table: "forecasts",
    primaryKey: "id",
    foreignKeys: { product_id: { table: "products", column: "product_id" } },
    fields: [
      { name: "product_id", type: "text", required: true, synonyms: ["ref_produit", "product_ref", "sku"] },
      { name: "month", type: "text", required: true, synonyms: ["mois", "period", "periode"] },
      { name: "market", type: "text", required: false, synonyms: ["marche", "region"] },
      { name: "forecast_type", type: "text", required: false, synonyms: ["type_forecast", "type_prevision"] },
      { name: "forecast_qty_units", type: "number", required: true, synonyms: ["qty", "quantite", "forecast_qty", "volume"] },
      { name: "forecast_source", type: "text", required: false, synonyms: ["source_forecast", "source"] },
    ],
  },
  {
    entity: "production_orders",
    table: "production_orders",
    primaryKey: "order_id",
    foreignKeys: {
      product_id: { table: "products", column: "product_id" },
      machine_id: { table: "machines", column: "machine_id" },
    },
    fields: [
      { name: "order_id", type: "text", required: true, synonyms: ["ref_of", "order_ref", "of_id", "id_of"] },
      { name: "lot_id", type: "text", required: false, synonyms: ["numero_lot", "batch_id", "batch_number", "lot"] },
      { name: "product_id", type: "text", required: true, synonyms: ["ref_produit", "product_ref", "sku"] },
      { name: "step_no", type: "integer", required: false, synonyms: ["etape", "operation_no", "num_operation", "sequence"] },
      { name: "machine_id", type: "text", required: true, synonyms: ["ref_machine", "machine_ref", "equipment_id"] },
      { name: "campaign_id", type: "text", required: false, synonyms: ["ref_campagne", "campaign_ref"] },
      { name: "planned_start", type: "datetime", required: true, synonyms: ["debut_planifie", "start", "start_date"] },
      { name: "planned_end", type: "datetime", required: true, synonyms: ["fin_planifiee", "end", "end_date"] },
      { name: "batch_qty_units", type: "number", required: false, synonyms: ["quantite_lot", "batch_qty", "qty"] },
      { name: "status", type: "text", required: false, synonyms: ["statut", "state"] },
      { name: "priority", type: "text", required: false, synonyms: ["priorite"] },
    ],
  },
  {
    entity: "routings",
    table: "routings",
    primaryKey: "routing_id",
    foreignKeys: { product_id: { table: "products", column: "product_id" } },
    fields: [
      { name: "routing_id", type: "text", required: true, synonyms: ["ref_gamme", "gamme_id", "id_gamme"] },
      { name: "product_id", type: "text", required: true, synonyms: ["ref_produit", "product_ref", "sku"] },
      { name: "step_no", type: "integer", required: true, synonyms: ["etape", "operation_no", "num_operation", "sequence"] },
      { name: "operation", type: "text", required: false, synonyms: ["libelle_operation", "operation_name", "phase"] },
      { name: "machine_type", type: "text", required: true, synonyms: ["type_machine", "equipment_type", "poste_charge"] },
      { name: "site", type: "text", required: false, synonyms: ["usine", "plant", "location"] },
      { name: "qc_point", type: "text", required: false, synonyms: ["point_controle", "controle_qualite", "qc_step"] },
      { name: "qc_attribute", type: "text", required: false, synonyms: ["attribut_controle", "parametre", "test"] },
      { name: "spec_lower", type: "number", required: false, synonyms: ["limite_basse", "lsl", "spec_min"] },
      { name: "spec_upper", type: "number", required: false, synonyms: ["limite_haute", "usl", "spec_max"] },
      { name: "qc_lead_time_mean_hours", type: "number", required: false, synonyms: ["delai_qc_moyen", "qc_lead_time_mean"] },
      { name: "qc_lead_time_sd_hours", type: "number", required: false, synonyms: ["delai_qc_ecart_type", "qc_lead_time_sd"] },
    ],
  },
  {
    entity: "quality_results",
    table: "quality_results",
    primaryKey: "qc_id",
    foreignKeys: { product_id: { table: "products", column: "product_id" } },
    fields: [
      { name: "qc_id", type: "text", required: true, synonyms: ["ref_controle", "id_controle", "test_id"] },
      { name: "lot_id", type: "text", required: true, synonyms: ["numero_lot", "batch_id", "batch_number", "lot"] },
      { name: "product_id", type: "text", required: true, synonyms: ["ref_produit", "product_ref", "sku"] },
      { name: "step_no", type: "integer", required: false, synonyms: ["etape", "operation_no", "num_operation"] },
      { name: "qc_point", type: "text", required: false, synonyms: ["point_controle", "controle_qualite", "qc_step"] },
      { name: "sample_date", type: "datetime", required: true, synonyms: ["date_prelevement", "sampling_date"] },
      { name: "release_date", type: "datetime", required: false, synonyms: ["date_liberation", "date_resultat"] },
      { name: "qc_attribute", type: "text", required: false, synonyms: ["attribut_controle", "parametre", "test"] },
      { name: "measured_value", type: "number", required: false, synonyms: ["valeur_mesuree", "resultat_mesure", "value"] },
      { name: "spec_lower", type: "number", required: false, synonyms: ["limite_basse", "lsl", "spec_min"] },
      { name: "spec_upper", type: "number", required: false, synonyms: ["limite_haute", "usl", "spec_max"] },
      { name: "result", type: "text", required: true, synonyms: ["resultat", "decision", "statut_qc", "verdict"] },
    ],
  },
  {
    entity: "maintenance_plans",
    table: "maintenance_plans",
    primaryKey: "maintenance_id",
    foreignKeys: { machine_id: { table: "machines", column: "machine_id" } },
    fields: [
      { name: "maintenance_id", type: "text", required: true, synonyms: ["ref_maintenance", "maintenance_ref"] },
      { name: "machine_id", type: "text", required: true, synonyms: ["ref_machine", "machine_ref", "equipment_id"] },
      { name: "maintenance_type", type: "text", required: false, synonyms: ["type_maintenance"] },
      { name: "planned_date", type: "date", required: true, synonyms: ["date_planifiee", "planned_date"] },
      { name: "duration_hours", type: "number", required: false, synonyms: ["duree_heures", "duration"] },
      { name: "frequency", type: "text", required: false, synonyms: ["frequence"] },
      { name: "mttr_hours_avg", type: "number", required: false, synonyms: ["mttr"] },
      { name: "mtbf_days_avg", type: "number", required: false, synonyms: ["mtbf"] },
      { name: "status", type: "text", required: false, synonyms: ["statut", "state"] },
    ],
  },
  {
    entity: "shutdowns",
    table: "shutdowns",
    primaryKey: "shutdown_id",
    fields: [
      { name: "shutdown_id", type: "text", required: true, synonyms: ["ref_arret", "shutdown_ref"] },
      { name: "site", type: "text", required: false, synonyms: ["usine", "plant"] },
      { name: "production_line", type: "text", required: false, synonyms: ["ligne", "line"] },
      { name: "start_date", type: "date", required: true, synonyms: ["date_debut", "start"] },
      { name: "end_date", type: "date", required: true, synonyms: ["date_fin", "end"] },
      { name: "reason", type: "text", required: false, synonyms: ["motif", "raison"] },
      { name: "impact_capacity_pct", type: "number", required: false, synonyms: ["impact_capacite"] },
    ],
  },
  {
    entity: "absences",
    table: "absences",
    primaryKey: "absence_id",
    foreignKeys: { employee_id: { table: "employees", column: "employee_id" } },
    fields: [
      { name: "absence_id", type: "text", required: true, synonyms: ["ref_absence", "absence_ref"] },
      { name: "employee_id", type: "text", required: true, synonyms: ["ref_employe", "employee_ref", "matricule"] },
      { name: "absence_type", type: "text", required: false, synonyms: ["type_absence"] },
      { name: "start_date", type: "date", required: true, synonyms: ["date_debut", "start"] },
      { name: "end_date", type: "date", required: true, synonyms: ["date_fin", "end"] },
    ],
  },
];

export function getEntity(entity: string): EntityDef {
  const def = ENTITIES.find((e) => e.entity === entity);
  if (!def) throw new Error(`Entité inconnue: ${entity}`);
  return def;
}
