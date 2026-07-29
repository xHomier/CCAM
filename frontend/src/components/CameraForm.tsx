import { useState, type FormEvent } from "react";
import type { AiType, Camera, CameraInput } from "../lib/types";

const AI_TYPES: { value: AiType; label: string }[] = [
  { value: "person", label: "Personne" },
  { value: "vehicle", label: "Véhicule" },
  { value: "pet", label: "Animal" },
];

function fieldClass() {
  return "rounded-xl border border-border bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent";
}

export function CameraForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Camera;
  onSubmit: (input: Partial<CameraInput>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [rtspPort, setRtspPort] = useState(initial?.rtspPort ?? 554);
  const [httpPort, setHttpPort] = useState(initial?.httpPort ?? 80);
  const [username, setUsername] = useState(initial?.username ?? "admin");
  const [password, setPassword] = useState("");
  const [channel, setChannel] = useState(initial?.channel ?? 0);
  const [continuousStream, setContinuousStream] = useState<"sub" | "main">(
    initial?.continuousStream ?? "sub"
  );
  const [aiTypesEnabled, setAiTypesEnabled] = useState<AiType[]>(
    initial?.aiTypesEnabled ?? ["person", "vehicle", "pet"]
  );
  const [retentionDays, setRetentionDays] = useState(initial?.retentionDays ?? 14);
  const [eventRetentionDays, setEventRetentionDays] = useState(initial?.eventRetentionDays ?? 30);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleType(type: AiType) {
    setAiTypesEnabled((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input: Partial<CameraInput> = {
        name,
        host,
        rtspPort,
        httpPort,
        username,
        channel,
        continuousStream,
        aiTypesEnabled,
        retentionDays,
        eventRetentionDays,
        enabled,
      };
      if (password) input.password = password;
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Nom
          <input className={fieldClass()} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Adresse IP / hôte
          <input className={fieldClass()} value={host} onChange={(e) => setHost(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Port RTSP
          <input
            type="number"
            className={fieldClass()}
            value={rtspPort}
            onChange={(e) => setRtspPort(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Port API HTTP
          <input
            type="number"
            className={fieldClass()}
            value={httpPort}
            onChange={(e) => setHttpPort(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Utilisateur caméra
          <input
            className={fieldClass()}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Mot de passe caméra
          <input
            type="password"
            className={fieldClass()}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial ? "Laisser vide pour ne pas changer" : ""}
            required={!initial}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Canal
          <input
            type="number"
            className={fieldClass()}
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Flux d'enregistrement continu
          <select
            className={fieldClass()}
            value={continuousStream}
            onChange={(e) => setContinuousStream(e.target.value as "sub" | "main")}
          >
            <option value="sub">Sub (léger, 640x360)</option>
            <option value="main">Main (pleine résolution)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Rétention enregistrements (jours)
          <input
            type="number"
            className={fieldClass()}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Rétention événements (jours)
          <input
            type="number"
            className={fieldClass()}
            value={eventRetentionDays}
            onChange={(e) => setEventRetentionDays(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5 text-sm text-muted">
        Détection IA à surveiller
        <div className="flex gap-3">
          {AI_TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-1.5 text-text">
              <input
                type="checkbox"
                checked={aiTypesEnabled.includes(t.value)}
                onChange={() => toggleType(t.value)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-sm text-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Caméra active
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
