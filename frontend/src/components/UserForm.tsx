import { useState, type FormEvent } from "react";

export interface UserFormInput {
  username?: string;
  password?: string;
  role: "admin" | "user";
}

export function UserForm({
  mode,
  initialUsername,
  initialRole,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initialUsername?: string;
  initialRole?: "admin" | "user";
  onSubmit: (input: UserFormInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(initialUsername ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">(initialRole ?? "user");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input: UserFormInput = { role };
      if (mode === "create") {
        input.username = username;
        input.password = password;
      } else if (password) {
        input.password = password;
      }
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      {mode === "create" && (
        <label className="flex flex-col gap-1 text-sm text-muted">
          Nom d'utilisateur
          <input
            className="rounded-xl border border-border bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-muted">
        {mode === "create" ? "Mot de passe" : "Nouveau mot de passe"}
        <input
          type="password"
          className="rounded-xl border border-border bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "edit" ? "Laisser vide pour ne pas changer" : ""}
          required={mode === "create"}
          minLength={8}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        Rôle
        <select
          className="rounded-xl border border-border bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "user")}
        >
          <option value="user">Utilisateur (lecture seule)</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-4 py-2 text-sm font-medium text-muted hover:text-text"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
