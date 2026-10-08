import type { DatabaseSync } from "node:sqlite";
import { getEntity } from "./targetSchema.js";
import { parseFile } from "./parsers.js";
import { proposeMapping, describeColumns, sourceSignature, type ColumnInfo } from "./fuzzyMap.js";
import { validateRows } from "./validate.js";
import { getThreshold } from "../config.js";

export interface ImportOptions {
  /**
   * Mapping colonne source -> champ cible choisi par un humain (proposé par
   * l'algorithme, accepté tel quel ou corrigé) pour cette signature d'en-têtes.
   * Fourni sans `dryRun` = confirmation explicite : mémorisé dans
   * mapping_configs, import exécuté.
   */
  forceMapping?: Record<string, string | null>;
  /** Champs de `forceMapping` modifiés à la main par l'utilisateur : traités à confiance 1 ("manuel"). */
  manualFields?: string[];
  /** Calcule mapping/validation sans rien écrire en base (aperçu live pendant l'édition du mapping). */
  dryRun?: boolean;
  /** Nom affiché dans import_batches.source_filename (par défaut : filePath) — utile quand filePath est un chemin temporaire illisible (upload HTTP). */
  sourceLabel?: string;
}

export interface ImportReport {
  entity: string;
  sourceFile: string;
  status: "imported" | "pending_confirmation" | "preview";
  mapping: Record<string, string | null>;
  mappingSource: "reused" | "auto-detected" | "confirmed";
  /** targetFieldName -> confiance [0,1]. Les champs de `manualFields` valent 1 ("manuel"). */
  confidence: Record<string, number>;
  /** Vue orientée colonne source, pour l'écran de mapping. */
  columns: ColumnInfo[];
  rowsTotal: number;
  /** Lignes qui passeraient la validation (écrites en base seulement si status === "imported"). */
  rowsImported: number;
  rowsQuarantined: number;
  errors: { rowNumber: number; field: string | null; message: string }[];
  unmappedFields: string[];
  /** Renseigné si status === "pending_confirmation". */
  lowConfidenceFields?: string[];
  minConfidenceRequired?: number;
  message?: string;
}

/**
 * Voir docs/data-model.md ("Garde-fou de confiance du mapping"). Pour une
 * signature d'en-têtes jamais vue sans mapping fourni : si une colonne
 * mappée a un score de confiance sous `mapping_confidence_min` (défaut
 * 0.75), rien n'est écrit en base (`status: "pending_confirmation"`). Une
 * signature déjà connue, ou un mapping fourni via `options.forceMapping`
 * (hors `dryRun`), s'appliquent toujours. `options.dryRun` permet de
 * prévisualiser (mapping + rapport de validation) sans jamais committer,
 * quel que soit le mapping fourni — utilisé par l'écran d'admin pendant
 * l'édition manuelle des correspondances.
 */
export function importEntity(db: DatabaseSync, entityName: string, filePath: string, options: ImportOptions = {}): ImportReport {
  const entity = getEntity(entityName);
  const { headers, rows } = parseFile(filePath);
  const signature = sourceSignature(headers);
  const sample = rows.slice(0, 50);

  const existing = db
    .prepare("SELECT mapping_json FROM mapping_configs WHERE entity = ? AND source_signature = ?")
    .get(entityName, signature) as unknown as { mapping_json: string } | undefined;

  // Toujours calculer la proposition algorithmique : sert de référence de
  // confiance même quand un mapping corrigé à la main est fourni (seuls les
  // champs listés dans `manualFields` sont traités à confiance 1).
  const proposal = proposeMapping(entity, headers, sample);
  const confidence: Record<string, number> = { ...proposal.confidence };
  for (const field of options.manualFields ?? []) confidence[field] = 1;

  let mapping: Record<string, string | null>;
  let mappingSource: "reused" | "auto-detected" | "confirmed";
  let willCommit: boolean;

  if (existing && !options.dryRun) {
    mapping = JSON.parse(existing.mapping_json);
    mappingSource = "reused";
    willCommit = true;
  } else if (options.forceMapping) {
    mapping = options.forceMapping;
    mappingSource = "confirmed";
    willCommit = !options.dryRun;
  } else {
    mapping = proposal.mapping;
    mappingSource = "auto-detected";
    const minConfidence = getThreshold(db, "mapping_confidence_min", 0.75);
    const lowConfidenceFields = Object.entries(confidence)
      .filter(([field, score]) => mapping[field] !== null && score < minConfidence)
      .map(([field]) => field);

    if (lowConfidenceFields.length > 0 || options.dryRun) {
      const columns = describeColumns(entity, headers, sample, mapping, confidence);
      const { validRows, errors } = validateRows(db, entity, mapping, rows);
      return {
        entity: entityName,
        sourceFile: filePath,
        status: options.dryRun ? "preview" : "pending_confirmation",
        mapping,
        mappingSource,
        confidence,
        columns,
        rowsTotal: rows.length,
        rowsImported: validRows.length,
        rowsQuarantined: errors.length,
        errors,
        unmappedFields: entity.fields.filter((f) => mapping[f.name] === null).map((f) => f.name),
        ...(lowConfidenceFields.length > 0
          ? {
              lowConfidenceFields,
              minConfidenceRequired: minConfidence,
              message:
                `Signature d'en-têtes jamais vue, avec ${lowConfidenceFields.length} colonne(s) sous le seuil de confiance ` +
                `(${minConfidence}) : ${lowConfidenceFields.join(", ")}. Rien n'a été écrit en base. Corrige "mapping" si besoin ` +
                `puis renvoie-le à POST /api/import/${entityName}/confirm (mêmes champs, + "mapping" en JSON) pour valider et importer.`,
            }
          : {}),
      };
    }
    willCommit = true;
  }

  const columns = describeColumns(entity, headers, sample, mapping, confidence);

  if (!willCommit) {
    const { validRows, errors } = validateRows(db, entity, mapping, rows);
    return {
      entity: entityName,
      sourceFile: filePath,
      status: "preview",
      mapping,
      mappingSource,
      confidence,
      columns,
      rowsTotal: rows.length,
      rowsImported: validRows.length,
      rowsQuarantined: errors.length,
      errors,
      unmappedFields: entity.fields.filter((f) => mapping[f.name] === null).map((f) => f.name),
    };
  }

  const unmappedFields = entity.fields.filter((f) => mapping[f.name] === null).map((f) => f.name);
  const missingRequired = entity.fields.filter((f) => f.required && mapping[f.name] === null);
  if (missingRequired.length > 0) {
    throw new Error(
      `Champs requis non mappés pour "${entityName}": ${missingRequired.map((f) => f.name).join(", ")}. ` +
        `Colonnes source disponibles: ${headers.join(", ")}`
    );
  }

  if (mappingSource !== "reused") {
    db.prepare("INSERT OR REPLACE INTO mapping_configs (entity, source_signature, mapping_json) VALUES (?, ?, ?)").run(
      entityName,
      signature,
      JSON.stringify(mapping)
    );
  }

  const { validRows, errors } = validateRows(db, entity, mapping, rows);

  const cols = entity.fields.map((f) => f.name);
  const placeholders = cols.map(() => "?").join(", ");
  const insertStmt = db.prepare(`INSERT OR REPLACE INTO ${entity.table} (${cols.join(", ")}) VALUES (${placeholders})`);

  // Une seule transaction : un plan de ~100k OF s'importe en secondes au lieu
  // de minutes (un commit par ligne sinon), et un échec en cours de route ne
  // laisse pas une table à moitié écrite.
  db.exec("BEGIN");
  try {
    for (const row of validRows) {
      insertStmt.run(...cols.map((c) => row.values[c] ?? null));
    }

    const batchId = db
      .prepare(
        "INSERT INTO import_batches (entity, source_filename, rows_total, rows_imported, rows_quarantined, status) VALUES (?, ?, ?, ?, ?, 'success')"
      )
      .run(entityName, options.sourceLabel ?? filePath, rows.length, validRows.length, errors.length).lastInsertRowid as number;

    const errorStmt = db.prepare(
      "INSERT INTO import_errors (import_batch_id, row_number, field, message, raw_row_json) VALUES (?, ?, ?, ?, ?)"
    );
    for (const err of errors) {
      const rawRow = rows[err.rowNumber - 2] ?? {};
      errorStmt.run(batchId, err.rowNumber, err.field, err.message, JSON.stringify(rawRow));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    entity: entityName,
    sourceFile: filePath,
    status: "imported",
    mapping,
    mappingSource,
    confidence,
    columns,
    rowsTotal: rows.length,
    rowsImported: validRows.length,
    rowsQuarantined: errors.length,
    errors,
    unmappedFields,
  };
}

/**
 * Trace un import qui a échoué avant même de produire un ImportReport (ex.
 * fichier illisible, colonnes requises manquantes) — sans ça, l'écran
 * "Sources connectées" n'aurait aucune trace des échecs. Voir routes/importRoute.ts et watch.ts.
 */
export function recordFailedImport(db: DatabaseSync, entityName: string, filePath: string, errorMessage: string): void {
  db.prepare(
    "INSERT INTO import_batches (entity, source_filename, rows_total, rows_imported, rows_quarantined, status, error_message) VALUES (?, ?, 0, 0, 0, 'failed', ?)"
  ).run(entityName, filePath, errorMessage);
}
