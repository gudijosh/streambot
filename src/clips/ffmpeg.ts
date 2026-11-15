import { spawn } from "node:child_process";

export type ClipFormat = "horizontal" | "vertical-crop" | "vertical-blur";

export interface ExportOptions {
  input: string;
  output: string;
  /** Segundos desde el inicio del vídeo. */
  start: number;
  end: number;
  format: ClipFormat;
  /** Posición horizontal del recorte vertical: 0 = izquierda, 0.5 = centro, 1 = derecha. */
  cropX: number;
  /** Ruta del logo para la marca de agua, si se quiere. */
  watermark?: string;
}

export function isClipFormat(value: unknown): value is ClipFormat {
  return value === "horizontal" || value === "vertical-crop" || value === "vertical-blur";
}

/** Argumentos de ffmpeg para recortar un clip, pasarlo a vertical y ponerle la marca de agua. */
export function buildFfmpegArgs(o: ExportOptions): string[] {
  const x = Math.min(1, Math.max(0, o.cropX)).toFixed(3);
  const steps: string[] = [];
  if (o.format === "vertical-crop") {
    steps.push(`[0:v]crop=ih*9/16:ih:(iw-ih*9/16)*${x}:0,scale=1080:1920,setsar=1[base]`);
  } else if (o.format === "vertical-blur") {
    steps.push(
      "[0:v]split[a][b]",
      "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4[bg]",
      "[b]scale=1080:-2[fg]",
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]",
    );
  } else {
    steps.push("[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[base]");
  }
  if (o.watermark) {
    const width = o.format === "horizontal" ? 200 : 240;
    steps.push(`[1:v]scale=${width}:-1[wm]`, "[base][wm]overlay=main_w-overlay_w-40:40[v]");
  } else {
    steps.push("[base]null[v]");
  }

  return [
    "-y",
    "-ss", o.start.toFixed(3),
    "-to", o.end.toFixed(3),
    "-i", o.input,
    ...(o.watermark ? ["-i", o.watermark] : []),
    "-filter_complex", steps.join(";"),
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    o.output,
  ];
}

function works(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/** Busca ffmpeg: la ruta de los ajustes, el del sistema y las rutas habituales de Homebrew. */
export async function findFfmpeg(custom: string): Promise<string | null> {
  const candidates = [custom, "ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter(Boolean);
  for (const bin of candidates) if (await works(bin)) return bin;
  return null;
}

/** Ejecuta ffmpeg informando del progreso (0 a 1). Se puede cancelar con la señal. */
export function runFfmpeg(
  bin: string,
  args: string[],
  durationSec: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", onAbort);

    child.stdout.on("data", (chunk: Buffer) => {
      const match = /out_time_(?:us|ms)=(\d+)/.exec(chunk.toString());
      if (match && durationSec > 0) onProgress(Math.min(1, Number(match[1]) / 1e6 / durationSec));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`));
    });
    child.on("exit", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new Error("Exportación cancelada."));
      else if (code === 0) resolve();
      else {
        const lines = stderr.trim().split("\n");
        reject(new Error(`ffmpeg falló: ${lines.at(-1) ?? `código ${code}`}`));
      }
    });
  });
}
