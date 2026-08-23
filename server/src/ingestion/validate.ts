import type { DatabaseSync } from "node:sqlite";
import type { EntityDef, FieldType } from "./targetSchema.js";

export interface RowError {
  rowNumber: number;
  field: string | null;
  message: string;
}

export interface CoercedRow {
  rowNumber: number;
  values: Record<string, string | number | null>;
}

export interface ValidationResult {
  validRows: CoercedRow[];
  errors: RowError[];
}

/**
 * Applique le mapping colonne source -> champ cible, coerce les types, et
 * valide requis/FK. Les FK sont vérifiées par requête applicative (pas par
 * PRAGMA foreign_keys) pour pouvoir mettre en quarantaine une ligne invalide
 * sans annuler l'import complet — cf. docs/data-model.md.
 */
export function validateRows(
  db: DatabaseSync,
  entity: EntityDef,
  mapping: Record<string, string | null>,
  rawRows: Record<string, string>[]
): ValidationResult {
  const validRows: CoercedRow[] = [];
  const errors: RowError[] = [];

  const fkCheckers = Object.entries(entity.foreignKeys ?? {}).map(([field, ref]) => {
    const stmt = db.prepare(`SELECT 1 FROM ${ref.table} WHERE ${ref.column} = ? LIMIT 1`);
    return { field, stmt };
  });

  rawRows.forEach((rawRow, idx) => {
    const rowNumber = idx + 2; // +1 pour l'en-tête, +1 pour l'index 1-based
    const values: Record<string, string | number | null> = {};
    let rowHasError = false;

    for (const field of entity.fields) {
      const sourceColumn = mapping[field.name];
      const rawValue = sourceColumn ? rawRow[sourceColumn] : undefined;
      const trimmed = rawValue?.trim() ?? "";

      if (trimmed === "") {
        if (field.required) {
          errors.push({ rowNumber, field: field.name, message: `Champ requis manquant (colonne source: ${sourceColumn ?? "non mappée"})` });
          rowHasError = true;
        }
        values[field.name] = null;
        continue;
      }

      const coerced = coerce(trimmed, field.type);
      if (coerced === undefined) {
        errors.push({ rowNumber, field: field.name, message: `Valeur "${trimmed}" incompatible avec le type attendu (${field.type})` });
        rowHasError = true;
        continue;
      }
      values[field.name] = coerced;
    }

    for (const checker of fkCheckers) {
      const value = values[checker.field];
      if (value === null || value === undefined) continue;
      const found = checker.stmt.get(value);
      if (!found) {
        const ref = entity.foreignKeys![checker.field];
        errors.push({ rowNumber, field: checker.field, message: `Référence introuvable: ${checker.field}="${value}" absent de ${ref.table}.${ref.column}` });
        rowHasError = true;
      }
    }

    if (!rowHasError) validRows.push({ rowNumber, values });
  });

  return { validRows, errors };
}

function coerce(value: string, type: FieldType): string | number | undefined {
  switch (type) {
    case "text":
      return value;
    case "integer": {
      const n = Number(value.replace(",", "."));
      return Number.isInteger(n) ? n : Number.isFinite(n) ? Math.round(n) : undefined;
    }
    case "number": {
      const n = Number(value.replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "date":
    case "datetime":
      // Stockage en texte tel quel (ISO attendu) ; validation de forme minimale.
      return /^\d{4}-\d{2}(-\d{2})?/.test(value) ? value : undefined;
    default:
      return value;
  }
}
