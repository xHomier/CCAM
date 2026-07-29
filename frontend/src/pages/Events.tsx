import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/apiClient";
import type { AiType, Camera, CcamEvent } from "../lib/types";
import { EventCard } from "../components/EventCard";
import { useEventsStream } from "../lib/useEventsStream";
import { useAuth } from "../auth/useAuth";

const TYPE_FILTERS: { value: AiType | "all"; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "person", label: "Personne" },
  { value: "vehicle", label: "Véhicule" },
  { value: "pet", label: "Animal" },
];

export function Events() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [events, setEvents] = useState<CcamEvent[]>([]);
  const [cameraFilter, setCameraFilter] = useState<number | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AiType | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Camera[]>("/cameras").then(setCameras);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (cameraFilter !== "all") params.set("cameraId", String(cameraFilter));
    if (typeFilter !== "all") params.set("type", typeFilter);
    api
      .get<CcamEvent[]>(`/events?${params.toString()}`)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [cameraFilter, typeFilter]);

  useEventsStream((event) => {
    if (cameraFilter !== "all" && event.cameraId !== cameraFilter) return;
    if (typeFilter !== "all" && event.type !== typeFilter) return;
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === event.id);
      if (idx === -1) return [event, ...prev];
      const next = [...prev];
      next[idx] = event;
      return next;
    });
  });

  const camerasById = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  async function handleDelete(id: number) {
    await api.delete(`/events/${id}`);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="all">Toutes les caméras</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                typeFilter === f.value ? "bg-accent text-bg" : "bg-surface text-muted hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="text-muted">Aucun événement pour l'instant.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              camera={camerasById.get(event.cameraId)}
              canDelete={user?.role === "admin"}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
