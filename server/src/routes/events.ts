import { Router } from "express";
import { dataEvents } from "../eventBus.js";

/** SSE : pousse "data-changed" au client à chaque import/changement de seuil. */
export function eventsRouter(): Router {
  const router = Router();

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: {}\n\n`);

    const onChange = (payload: unknown) => {
      res.write(`event: data-changed\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    dataEvents.on("data-changed", onChange);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      dataEvents.off("data-changed", onChange);
    });
  });

  return router;
}
