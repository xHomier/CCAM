import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";
import type { AppUser } from "../lib/types";
import { UserForm, type UserFormInput } from "../components/UserForm";
import { useAuth } from "../auth/useAuth";

export function SettingsUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);

  function reload() {
    setLoading(true);
    api
      .get<AppUser[]>("/users")
      .then(setUsers)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleCreate(input: UserFormInput) {
    await api.post("/users", input);
    setEditingId(null);
    reload();
  }

  async function handleUpdate(id: number, input: UserFormInput) {
    await api.patch(`/users/${id}`, input);
    setEditingId(null);
    reload();
  }

  async function handleToggleDisabled(u: AppUser) {
    await api.patch(`/users/${u.id}`, { disabled: !u.disabled });
    reload();
  }

  async function handleDelete(id: number) {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    await api.delete(`/users/${id}`);
    reload();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Utilisateurs</h1>
        {editingId === null && (
          <button
            onClick={() => setEditingId("new")}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-hover"
          >
            Ajouter un utilisateur
          </button>
        )}
      </div>

      {editingId === "new" && (
        <UserForm mode="create" onSubmit={handleCreate} onCancel={() => setEditingId(null)} />
      )}

      {loading ? (
        <p className="text-muted">Chargement…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((u) =>
            editingId === u.id ? (
              <UserForm
                key={u.id}
                mode="edit"
                initialRole={u.role}
                onSubmit={(input) => handleUpdate(u.id, input)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface p-4"
              >
                <div>
                  <p className="font-medium text-text">
                    {u.username}
                    {u.id === currentUser?.id && <span className="text-xs text-muted"> (toi)</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {u.role === "admin" ? "Admin" : "Lecture seule"}
                    {u.disabled && " · désactivé"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingId(u.id)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted hover:text-text"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => handleToggleDisabled(u)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted hover:text-text"
                  >
                    {u.disabled ? "Activer" : "Désactiver"}
                  </button>
                  <button
                    onClick={() => handleDelete(u.id)}
                    className="rounded-xl px-3 py-1.5 text-sm font-medium text-muted hover:text-danger"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
