import type { Settings, Voice } from "../types.js";
import { VoiceError } from "./elevenlabs.js";

const SAMPLE_RATE = 24_000;
/** Frases que se sintetizan a la vez: la que suena y la siguiente. */
const MAX_IN_FLIGHT = 2;

export interface WavAudio {
  sampleRate: number;
  /** Muestras mono entre -1 y 1. */
  samples: Float32Array;
}

/** Lee un WAV (PCM de 8, 16, 24 o 32 bits, o float de 32) y lo deja en mono. */
export function parseWav(data: Buffer): WavAudio {
  if (data.length < 12 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw new VoiceError("El servidor de voz no devolvió un WAV.");
  }
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let body: Buffer | null = null;
  for (let pos = 12; pos + 8 <= data.length; ) {
    const id = data.toString("ascii", pos, pos + 4);
    const size = data.readUInt32LE(pos + 4);
    const start = pos + 8;
    // Algunos generadores dejan el tamaño del bloque de datos sin rellenar.
    const end = id === "data" && (size === 0 || start + size > data.length) ? data.length : start + size;
    if (id === "fmt " && end - start >= 16) {
      format = data.readUInt16LE(start);
      channels = data.readUInt16LE(start + 2);
      sampleRate = data.readUInt32LE(start + 4);
      bits = data.readUInt16LE(start + 14);
      // WAVE_FORMAT_EXTENSIBLE: el formato real va en el subformato.
      if (format === 0xfffe && end - start >= 26) format = data.readUInt16LE(start + 24);
    } else if (id === "data") {
      body = data.subarray(start, end);
      break;
    }
    pos = end + (size % 2);
  }
  if (!body || !channels || !sampleRate) throw new VoiceError("El WAV del servidor de voz está incompleto.");
  const bytes = bits / 8;
  if (!((format === 1 && [1, 2, 3, 4].includes(bytes)) || (format === 3 && bytes === 4))) {
    throw new VoiceError(`Formato de WAV no admitido (formato ${format}, ${bits} bits).`);
  }
  const frames = Math.floor(body.length / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = (i * channels + c) * bytes;
      if (format === 3) sum += body.readFloatLE(at);
      else if (bytes === 1) sum += (body.readUInt8(at) - 128) / 128;
      else if (bytes === 2) sum += body.readInt16LE(at) / 32768;
      else if (bytes === 3) sum += body.readIntLE(at, 3) / 8388608;
      else sum += body.readInt32LE(at) / 2147483648;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, samples };
}

/** Cambia la frecuencia de muestreo por interpolación lineal y devuelve PCM de 16 bits. */
export function toPcm16(audio: WavAudio, targetRate: number): Buffer {
  const { samples, sampleRate } = audio;
  const length = sampleRate === targetRate ? samples.length : Math.floor((samples.length * targetRate) / sampleRate);
  const out = Buffer.alloc(length * 2);
  const step = sampleRate / targetRate;
  for (let i = 0; i < length; i++) {
    const pos = i * step;
    const left = Math.floor(pos);
    const a = samples[left] ?? 0;
    const b = samples[left + 1] ?? a;
    const value = a + (b - a) * (pos - left);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2);
  }
  return out;
}

type LocalConfig = Pick<
  Settings["voice"],
  "localUrl" | "localModel" | "localVoice" | "localLang" | "localRefAudio" | "localRefText" | "speed"
>;

/**
 * Voz generada en este ordenador con un servidor compatible con la API de OpenAI
 * (mlx-audio en Apple Silicon). Cada frase se pide por separado y, mientras suena
 * una, ya se está generando la siguiente.
 */
export class LocalVoice implements Voice {
  readonly sampleRate = SAMPLE_RATE;

  constructor(private readonly config: LocalConfig) {}

  /** Genera una frase y la devuelve como PCM de 16 bits mono a 24 kHz. */
  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    const base = this.config.localUrl.trim().replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      model: this.config.localModel.trim(),
      input: text,
      response_format: "wav",
      speed: this.config.speed,
    };
    if (this.config.localVoice.trim()) body.voice = this.config.localVoice.trim();
    if (this.config.localLang.trim()) body.lang_code = this.config.localLang.trim();
    if (this.config.localRefAudio.trim()) body.ref_audio = this.config.localRefAudio.trim();
    if (this.config.localRefText.trim()) body.ref_text = this.config.localRefText.trim();

    let res: Response;
    try {
      res = await fetch(`${base}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new VoiceError(`No encuentro el servidor de voz local en ${base}. ¿Está arrancado?`);
    }
    if (!res.ok) {
      const detail = await res
        .json()
        .then((j: any) => (typeof j?.detail === "string" ? j.detail : ""))
        .catch(() => "");
      throw new VoiceError(`Voz local: ${detail || `error ${res.status} del servidor`}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    // El servidor responde 200 con el cuerpo vacío cuando el modelo falla al generar.
    if (data.length === 0) {
      throw new VoiceError("Voz local: el modelo no generó audio. Revisa la voz y el idioma en Ajustes.");
    }
    return toPcm16(parseWav(data), SAMPLE_RATE);
  }

  async speak(
    sentences: AsyncIterable<string>,
    onAudio: (pcm: Buffer) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const results: Promise<Buffer>[] = [];
    let finished = false;
    let inFlight = 0;
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };
    const wait = () => new Promise<void>((resolve) => (wake = resolve));

    let failure: unknown = null;
    const producer = (async () => {
      try {
        for await (const sentence of sentences) {
          while (inFlight >= MAX_IN_FLIGHT && !signal.aborted && !failure) await wait();
          if (signal.aborted || failure) return;
          inFlight++;
          const job = this.synthesize(sentence, signal).finally(() => {
            inFlight--;
            notify();
          });
          job.catch(() => {});
          results.push(job);
          notify();
        }
      } catch (err) {
        failure = err;
      } finally {
        finished = true;
        notify();
      }
    })();

    try {
      for (let i = 0; ; i++) {
        while (i >= results.length && !finished) await wait();
        if (i >= results.length) break;
        const pcm = await results[i];
        if (signal.aborted) return;
        onAudio(pcm);
      }
    } catch (err) {
      if (signal.aborted) return;
      failure = err;
      notify();
    }
    await producer;
    if (failure && !signal.aborted) throw failure;
  }

  /** Voces que ofrece el modelo configurado, si el servidor sabe listarlas. */
  async listVoices(): Promise<string[]> {
    const base = this.config.localUrl.trim().replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/v1/audio/voices?model=${encodeURIComponent(this.config.localModel.trim())}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const json: any = await res.json();
      return Array.isArray(json?.data)
        ? json.data.map((v: any) => (typeof v === "string" ? v : String(v?.id ?? v?.name ?? ""))).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
}
