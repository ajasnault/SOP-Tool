import express from "express";
import cors from "cors";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/connection.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { importRouter } from "./routes/importRoute.js";
import { eventsRouter } from "./routes/events.js";
import { schemaRouter } from "./routes/schema.js";
import { sourcesRouter } from "./routes/sources.js";
import { exportRouter } from "./routes/export.js";
import { reconciliationRouter } from "./routes/reconciliation.js";
import { decisionsRouter } from "./routes/decisions.js";
import { startWatcher } from "./watch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charge server/.env en local (ANTHROPIC_API_KEY, SOP_LLM_MODEL) — absent en prod
// (Railway et consorts injectent les variables nativement dans process.env, sans
// fichier .env), donc cet échec est normal et ne doit rien logger à lui seul.
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // pas de fichier .env — attendu en prod, voir commentaire ci-dessus.
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[server] ANTHROPIC_API_KEY absente de l'environnement — la génération des propositions de réconciliation (LLM) échouera.");
}

const dataDir = path.join(__dirname, "..", "data");
const dbPath = process.env.SOP_DB_PATH ?? path.join(dataDir, "sop.db");

// data/ est gitignoré (contient sop.db + fichiers importés) — absent d'un checkout
// frais (ex. déploiement Railway), donc SQLite échoue à créer le fichier sans ce mkdir.
mkdirSync(dataDir, { recursive: true });

const db = openDb(dbPath);
startWatcher(db, path.join(dataDir, "watched"), path.join(dataDir, "processed"));

// Verrouillé sur le domaine du frontend déployé (client et serveur sont deux
// services Railway séparés) ; overridable via CORS_ORIGIN si ce domaine change.
const corsOrigin = process.env.CORS_ORIGIN ?? "https://empathetic-benevolence-production-cd6a.up.railway.app";

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use("/api", dashboardRouter(db));
app.use("/api", importRouter(db, path.join(dataDir, "uploads")));
app.use("/api", eventsRouter());
app.use("/api", schemaRouter());
app.use("/api", sourcesRouter(db));
app.use("/api", exportRouter(db));
app.use("/api", reconciliationRouter(db));
app.use("/api", decisionsRouter(db));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`[server] S&OP API en écoute sur http://localhost:${PORT} (db: ${dbPath})`);
});
