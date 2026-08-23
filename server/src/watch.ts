import chokidar from "chokidar";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { importEntity, recordFailedImport } from "./ingestion/importEntity.js";
import { ENTITIES } from "./ingestion/targetSchema.js";
import { notifyDataChanged } from "./eventBus.js";

const ENTITY_NAMES = new Set(ENTITIES.map((e) => e.entity));

/**
 * Watch data/watched/<entity>/*.{csv,xlsx,json} : déposer un fichier dans le
 * sous-dossier d'une entité déclenche son import, sans passer par l'UI admin.
 */
export function startWatcher(db: DatabaseSync, watchedDir: string, processedDir: string): void {
  for (const entity of ENTITY_NAMES) {
    mkdirSync(path.join(watchedDir, entity), { recursive: true });
  }

  const watcher = chokidar.watch(watchedDir, {
    // false : importe aussi les fichiers déjà présents au démarrage (ex. déposés
    // pendant un redémarrage du serveur). ATTENTION : un fichier laissé dans le
    // dossier watché est retraité à CHAQUE redémarrage, pas une seule fois — un
    // fichier oublié peut donc écraser silencieusement, en boucle, un import plus
    // récent fait par ailleurs (admin, etc.) sur la même clé. C'est exactement ce
    // qui s'est produit le 2026-08-20 : des fichiers restés dans les dossiers
    // watchés de TOUTES les entités ont réécrasé, 17 fois chacun, un import v2
    // complet fait via l'admin. D'où le déplacement hors du dossier watché
    // après un import RÉUSSI (voir plus bas) : un fichier importé ne peut
    // plus jamais être retraité.
    ignoreInitial: false,
    ignored: /(^|[/\\])\../, // fichiers cachés (ex. .DS_Store) — pas des sources de données
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on("add", (filePath) => {
    const entity = path.basename(path.dirname(filePath));
    if (!ENTITY_NAMES.has(entity)) return;
    try {
      const report = importEntity(db, entity, filePath);
      if (report.status === "pending_confirmation") {
        console.warn(
          `[watch] ${entity} <- ${filePath} : signature d'en-têtes jamais vue, mapping en attente de confirmation ` +
            `(colonnes sous le seuil: ${report.lowConfidenceFields?.join(", ")}). Rien importé — ` +
            `confirme via POST /api/import/${entity}/confirm. Fichier laissé en place (sera reproposé au prochain redémarrage, ` +
            `sans risque : rien n'est écrit tant que ce n'est pas confirmé).`
        );
        return;
      }
      notifyDataChanged(`watch:${entity}`);
      console.log(`[watch] import réussi: ${entity} <- ${filePath}`);
      archiveProcessedFile(filePath, entity, processedDir);
    } catch (err) {
      recordFailedImport(db, entity, filePath, (err as Error).message);
      notifyDataChanged(`import-failed:${entity}`);
      console.error(
        `[watch] échec import ${entity} <- ${filePath} :`,
        (err as Error).message,
        "— fichier laissé en place pour permettre une relance (Sources connectées)."
      );
    }
  });

  console.log(`[watch] surveillance active sur ${watchedDir}/<entity>/`);
}

/** Sort le fichier du dossier watché après un import réussi, pour qu'il ne soit jamais retraité. */
function archiveProcessedFile(filePath: string, entity: string, processedDir: string): void {
  const destDir = path.join(processedDir, entity);
  mkdirSync(destDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(destDir, `${timestamp}-${path.basename(filePath)}`);
  try {
    renameSync(filePath, dest);
  } catch (err) {
    console.error(`[watch] impossible de déplacer ${filePath} vers ${dest} après import :`, (err as Error).message);
  }
}
