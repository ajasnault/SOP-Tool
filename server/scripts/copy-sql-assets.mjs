// tsc ne copie que les .ts compilés — ce script copie les .sql de src/ vers
// dist/ (même arborescence) après le build, car connection.ts les lit à
// l'exécution via un chemin relatif à __dirname dans dist/.
import { cpSync, statSync } from "node:fs";

cpSync("src", "dist", {
  recursive: true,
  filter: (source) => statSync(source).isDirectory() || source.endsWith(".sql"),
});
