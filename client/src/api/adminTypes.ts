export type FieldType = "text" | "number" | "integer" | "date" | "datetime" | "measurement";

export interface TargetFieldInfo {
  name: string;
  type: FieldType;
  required: boolean;
}

export interface EntityInfo {
  entity: string;
  table: string;
  primaryKey: string;
  dependsOn: string[];
  fields: TargetFieldInfo[];
}

export interface SourceLastImport {
  startedAt: string;
  sourceFilename: string | null;
  rowsTotal: number;
  rowsImported: number;
  rowsQuarantined: number;
  status: "success" | "failed";
  errorMessage: string | null;
  retryable: boolean;
}

export interface SourceInfo {
  entity: string;
  table: string;
  currentRowCount: number;
  lastImport: SourceLastImport | null;
}

export interface Thresholds {
  capacity_utilization_gap_pct: number;
  mapping_confidence_min: number;
  source_staleness_warning_hours: number;
  frozen_period_weeks: number;
}

export interface ColumnInfo {
  column: string;
  sampleValue: string;
  inferredType: FieldType;
  targetField: string | null;
  confidence: number | null;
}

export interface RowError {
  rowNumber: number;
  field: string | null;
  message: string;
}

export interface ImportReport {
  entity: string;
  sourceFile: string;
  status: "imported" | "pending_confirmation" | "preview";
  mapping: Record<string, string | null>;
  mappingSource: "reused" | "auto-detected" | "confirmed";
  confidence: Record<string, number>;
  columns: ColumnInfo[];
  rowsTotal: number;
  rowsImported: number;
  rowsQuarantined: number;
  errors: RowError[];
  unmappedFields: string[];
  lowConfidenceFields?: string[];
  minConfidenceRequired?: number;
  message?: string;
}
