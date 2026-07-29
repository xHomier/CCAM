import { useEffect, useRef } from "react";
import type { CcamEvent } from "./types";

/** Subscribes to /api/events/stream (SSE) for the lifetime of the component. */
export function useEventsStream(onEvent: (event: CcamEvent) => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.onmessage = (message) => {
      try {
        callbackRef.current(JSON.parse(message.data) as CcamEvent);
      } catch {
        /* ignore malformed/heartbeat frames */
      }
    };
    return () => source.close();
  }, []);
}
