import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import type { Camera, CcamEvent, RecordingSegment } from "../lib/types";
import { ContinuousPlayer } from "../components/ContinuousPlayer";
import { RecordingsTimeline } from "../components/RecordingsTimeline";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <select
          value={cameraId ?? ""}
          onChange={(e) => setCameraId(Number(e.target.value))}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
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
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {sortedSegments.length > 0 ? (
          <div className="aspect-video h-full max-w-full">
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
