import type { Camera } from "../db/schema";

export type AiType = "person" | "vehicle" | "pet";

const AI_FIELD_BY_TYPE: Record<AiType, string> = {
  person: "people",
  vehicle: "vehicle",
  pet: "dog_cat",
};

interface LoginResponse {
  code: number;
  error?: string;
}

/**
 * Thin client for a Reolink camera's CGI HTTP API. Only implements Login +
 * GetAiState, which is all CCAM needs -- it relies on the camera's onboard
 * AI detection rather than running its own ML pipeline.
 */
export class ReolinkClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly camera: Camera) {}

  private get baseUrl() {
    return `http://${this.camera.host}:${this.camera.httpPort}/cgi-bin/api.cgi`;
  }

  private async login(): Promise<string> {
    const res = await fetch(`${this.baseUrl}?cmd=Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          cmd: "Login",
          action: 0,
          param: {
            User: { userName: this.camera.username, password: this.camera.password },
          },
        },
      ]),
    });

    if (!res.ok) {
      throw new Error(`Reolink login HTTP ${res.status}`);
    }

    const data = (await res.json()) as Array<{
      code: number;
      value?: { Token?: { name: string; leaseTime: number } };
      error?: LoginResponse;
    }>;

    const entry = data[0];
    if (entry.code !== 0 || !entry.value?.Token) {
      throw new Error(`Reolink login failed: ${JSON.stringify(entry.error ?? entry)}`);
    }

    this.token = entry.value.Token.name;
    // Refresh a bit before actual expiry to avoid a race on the next poll.
    this.tokenExpiresAt = Date.now() + (entry.value.Token.leaseTime - 30) * 1000;
    return this.token;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    return this.login();
  }

  /** Returns which AI types currently have an active alarm on the camera. */
  async getActiveAiTypes(enabledTypes: AiType[]): Promise<Set<AiType>> {
    const token = await this.getToken();
    const res = await fetch(
      `${this.baseUrl}?cmd=GetAiState&channel=${this.camera.channel}&token=${token}`
    );

    if (res.status === 401) {
      // Token expired/invalid server-side even though we thought it was fresh.
      this.token = null;
      return this.getActiveAiTypes(enabledTypes);
    }
    if (!res.ok) {
      throw new Error(`Reolink GetAiState HTTP ${res.status}`);
    }

    const data = (await res.json()) as Array<{
      code: number;
      value?: Record<string, { alarm_state?: number; support?: number }>;
    }>;

    const entry = data[0];
    if (entry.code !== 0 || !entry.value) {
      throw new Error(`Reolink GetAiState failed: ${JSON.stringify(entry)}`);
    }

    const active = new Set<AiType>();
    for (const type of enabledTypes) {
      const field = entry.value[AI_FIELD_BY_TYPE[type]];
      if (field?.alarm_state === 1) {
        active.add(type);
      }
    }
    return active;
  }
}
