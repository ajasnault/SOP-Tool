import { Router } from "express";
import { ENTITIES } from "../ingestion/targetSchema.js";

/** Expose le schéma cible (entités + champs) pour que l'écran admin construise le mapping sans le coder en dur. */
export function schemaRouter(): Router {
  const router = Router();

  router.get("/entities", (_req, res) => {
    res.json(
      ENTITIES.map((e) => ({
        entity: e.entity,
        table: e.table,
        primaryKey: e.primaryKey,
        dependsOn: [...new Set(Object.values(e.foreignKeys ?? {}).map((fk) => fk.table))],
        fields: e.fields.map((f) => ({ name: f.name, type: f.type, required: f.required })),
      }))
    );
  });

  return router;
}
