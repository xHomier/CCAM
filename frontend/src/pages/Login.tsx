import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Logo } from "../components/Logo";
import { ApiError } from "../lib/apiClient";

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? "/live";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate("/live", { replace: true });
    } catch (err) {
      // Distinguish rejected credentials from the server being unreachable or
      // erroring -- collapsing both into one message made a proxy/session
      // problem look identical to a typo.
      if (err instanceof ApiError) {
        setError(
          err.status === 401 ? "Identifiants invalides." : `Erreur serveur (${err.status}).`
        );
      } else {
        setError("Impossible de joindre le serveur.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo size={40} />
          <h1 className="text-xl font-semibold tracking-tight">CCAM</h1>
          <p className="text-sm text-muted">Connexion à ton système de surveillance</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-sm font-medium text-muted">
              Nom d'utilisateur
            </label>
            {/* iOS defaults a text input to sentence capitalisation, so typing
                "admin" actually submits "Admin" -- and autocorrect can rewrite
                it outright. That is why login worked on desktop but never on
                the phone. */}
            <input
              id="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-muted">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
