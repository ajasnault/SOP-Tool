import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../db/connection.js";
import { importEntity } from "./importEntity.js";
import { parseFile } from "./parsers.js";
import { sourceSignature } from "./fuzzyMap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const regressionFile = path.join(__dirname, "..", "..", "fixtures", "regression", "01_products_presentation_dosage_swap.csv");

function freshDb() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sop-test-")), "test.db");
  return openDb(dbPath);
}

test("garde-fou : une signature jamais vue avec une colonne sous le seuil de confiance n'importe rien automatiquement", () => {
  const db = freshDb();

  const report = importEntity(db, "products", regressionFile);

  assert.equal(report.status, "pending_confirmation");
  // rowsImported ici = aperçu ("importerait N lignes si confirmé"), pas un
  // compte de lignes réellement écrites — le vrai signal "rien écrit" est
  // l'état de la table products, vérifié juste après.
  assert.equal(report.rowsImported, 5, "l'aperçu doit refléter les lignes qui passeraient la validation");
  assert.ok(report.lowConfidenceFields && report.lowConfidenceFields.length > 0, "au moins un champ sous le seuil attendu");

  const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  assert.equal(productCount.c, 0, "la table products doit rester vide tant que le mapping n'est pas confirmé");

  const { headers } = parseFile(regressionFile);
  const signature = sourceSignature(headers);
  const persisted = db.prepare("SELECT 1 FROM mapping_configs WHERE entity='products' AND source_signature=?").get(signature);
  assert.equal(persisted, undefined, "le mapping proposé ne doit pas être mémorisé tant qu'il n'est pas confirmé");
});

test("régression Présentation/dosage : une fois confirmé, dosage_form et strength ne sont plus inversés", () => {
  const db = freshDb();

  const proposed = importEntity(db, "products", regressionFile);
  assert.equal(proposed.status, "pending_confirmation");
  // Le mapping proposé (avant confirmation) doit déjà être correct : c'est le
  // fix du matcher qui est testé ici, la confirmation ne fait que valider ce
  // qu'il a produit.
  assert.equal(proposed.mapping.dosage_form, "Présentation");
  assert.equal(proposed.mapping.strength, "dosage");

  const confirmed = importEntity(db, "products", regressionFile, { forceMapping: proposed.mapping });
  assert.equal(confirmed.status, "imported");
  assert.equal(confirmed.mappingSource, "confirmed");
  assert.equal(confirmed.rowsImported, 5);
  assert.equal(confirmed.rowsQuarantined, 0);

  const prd001 = db.prepare("SELECT dosage_form, strength FROM products WHERE product_id = 'PRD-001'").get() as {
    dosage_form: string;
    strength: string;
  };
  assert.equal(prd001.dosage_form, "Poudre", "dosage_form ne doit plus recevoir la valeur de strength");
  assert.equal(prd001.strength, "100mg", "strength ne doit plus recevoir la valeur de dosage_form");

  const prd002 = db.prepare("SELECT dosage_form, strength FROM products WHERE product_id = 'PRD-002'").get() as {
    dosage_form: string;
    strength: string;
  };
  assert.equal(prd002.dosage_form, "Blister");
  assert.equal(prd002.strength, "-");

  // Import suivant de la même signature : mapping mémorisé, réutilisé sans
  // redemander de confirmation.
  const reimported = importEntity(db, "products", regressionFile);
  assert.equal(reimported.status, "imported");
  assert.equal(reimported.mappingSource, "reused");
});

test("dryRun : aperçu live pendant l'édition du mapping, jamais d'écriture en base", () => {
  const db = freshDb();

  const proposed = importEntity(db, "products", regressionFile);
  assert.equal(proposed.status, "pending_confirmation");

  // L'utilisateur corrige un champ à la main dans l'écran admin ; on demande
  // un aperçu (dryRun) avant qu'il ne confirme pour de bon.
  const edited = { ...proposed.mapping, family: "Groupe" };
  const preview = importEntity(db, "products", regressionFile, {
    forceMapping: edited,
    manualFields: ["family"],
    dryRun: true,
  });

  assert.equal(preview.status, "preview");
  assert.equal(preview.confidence.family, 1, "un champ édité à la main doit passer en confiance 1 (\"manuel\")");
  assert.equal(preview.rowsImported, 5);

  const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  assert.equal(productCount.c, 0, "un dryRun ne doit jamais écrire en base, même avec un mapping valide");
  const mappingPersisted = db.prepare("SELECT 1 FROM mapping_configs WHERE entity='products'").get();
  assert.equal(mappingPersisted, undefined, "un dryRun ne doit jamais mémoriser de mapping");

  // Confirmation réelle (sans dryRun) avec ce même mapping édité.
  const confirmed = importEntity(db, "products", regressionFile, { forceMapping: edited, manualFields: ["family"] });
  assert.equal(confirmed.status, "imported");
  const productCountAfter = db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number };
  assert.equal(productCountAfter.c, 5);
});
