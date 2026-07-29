import { useState } from "react";
import type { Camera, CcamEvent } from "../lib/types";

const TYPE_LABEL: Record<CcamEvent["type"], string> = {
  person: "Personne",
  vehicle: "Véhicule",
  pet: "Animal",
  motion: "Mouvement",
};

const TYPE_BADGE_CLASS: Record<CcamEvent["type"], string> = {
  person: "bg-accent-muted text-accent",
  vehicle: "bg-warning/15 text-warning",
  pet: "bg-success/15 text-success",
  motion: "bg-surface2 text-muted",
};

function formatDuration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "en cours…";
  const seconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

export function EventCard({
  event,
  camera,
  canDelete,
  onDelete,
}: {
  event: CcamEvent;
  camera?: Camera;
  canDelete: boolean;
  onDelete?: (id: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [clipError, setClipError] = useState(false);

  return (
    <div className="flex gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-black">
        {event.thumbnailPath ? (
          <img
            src={`/recordings/${event.thumbnailPath}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted">
            Pas d'aperçu
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE_CLASS[event.type]}`}
          >
            {TYPE_LABEL[event.type]}
          </span>
          <span className="truncate text-sm text-text">{camera?.name ?? `Caméra ${event.cameraId}`}</span>
        </div>
        <p className="text-sm text-muted">
          {new Date(event.startedAt).toLocaleString("fr-CA")} · {formatDuration(event.startedAt, event.endedAt)}
        </p>
        {event.clipPath && (
          <button
            onClick={() => setPlaying(true)}
            className="self-start text-sm font-medium text-accent hover:text-accent-hover"
          >
            Voir le clip
          </button>
        )}
      </div>

      {canDelete && onDelete && (
        <button
          onClick={() => onDelete(event.id)}
          className="self-start text-xs text-muted hover:text-danger"
        >
          Supprimer
        </button>
      )}

      {playing && event.clipPath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => {
            setPlaying(false);
            setClipError(false);
          }}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-border bg-surface p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-text">
                {TYPE_LABEL[event.type]} · {new Date(event.startedAt).toLocaleString("fr-CA")}
              </span>
              <button
                onClick={() => {
                  setPlaying(false);
                  setClipError(false);
                }}
                className="text-sm text-muted hover:text-text"
              >
                Fermer
              </button>
            </div>

            {clipError ? (
              <p className="p-6 text-center text-sm text-danger">
                Ce clip n'a pas pu être lu. Il est peut-être incomplet ou corrompu.
              </p>
            ) : (
              <video
                src={`/recordings/${event.clipPath}`}
                controls
                autoPlay
                onError={() => setClipError(true)}
                className="aspect-video w-full rounded-lg bg-black"
              />
            )}

            <a
              href={`/recordings/${event.clipPath}`}
              download
              className="mt-2 inline-block text-sm font-medium text-accent hover:text-accent-hover"
            >
              Télécharger le clip
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
