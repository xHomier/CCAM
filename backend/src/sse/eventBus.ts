import { EventEmitter } from "node:events";
import type { Event } from "../db/schema";

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export const EVENT_CHANNEL = "ccam:event";

export function publishEvent(event: Event) {
  eventBus.emit(EVENT_CHANNEL, event);
}
