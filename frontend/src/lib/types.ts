export type AiType = "person" | "vehicle" | "pet";

export interface Camera {
  id: number;
  name: string;
  host: string;
  rtspPort: number;
  httpPort: number;
  username: string;
  channel: number;
  continuousStream: "sub" | "main";
  aiTypesEnabled: AiType[];
  pollIntervalMs: number;
  eventCooldownMs: number;
  retentionDays: number;
  eventRetentionDays: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CameraInput {
  name: string;
  host: string;
  rtspPort: number;
  httpPort: number;
  username: string;
  password: string;
  channel: number;
  continuousStream: "sub" | "main";
  aiTypesEnabled: AiType[];
  pollIntervalMs: number;
  eventCooldownMs: number;
  retentionDays: number;
  eventRetentionDays: number;
  enabled: boolean;
}

export interface CcamEvent {
  id: number;
  cameraId: number;
  type: AiType | "motion";
  startedAt: string;
  endedAt: string | null;
  clipPath: string | null;
  thumbnailPath: string | null;
  createdAt: string;
}

export interface AppUser {
  id: number;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
}

export interface RecordingSegment {
  file: string;
  startedAt: string;
  sizeBytes: number;
  url: string;
}
