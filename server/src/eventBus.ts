import { EventEmitter } from "node:events";

/** Bus interne : émet "data-changed" après tout import réussi, écouté par la route SSE. */
export const dataEvents = new EventEmitter();

export function notifyDataChanged(reason: string): void {
  dataEvents.emit("data-changed", { reason, at: new Date().toISOString() });
}
