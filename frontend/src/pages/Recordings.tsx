import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import type { Camera, CcamEvent, RecordingSegment } from "../lib/types";
import { ContinuousPlayer } from "../components/ContinuousPlayer";
import { Go2RtcPlayer } from "../components/Go2RtcPlayer";
import { RecordingsTimeline } from "../components/RecordingsTimeline";

// How far past the last recorded segment counts as "now". Playback can only
// reach the end of the newest *finalised* segment, so anything beyond that is
// the live edge rather than a hole in the recording.
const LIVE_EDGE_TOLERANCE_MS = 30_000;

function todayIso() {
  // Must be the viewer's *local* calendar day, not toISOString()'s UTC day
  // -- that flips to tomorrow/yesterday around midnight in any timezone
  // ahead of/behind UTC, which is exactly why Recordings kept defaulting
  // to the wrong day.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function Recordings() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cameraId, setCameraId] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [events, setEvents] = useState<CcamEvent[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ atMs: number; nonce: number } | null>(null);

  useEffect(() => {
    api.get<Camera[]>("/cameras").then((cams) => {
      setCameras(cams);
      if (cams.length > 0) setCameraId(cams[0].id);
    });
  }, []);

  useEffect(() => {
    if (cameraId === null) return;
    setCurrentTimeMs(null);
    setSeekRequest(null);

    // The date picker is a *local* calendar day -- resolve its boundaries to
    // UTC instants here rather than sending a bare "YYYY-MM-DD" for the
    // backend to guess a timezone for (segment files are stored in UTC).
    const from = new Date(`${date}T00:00:00`).toISOString();
    const to = new Date(`${date}T23:59:59.999`).toISOString();

    api
      .get<RecordingSegment[]>(
        `/recordings?cameraId=${cameraId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )
      .then((segs) => {
        setSegments(segs);
        if (segs.length > 0) {
          const sorted = [...segs].sort(
            (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
          );
          seekTo(new Date(sorted[0].startedAt).getTime());
        }
      });

    api
      .get<CcamEvent[]>(
        `/events?cameraId=${cameraId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`
      )
      .then(setEvents);
  }, [cameraId, date]);

  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()),
    [segments]
  );

  function seekTo(atMs: number) {
    setCurrentTimeMs(atMs);
    setSeekRequest((prev) => ({ atMs, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  // Scrubbing past the newest recorded segment on today's timeline means the
  // viewer is asking for the present, so hand over to the live stream instead
  // of stalling on a segment that doesn't exist yet.
  const lastSegmentEndMs = useMemo(() => {
    const last = sortedSegments[sortedSegments.length - 1];
    if (!last) return null;
    const previous = sortedSegments[sortedSegments.length - 2];
    const spanMs = previous
      ? new Date(last.startedAt).getTime() - new Date(previous.startedAt).getTime()
      : 60_000;
    return new Date(last.startedAt).getTime() + spanMs;
  }, [sortedSegments]);

  const showingLive =
    date === todayIso() &&
    currentTimeMs !== null &&
    lastSegmentEndMs !== null &&
    currentTimeMs > lastSegmentEndMs + LIVE_EDGE_TOLERANCE_MS;

  return (
    <div className="safe-x flex h-full flex-col gap-2 py-2 md:gap-3 md:p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={cameraId ?? ""}
          onChange={(e) => setCameraId(Number(e.target.value))}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm md:flex-none"
        >
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm md:flex-none"
        />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {showingLive && cameraId !== null ? (
          <div className="relative aspect-video max-h-full w-full max-w-full md:h-full md:w-auto">
            <Go2RtcPlayer streamName={`cam${cameraId}`} />
            <span className="absolute left-2 top-2 z-20 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-danger backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" />
              EN DIRECT
            </span>
          </div>
        ) : sortedSegments.length > 0 ? (
          <div className="aspect-video max-h-full w-full max-w-full md:h-full md:w-auto">
            <ContinuousPlayer
              segments={sortedSegments}
              seekRequest={seekRequest}
              onTimeUpdate={setCurrentTimeMs}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">Aucun enregistrement pour cette journée.</p>
        )}
      </div>

      {sortedSegments.length > 0 && (
        <div className="shrink-0">
          <RecordingsTimeline
            date={date}
            segments={sortedSegments}
            events={events}
            currentTimeMs={currentTimeMs}
            onSeek={seekTo}
          />
        </div>
      )}
    </div>
  );
}
