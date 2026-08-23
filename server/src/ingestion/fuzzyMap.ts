import { createHash } from "node:crypto";
import type { EntityDef, FieldType, TargetField } from "./targetSchema.js";

export interface MappingProposal {
  /** targetFieldName -> sourceColumn (null si aucune correspondance suffisante trouvée) */
  mapping: Record<string, string | null>;
  /** targetFieldName -> score de confiance [0,1] de la correspondance proposée */
  confidence: Record<string, number>;
}

export interface ColumnInfo {
  column: string;
  sampleValue: string;
  inferredType: FieldType;
  /** Champ cible actuellement affecté à cette colonne (selon le mapping fourni), ou null. */
  targetField: string | null;
  confidence: number | null;
}

/** Vue orientée colonne source (une ligne par colonne du fichier importé) — pour l'écran d'admin. */
export function describeColumns(
  entity: EntityDef,
  headers: string[],
  sampleRows: Record<string, string>[],
  mapping: Record<string, string | null>,
  confidence: Record<string, number>
): ColumnInfo[] {
  const columnToField = new Map<string, string>();
  for (const field of entity.fields) {
    const col = mapping[field.name];
    if (col) columnToField.set(col, field.name);
  }
  return headers.map((column) => {
    const values = sampleRows.map((r) => r[column]).filter((v) => v !== undefined && v !== "");
    const targetField = columnToField.get(column) ?? null;
    return {
      column,
      sampleValue: sampleRows[0]?.[column] ?? "",
      inferredType: inferType(values),
      targetField,
      confidence: targetField ? confidence[targetField] ?? null : null,
    };
  });
}

const MIN_SCORE = 0.55;
/** Poids relatifs du score de nom vs score de type dans le score final d'une paire. */
const NAME_WEIGHT = 0.55;
const TYPE_WEIGHT = 0.45;
/** Placeholders de valeur manquante, ignorés lors de l'inférence de type. */
const NULL_PLACEHOLDERS = new Set(["-", "n/a", "na", "none", "null"]);

export function sourceSignature(headers: string[]): string {
  const sorted = [...headers].map(normalize).sort();
  return createHash("sha1").update(sorted.join("|")).digest("hex");
}

export function proposeMapping(entity: EntityDef, headers: string[], sampleRows: Record<string, string>[]): MappingProposal {
  const inferredTypes = new Map<string, FieldType>();
  for (const header of headers) {
    const values = sampleRows.map((r) => r[header]).filter((v) => v !== undefined && v !== "");
    inferredTypes.set(header, inferType(values));
  }

  // Score toutes les paires (champ cible, colonne source)
  const pairs: { field: string; column: string; score: number }[] = [];
  for (const field of entity.fields) {
    for (const header of headers) {
      const score = scorePair(field, header, inferredTypes.get(header)!);
      pairs.push({ field: field.name, column: header, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const mapping: Record<string, string | null> = {};
  const confidence: Record<string, number> = {};
  for (const field of entity.fields) mapping[field.name] = null;

  const usedColumns = new Set<string>();
  const assignedFields = new Set<string>();
  for (const pair of pairs) {
    if (assignedFields.has(pair.field) || usedColumns.has(pair.column)) continue;
    if (pair.score < MIN_SCORE) continue;
    mapping[pair.field] = pair.column;
    confidence[pair.field] = pair.score;
    usedColumns.add(pair.column);
    assignedFields.add(pair.field);
  }

  return { mapping, confidence };
}

function scorePair(field: TargetField, header: string, inferredType: FieldType): number {
  const nameCandidates = [field.name, ...field.synonyms];
  const normalizedHeader = normalize(header);
  let nameScore = Math.max(...nameCandidates.map((c) => jaroWinkler(normalize(c), normalizedHeader)));
  const typeScore = typeCompatibility(field.type, inferredType);

  // Un nom de colonne trop générique/littéral (ex. "dosage" préfixe de
  // "dosage_form") ne doit pas l'emporter automatiquement s'il ne doit sa
  // forte similarité qu'à une inclusion littérale, et que le contenu réel de
  // la colonne contredit fortement le type attendu par le champ cible.
  const isLiteralContainment = nameCandidates.some((c) => {
    const n = normalize(c);
    return n !== normalizedHeader && (n.includes(normalizedHeader) || normalizedHeader.includes(n));
  });
  if (isLiteralContainment && typeScore < 0.3) {
    nameScore *= 0.5;
  }

  return nameScore * NAME_WEIGHT + typeScore * TYPE_WEIGHT;
}

function typeCompatibility(expected: FieldType, inferred: FieldType): number {
  if (expected === inferred) return 1;
  const numericGroup: FieldType[] = ["number", "integer"];
  const dateGroup: FieldType[] = ["date", "datetime"];
  if (numericGroup.includes(expected) && numericGroup.includes(inferred)) return 0.8;
  if (dateGroup.includes(expected) && dateGroup.includes(inferred)) return 0.8;
  // "measurement" (ex. "100mg") est un nombre avec unité : proche d'un champ
  // numérique pur, mais nettement incompatible avec un champ texte catégoriel
  // (et réciproquement) — c'est ce contraste qui distingue "strength" de
  // "dosage_form" dans le jeu de données réel.
  if (expected === "measurement" && numericGroup.includes(inferred)) return 0.6;
  if (numericGroup.includes(expected) && inferred === "measurement") return 0.6;
  if (expected === "measurement" && inferred === "text") return 0.15;
  if (inferred === "measurement" && expected === "text") return 0.15;
  if (expected === "text") return 0.5; // le texte est compatible avec (presque) tout
  return 0.2;
}

export function inferType(values: string[]): FieldType {
  const sample = values
    .map((v) => v.trim())
    .filter((v) => v !== "" && !NULL_PLACEHOLDERS.has(v.toLowerCase()))
    .slice(0, 25);
  if (sample.length === 0) return "text";

  // Vote majoritaire (>=60% des valeurs échantillonnées) plutôt qu'unanimité :
  // plus robuste aux valeurs aberrantes/placeholders qu'un .every() strict.
  const checkers: { type: FieldType; test: (v: string) => boolean }[] = [
    { type: "integer", test: isIntegerLike },
    { type: "number", test: isNumberLike },
    { type: "measurement", test: isMeasurementLike },
    { type: "datetime", test: isDatetimeLike },
    { type: "date", test: isDateLike },
  ];
  for (const checker of checkers) {
    const ratio = sample.filter(checker.test).length / sample.length;
    if (ratio >= 0.6) return checker.type;
  }
  return "text";
}

function isIntegerLike(v: string): boolean {
  return /^-?\d+$/.test(v.trim());
}
function isNumberLike(v: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(v.trim());
}
/** Nombre suivi d'une unité littérale, ex. "100mg", "5.5 kg", "250ml". */
function isMeasurementLike(v: string): boolean {
  return /^-?\d+([.,]\d+)?\s*[a-zA-Zµ%°]+$/.test(v.trim());
}
function isDateLike(v: string): boolean {
  return /^\d{4}-\d{2}(-\d{2})?$/.test(v.trim());
}
function isDatetimeLike(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v.trim());
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distance de Jaro-Winkler, retourne une similarité dans [0,1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
