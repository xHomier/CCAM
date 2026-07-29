import { spawn } from "node:child_process";
import fs from "node:fs";

/**
 * Reads the container duration via ffprobe without decoding frames --
 * cheap enough to run on every suspect file. Returns null if ffprobe
 * can't parse the file at all (corrupt/truncated) or reports no usable
 * duration, which we treat as "not a valid, playable mp4".
 */
function probeDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      if (code !== 0 || stderr.trim().length > 0) {
        resolve(null);
        return;
      }
      const duration = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}

/**
 * Deletes `filePath` if it isn't a valid, playable mp4 -- catches segments
 * left truncated/corrupt by an ffmpeg crash or an abrupt container restart
 * mid-write (the file ffmpeg was actively writing when it died). Returns
 * true if the file was deleted. Never throws.
 */
export async function validateAndPruneSegment(filePath: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;

  const duration = await probeDurationSeconds(filePath);
  if (duration !== null) return false;

  try {
    fs.unlinkSync(filePath);
    // eslint-disable-next-line no-console
    console.warn(`[recording] deleted corrupted segment: ${filePath}`);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[recording] failed to delete corrupted segment ${filePath}:`, err);
    return false;
  }
}
