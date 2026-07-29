import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import type { Camera } from "../lib/types";
import { Go2RtcPlayer } from "../components/Go2RtcPlayer";
import { useAuth } from "../auth/useAuth";

export function Live() {
  const { user } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Camera[]>("/cameras")
      .then(setCameras)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-muted">Chargement des caméras…</div>;
  }

  const enabledCameras = cameras.filter((c) => c.enabled);

  if (enabledCameras.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-text">Aucune caméra configurée.</p>
        {user?.role === "admin" && (
          <p className="text-sm text-muted">
            Ajoute une caméra depuis Réglages → Caméras pour voir le direct ici.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3">
      {enabledCameras.map((camera) => (
        <div key={camera.id} className="rounded-xl border border-border bg-surface p-3">
          <h2 className="mb-2 text-sm font-medium text-text">{camera.name}</h2>
          <Go2RtcPlayer streamName={`cam${camera.id}`} />
        </div>
      ))}
    </div>
  );
}
