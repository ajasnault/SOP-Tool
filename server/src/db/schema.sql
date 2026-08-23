-- Schéma cible normalisé S&OP. Voir docs/data-model.md pour la description
-- de chaque champ et les hypothèses de mapping avec les sources brutes.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  family TEXT,
  dosage_form TEXT,
  active_molecule TEXT,
  strength TEXT,
  batch_size_units REAL,
  unit_of_measure TEXT,
  standard_cost_eur_per_unit REAL,
  shelf_life_months REAL,
  regulatory_status TEXT,
  site TEXT
);

CREATE TABLE IF NOT EXISTS machines (
  machine_id TEXT PRIMARY KEY,
  machine_name TEXT NOT NULL,
  machine_type TEXT,
  process_family TEXT,
  site TEXT,
  production_line TEXT,
  capacity_per_hour_units REAL,
  changeover_time_hours REAL,
  oee_target_pct REAL,
  status TEXT,
  commissioning_year INTEGER
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  role TEXT,
  site TEXT,
  team TEXT,
  shift TEXT,
  skills TEXT,
  seniority_years REAL,
  fte REAL
);

CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  month TEXT NOT NULL,
  market TEXT,
  forecast_type TEXT,
  forecast_qty_units REAL NOT NULL,
  forecast_source TEXT,
  UNIQUE(product_id, month, market, forecast_type)
);
CREATE INDEX IF NOT EXISTS idx_forecasts_product_month ON forecasts(product_id, month);

CREATE TABLE IF NOT EXISTS production_orders (
  order_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  machine_id TEXT NOT NULL REFERENCES machines(machine_id),
  campaign_id TEXT,
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  batch_qty_units REAL,
  status TEXT,
  priority TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_orders_machine ON production_orders(machine_id, planned_start);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  maintenance_id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(machine_id),
  maintenance_type TEXT,
  planned_date TEXT NOT NULL,
  duration_hours REAL,
  frequency TEXT,
  mttr_hours_avg REAL,
  mtbf_days_avg REAL,
  status TEXT
);
CREATE INDEX IF NOT EXISTS idx_maintenance_machine ON maintenance_plans(machine_id, planned_date);

CREATE TABLE IF NOT EXISTS shutdowns (
  shutdown_id TEXT PRIMARY KEY,
  site TEXT,
  production_line TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  impact_capacity_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_shutdowns_line ON shutdowns(site, production_line);

CREATE TABLE IF NOT EXISTS absences (
  absence_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(employee_id),
  absence_type TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_absences_employee ON absences(employee_id, start_date);

-- Tables outillage (ingestion, config, alertes)

CREATE TABLE IF NOT EXISTS mapping_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  source_signature TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity, source_signature)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  source_filename TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  rows_total INTEGER NOT NULL,
  rows_imported INTEGER NOT NULL,
  rows_quarantined INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS import_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  row_number INTEGER NOT NULL,
  field TEXT,
  message TEXT NOT NULL,
  raw_row_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_thresholds (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL
);

INSERT OR IGNORE INTO alert_thresholds (key, value) VALUES ('capacity_utilization_gap_pct', 90);

-- Cache des propositions de réconciliation générées par LLM, une par cycle
-- consulté (voir docs/calculations.md, "Propositions de réconciliation (LLM)").
-- `site` en TEXT NOT NULL DEFAULT '' (et non NULL) : SQLite traite chaque NULL
-- comme distinct dans une contrainte UNIQUE, ce qui casserait le cache pour la
-- vue "tous sites" (site non filtré) où plusieurs lignes NULL coexisteraient.
CREATE TABLE IF NOT EXISTS reconciliation_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_reference_month TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT NOT NULL,
  context_json TEXT NOT NULL,
  options_json TEXT NOT NULL,
  UNIQUE(cycle_reference_month, site)
);

-- Décisions & plan d'action (vue "Décisions", mode présentation) — saisie
-- humaine uniquement, aucun LLM impliqué. `source_option_title` et
-- `cycle_reference_month` tracent, à titre indicatif seulement, qu'une
-- décision est née d'une option de réconciliation pré-remplie (voir
-- docs/calculations.md) ; ce ne sont pas des clés étrangères strictes, une
-- décision reste éditable/valide même si la proposition source a été
-- écrasée par une régénération ultérieure.
-- `site` NULL = décision "tous sites" (créée en mode Consolidé) — visible
-- quel que soit le site consulté, cohérent avec `computeDashboard(db, undefined, ...)`
-- où l'absence de site = pas de filtrage. Une décision avec un site précis
-- n'apparaît que sous ce site ou en vue Consolidé (voir GET /api/decisions).
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'a_faire',
  site TEXT,
  source_option_title TEXT,
  -- Instantané JSON { option: ReconciliationOption, thresholdPct: number },
  -- capturé au moment de la création — permet de générer un export "Plan de
  -- lissage" plus tard même si la proposition source a été écrasée par une
  -- régénération (voir docs/calculations.md).
  option_snapshot_json TEXT,
  cycle_reference_month TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
