import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, type Camera, type Event } from "../db/schema";
import { publishEvent } from "../sse/eventBus";
import { ReolinkClient, type AiType } from "./client";

const CLOSE_AFTER_CONSECUTIVE_OFF_POLLS = 3;
const MAX_BACKOFF_MS = 60_000;

interface TypeState {
  openEventId: number | null;
  consecutiveOff: number;
  lastEndedAtMs: number | null;
}

export class CameraPoller {
  private client: ReolinkClient;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  private consecutiveFailures = 0;
  private state = new Map<AiType, TypeState>();

  constructor(
    private camera: Camera,
    private db: Db,
    private onEventClosed: (event: Event) => void
  ) {
    this.client = new ReolinkClient(camera);
    for (const type of this.enabledTypes()) {
      this.state.set(type, { openEventId: null, consecutiveOff: 0, lastEndedAtMs: null });
    }
  }

  private enabledTypes(): AiType[] {
    try {
      return JSON.parse(this.camera.aiTypesEnabled) as AiType[];
    } catch {
      return ["person", "vehicle", "pet"];
    }
  }

  start() {
    this.stopped = false;
    // eslint-disable-next-line no-console
    console.log(
      `[reolink] polling started for camera ${this.camera.id} (${this.camera.name}) every ${this.camera.pollIntervalMs}ms, types: ${this.camera.aiTypesEnabled}`
    );
    this.scheduleNext();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Applies a config change (e.g. edited via the UI) without losing in-flight state. */
  updateCamera(camera: Camera) {
    this.camera = camera;
    this.client = new ReolinkClient(camera);
    for (const type of this.enabledTypes()) {
      if (!this.state.has(type)) {
        this.state.set(type, { openEventId: null, consecutiveOff: 0, lastEndedAtMs: null });
      }
    }
  }

  private scheduleNext() {
    if (this.stopped) return;
    // Back off exponentially on repeated failures (e.g. a login rejection)
    // instead of hammering the camera every pollIntervalMs -- that's what
    // was draining the camera's own anti-bruteforce allowance and turning
    // one bad login into a lockout.
    const delay =
      this.consecutiveFailures > 0
        ? Math.min(this.camera.pollIntervalMs * 2 ** this.consecutiveFailures, MAX_BACKOFF_MS)
        : this.camera.pollIntervalMs;
    this.timer = setTimeout(() => this.poll(), delay);
  }

  private async poll() {
    if (this.busy || this.stopped) {
      this.scheduleNext();
      return;
    }
    this.busy = true;

    try {
      const enabledTypes = this.enabledTypes();
      const active = await this.client.getActiveAiTypes(enabledTypes);
      this.consecutiveFailures = 0;
      const now = new Date();

      for (const type of enabledTypes) {
        const state = this.state.get(type)!;
        if (active.has(type)) {
          state.consecutiveOff = 0;
          if (state.openEventId === null) {
            const withinCooldown =
              state.lastEndedAtMs !== null &&
              now.getTime() - state.lastEndedAtMs < this.camera.eventCooldownMs;
            if (!withinCooldown) {
              const created = this.db
                .insert(events)
                .values({ cameraId: this.camera.id, type, startedAt: now })
                .returning()
                .get();
              state.openEventId = created.id;
              // eslint-disable-next-line no-console
              console.log(
                `[reolink] event ${created.id} opened: ${type} on camera ${this.camera.id}`
              );
              publishEvent(created);
            }
          }
        } else if (state.openEventId !== null) {
          state.consecutiveOff += 1;
          if (state.consecutiveOff >= CLOSE_AFTER_CONSECUTIVE_OFF_POLLS) {
            const closed = this.db
              .update(events)
              .set({ endedAt: now })
              .where(eq(events.id, state.openEventId))
              .returning()
              .get();
            state.lastEndedAtMs = now.getTime();
            state.openEventId = null;
            state.consecutiveOff = 0;
            publishEvent(closed);
            this.onEventClosed(closed);
          }
        }
      }
    } catch (err) {
      this.consecutiveFailures += 1;
      // eslint-disable-next-line no-console
      console.error(
        `[reolink] camera ${this.camera.id} (${this.camera.name}) poll failed (${this.consecutiveFailures} in a row):`,
        err
      );
    } finally {
      this.busy = false;
      this.scheduleNext();
    }
  }
}
