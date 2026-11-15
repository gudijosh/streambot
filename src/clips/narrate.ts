import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Voice } from "../types.js";
import { runFfmpeg } from "./ffmpeg.js";

/** Duración máxima del tramo que se narra. */
export const MAX_NARRATION_SECONDS = 180;
/** Fotogramas como máximo que se envían a la IA. */
const MAX_FRAMES = 60;
/** Silencio mínimo entre dos frases del narrador. */
const GAP_SECONDS = 0.3;

export interface ScriptLine {
  /** Segundo, desde el inicio del tramo, en el que empieza la frase. */
  start: number;
  text: string;
}

export interface Frame {
  /** Segundo, desde el inicio del tramo. */
  t: number;
  /** JPEG en base64. */
  jpeg: string;
}

export interface PlacedLine {
  start: number;
  end: number;
  text: string;
  pcm: Buffer;
}

export interface MediaInfo {
  duration: number;
  hasAudio: boolean;
}

/** Lee la duración y si hay audio a partir de lo que ffmpeg imprime al abrir el archivo. */
export function parseMediaInfo(stderr: string): MediaInfo | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return { duration, hasAudio: /Stream #\S+.*Audio:/.test(stderr) };
}

export function probeMedia(bin: string, file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`)));
    child.on("exit", () => {
      const info = parseMediaInfo(stderr);
      if (info) resolve(info);
      else reject(new Error("ffmpeg no pudo leer el vídeo."));
    });
  });
}

/** Cada cuántos segundos se toma un fotograma para que no pasen de MAX_FRAMES. */
export function frameInterval(duration: number): number {
  return Math.max(2, Math.ceil(duration / MAX_FRAMES));
}

/** Argumentos para sacar un fotograma cada `every` segundos del tramo, como JPEG reducidos. */
export function buildFrameArgs(input: string, start: number, end: number, every: number, outPattern: string): string[] {
  return [
    "-y",
    "-ss", start.toFixed(3),
    "-to", end.toFixed(3),
    "-i", input,
    "-vf", `fps=1/${every},scale=768:-2`,
    "-q:v", "5",
    outPattern,
  ];
}

/**
 * Coloca las frases en el tiempo sin que se pisen: si una empieza antes de que acabe
 * la anterior, se retrasa. Las que ya no caben en el tramo se descartan.
 */
export function placeLines(
  lines: { start: number; text: string; pcm: Buffer }[],
  sampleRate: number,
  duration: number,
): PlacedLine[] {
  const placed: PlacedLine[] = [];
  let cursor = 0;
  for (const line of [...lines].sort((a, b) => a.start - b.start)) {
    const length = line.pcm.length / 2 / sampleRate;
    if (length <= 0) continue;
    const start = Math.max(line.start, cursor, 0);
    if (start + length > duration + 0.5) continue;
    placed.push({ start, end: start + length, text: line.text, pcm: line.pcm });
    cursor = start + length + GAP_SECONDS;
  }
  return placed;
}

/** Monta la pista de narración (PCM de 16 bits mono) con la duración exacta del tramo. */
export function mixNarration(placed: PlacedLine[], sampleRate: number, duration: number): Buffer {
  const total = Math.ceil(duration * sampleRate);
  const out = Buffer.alloc(total * 2);
  for (const line of placed) {
    const offset = Math.round(line.start * sampleRate);
    const samples = line.pcm.length / 2;
    for (let i = 0; i < samples && offset + i < total; i++) {
      out.writeInt16LE(line.pcm.readInt16LE(i * 2), (offset + i) * 2);
    }
  }
  return out;
}

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** Subtítulos en formato SRT, partiendo las frases largas en dos líneas. */
export function toSrt(placed: PlacedLine[]): string {
  return placed
    .map((line, i) => {
      const words = line.text.split(/\s+/);
      let text = line.text;
      if (line.text.length > 42 && words.length > 3) {
        let first = "";
        while (words.length && (first + " " + words[0]).trim().length <= line.text.length / 2 + 4) {
          first = (first + " " + words.shift()).trim();
        }
        text = `${first}\n${words.join(" ")}`;
      }
      return `${i + 1}\n${srtTime(line.start)} --> ${srtTime(line.end)}\n${text}\n`;
    })
    .join("\n");
}

export interface MixOptions {
  input: string;
  start: number;
  end: number;
  narration: string;
  output: string;
  hasAudio: boolean;
  /**
   * Nombre (sin ruta) del SRT para grabar los subtítulos en la imagen. ffmpeg se
   * ejecuta en la carpeta del archivo para no tener que escapar la ruta en el filtro.
   */
  subtitles?: string;
}

/**
 * Argumentos para unir vídeo, juego y narración: el sonido del juego baja solo mientras
 * habla el personaje (compresión con cadena lateral) y, si se pide, se graban los subtítulos.
 */
export function buildNarrationMixArgs(o: MixOptions): string[] {
  const steps: string[] = [];
  steps.push(
    o.subtitles
      ? `[0:v]subtitles=filename=${o.subtitles}:force_style='FontName=Arial,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=36',setsar=1[v]`
      : "[0:v]setsar=1[v]",
  );
  if (o.hasAudio) {
    steps.push(
      "[1:a]aresample=48000,asplit=2[voz][lado]",
      "[0:a]aresample=48000[juego]",
      "[juego][lado]sidechaincompress=threshold=0.015:ratio=10:attack=15:release=450[juegobajo]",
      "[juegobajo][voz]amix=inputs=2:duration=first:normalize=0[a]",
    );
  } else {
    steps.push("[1:a]aresample=48000[a]");
  }
  return [
    "-y",
    "-ss", o.start.toFixed(3),
    "-to", o.end.toFixed(3),
    "-i", o.input,
    "-i", o.narration,
    "-filter_complex", steps.join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    o.output,
  ];
}

/** Convierte una frase en PCM con cualquier motor de voz. */
export async function speakToPcm(voice: Voice, text: string, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await voice.speak(
    (async function* () {
      yield text;
    })(),
    (pcm) => chunks.push(pcm),
    signal,
  );
  return Buffer.concat(chunks);
}

export interface NarrateDeps {
  ffmpeg: string;
  voice: Voice;
  /** Pide a la IA el guion a partir de los fotogramas. */
  script(frames: Frame[], duration: number, signal: AbortSignal): Promise<ScriptLine[]>;
  progress(stage: string, fraction: number): void;
}

export interface NarrateRequest {
  input: string;
  start: number;
  end: number;
  output: string;
  subtitles: boolean;
}

export interface NarrateResult {
  lines: PlacedLine[];
}

/** Narra un tramo de vídeo: fotogramas → guion → voz → mezcla. */
export async function narrateClip(req: NarrateRequest, deps: NarrateDeps, signal: AbortSignal): Promise<NarrateResult> {
  const info = await probeMedia(deps.ffmpeg, req.input);
  const end = Math.min(req.end, info.duration);
  const duration = end - req.start;
  if (!(duration > 1)) throw new Error("Marca un tramo de al menos un segundo.");
  if (duration > MAX_NARRATION_SECONDS) throw new Error("Para narrar, marca un tramo de 3 minutos como mucho.");

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "streambot-narra-"));
  try {
    deps.progress("Mirando el vídeo", 0);
    const every = frameInterval(duration);
    await runFfmpeg(deps.ffmpeg, buildFrameArgs(req.input, req.start, end, every, path.join(work, "f%03d.jpg")), duration, (f) => deps.progress("Mirando el vídeo", f * 0.1), signal);
    const frames: Frame[] = fs
      .readdirSync(work)
      .filter((f) => /^f\d+\.jpg$/.test(f))
      .sort()
      .map((f, i) => ({ t: i * every, jpeg: fs.readFileSync(path.join(work, f)).toString("base64") }));
    if (!frames.length) throw new Error("No se pudieron sacar fotogramas del vídeo.");

    deps.progress("Escribiendo la narración", 0.1);
    const script = (await deps.script(frames, duration, signal))
      .map((l) => ({ start: Number(l.start), text: String(l.text ?? "").trim() }))
      .filter((l) => Number.isFinite(l.start) && l.text && l.start < duration);
    if (!script.length) throw new Error("La IA no escribió ninguna frase para este tramo; prueba con una nota que diga qué pasa.");

    const voiced: { start: number; text: string; pcm: Buffer }[] = [];
    for (const [i, line] of script.entries()) {
      deps.progress(`Poniendo voz (${i + 1}/${script.length})`, 0.25 + (0.45 * i) / script.length);
      const pcm = await speakToPcm(deps.voice, line.text, signal);
      if (signal.aborted) throw new Error("Narración cancelada.");
      voiced.push({ ...line, pcm });
    }
    if (!voiced.some((v) => v.pcm.length)) {
      throw new Error("La voz no generó audio. Revisa la voz en Ajustes → Co-host y voz.");
    }

    const placed = placeLines(voiced, deps.voice.sampleRate, duration);
    const narration = path.join(work, "narracion.wav");
    fs.writeFileSync(narration, pcmToWav(mixNarration(placed, deps.voice.sampleRate, duration), deps.voice.sampleRate));
    let subtitles: string | undefined;
    if (req.subtitles) {
      subtitles = "narracion.srt";
      fs.writeFileSync(path.join(work, subtitles), toSrt(placed));
    }

    deps.progress("Montando el vídeo", 0.7);
    await runFfmpeg(
      deps.ffmpeg,
      buildNarrationMixArgs({ input: req.input, start: req.start, end, narration, output: req.output, hasAudio: info.hasAudio, subtitles }),
      duration,
      (f) => deps.progress("Montando el vídeo", 0.7 + f * 0.3),
      signal,
      work,
    );
    return { lines: placed };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
