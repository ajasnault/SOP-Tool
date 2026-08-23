import express from "express";
import cors from "cors";
import path from "node:path";
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

// Charge server/.env (ANTHROPIC_API_KEY, SOP_LLM_MODEL) — optionnel, jamais commité.
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  console.warn("[server] pas de .env trouvé — la génération des propositions de réconciliation (LLM) échouera sans ANTHROPIC_API_KEY.");
}

const dataDir = path.join(__dirname, "..", "data");
const dbPath = process.env.SOP_DB_PATH ?? path.join(dataDir, "sop.db");

const db = openDb(dbPath);
startWatcher(db, path.join(dataDir, "watched"), path.join(dataDir, "processed"));

const app = express();
app.use(cors());
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
