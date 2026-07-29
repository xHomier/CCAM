import type { Camera } from "../db/schema";

export function streamName(cameraId: number) {
  return `cam${cameraId}`;
}

export function rtspUrl(camera: Camera, stream: "main" | "sub") {
  const suffix = stream === "main" ? "h264Preview_01_main" : "h264Preview_01_sub";
  const user = encodeURIComponent(camera.username);
  const pass = encodeURIComponent(camera.password);
  return `rtsp://${user}:${pass}@${camera.host}:${camera.rtspPort}/${suffix}`;
}

/** Registers/updates a camera's RTSP source as a go2rtc stream for live view. */
export async function syncStream(go2rtcApiUrl: string, camera: Camera) {
  // Reolink cameras typically send audio as G.711, which browsers can't
  // decode via MSE (this is what was throwing "bufferAppendError" on the
  // audio source buffer for live view). Route through go2rtc's ffmpeg
  // producer so audio gets transcoded to AAC while video stays a cheap
  // stream-copy -- the live view is muted anyway, but MSE still needs the
  // audio track it's handed to be a codec it understands.
  const src = `ffmpeg:${rtspUrl(camera, "main")}#video=copy#audio=aac`;
  const url = `${go2rtcApiUrl}/api/streams?name=${encodeURIComponent(
    streamName(camera.id)
  )}&src=${encodeURIComponent(src)}`;

  const res = await fetch(url, { method: "PUT" });
  if (!res.ok) {
    throw new Error(`go2rtc stream sync failed (${res.status}): ${await res.text()}`);
  }
}

export async function removeStream(go2rtcApiUrl: string, cameraId: number) {
  const url = `${go2rtcApiUrl}/api/streams?src=${encodeURIComponent(streamName(cameraId))}`;
  await fetch(url, { method: "DELETE" }).catch(() => {
    /* best-effort cleanup, camera row is already gone either way */
  });
}
