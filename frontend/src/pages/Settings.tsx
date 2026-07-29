import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import type { Camera, CameraInput } from "../lib/types";
import { CameraForm } from "../components/CameraForm";

export function Settings() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);

  function reload() {
    setLoading(true);
    api
      .get<Camera[]>("/cameras")
      .then(setCameras)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleCreate(input: Partial<CameraInput>) {
    await api.post("/cameras", input);
    setEditingId(null);
    reload();
  }

  async function handleUpdate(id: number, input: Partial<CameraInput>) {
    await api.patch(`/cameras/${id}`, input);
    setEditingId(null);
    reload();
  }

  async function handleDelete(id: number) {
    if (!confirm("Supprimer cette caméra ? Les enregistrements existants ne seront pas effacés.")) {
      return;
    }
    await api.delete(`/cameras/${id}`);
    reload();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Caméras</h1>
        {editingId === null && (
          <button
            onClick={() => setEditingId("new")}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-hover"
          >
            Ajouter une caméra
          </button>
        )}
      </div>

      {editingId === "new" && (
        <CameraForm onSubmit={handleCreate} onCancel={() => setEditingId(null)} />
      )}

      {loading ? (
        <p className="text-muted">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cameras.map((camera) =>
            editingId === camera.id ? (
              <CameraForm
                key={camera.id}
                initial={camera}
                onSubmit={(input) => handleUpdate(camera.id, input)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={camera.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface p-4"
              >
                <div>
                  <p className="font-medium text-text">
                    {camera.name}{" "}
                    {!camera.enabled && <span className="text-xs text-muted">(désactivée)</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {camera.host}:{camera.rtspPort} · flux continu {camera.continuousStream}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(camera.id)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted hover:text-text"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => handleDelete(camera.id)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted hover:text-danger"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            )
          )}
          {cameras.length === 0 && <p className="text-muted">Aucune caméra pour l'instant.</p>}
        </div>
      )}
    </div>
  );
}
