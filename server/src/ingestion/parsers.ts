import Papa from "papaparse";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface RawTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseFile(filePath: string): RawTable {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return parseCsv(filePath);
  if (ext === ".xlsx" || ext === ".xls") return parseXlsx(filePath);
  if (ext === ".json") return parseJson(filePath);
  throw new Error(`Format de fichier non supporté: ${ext}`);
}

function parseCsv(filePath: string): RawTable {
  const content = readFileSync(filePath, "utf-8");
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

function parseXlsx(filePath: string): RawTable {
  // XLSX.readFile n'est pas exposé de façon fiable par l'interop ESM/CJS du
  // paquet `xlsx` (il finit sous XLSX.default selon l'environnement) ; XLSX.read
  // sur un buffer, lui, est toujours disponible sur l'export nommé.
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    raw: false,
    defval: "",
  });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

function parseJson(filePath: string): RawTable {
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : data.rows ?? [];
  const stringRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]))
  );
  const headers = stringRows.length > 0 ? Object.keys(stringRows[0]) : [];
  return { headers, rows: stringRows };
}
