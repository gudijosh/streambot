import WebSocket from "ws";
import type { Settings, Voice } from "../types.js";
import { stripTags } from "./tags.js";

export class VoiceError extends Error {}

const SAMPLE_RATE = 24_000;

/**
 * Voz por streaming con ElevenLabs: se abre un WebSocket por intervención, se envían
 * las frases según las genera el modelo y el audio PCM vuelve en trozos.
 */
export class ElevenLabsVoice implements Voice {
  readonly sampleRate = SAMPLE_RATE;

  constructor(
    private readonly apiKey: string,
    private readonly config: Settings["voice"],
  ) {}

  speak(
    sentences: AsyncIterable<string>,
    onAudio: (pcm: Buffer) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const params = new URLSearchParams({
      model_id: this.config.modelId,
      output_format: `pcm_${SAMPLE_RATE}`,
      language_code: "es",
    });
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.config.voiceId)}/stream-input?${params}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
        if (err) reject(err);
        else resolve();
      };
      const onAbort = () => finish();
      signal.addEventListener("abort", onAbort);

      ws.on("open", async () => {
        try {
          ws.send(
            JSON.stringify({
              text: " ",
              voice_settings: {
                stability: this.config.stability,
                similarity_boost: this.config.similarity,
                speed: this.config.speed,
              },
            }),
          );
          for await (const sentence of sentences) {
            if (settled) return;
            // El modelo rápido leería las indicaciones de tono en voz alta: se quitan.
            const clean = stripTags(sentence);
            if (clean) ws.send(JSON.stringify({ text: clean + " ", flush: true }));
          }
          if (!settled) ws.send(JSON.stringify({ text: "" }));
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on("message", (raw) => {
        let data: { audio?: string | null; isFinal?: boolean; error?: string; message?: string };
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (data.error || (data.message && !data.audio && data.isFinal === undefined)) {
          finish(new VoiceError(`ElevenLabs: ${data.message ?? data.error}`));
          return;
        }
        if (data.audio) onAudio(Buffer.from(data.audio, "base64"));
        if (data.isFinal) finish();
      });

      ws.on("unexpected-response", (_req, res) => {
        const hint =
          res.statusCode === 401
            ? "clave de ElevenLabs no válida"
            : res.statusCode === 404
              ? "no existe esa voz (revisa el ID de voz)"
              : `respuesta ${res.statusCode}`;
        finish(new VoiceError(`ElevenLabs: ${hint}.`));
      });
      ws.on("error", (err) => finish(new VoiceError(`ElevenLabs: ${err.message}`)));
      ws.on("close", () => finish());
    });
  }
}

const API = "https://api.elevenlabs.io";

/**
 * Voz expresiva de ElevenLabs (v3/v4): entiende indicaciones de tono entre corchetes y
 * suena más humana, pero tarda más. Genera cada intervención entera en una sola
 * petición para no perder la entonación entre frases. Se usa al jugar solo y al
 * narrar clips; en el directo con chat se usa la voz rápida.
 */
export class ElevenLabsExpressiveVoice implements Voice {
  readonly sampleRate = SAMPLE_RATE;
  readonly tags = true;

  constructor(
    private readonly apiKey: string,
    private readonly config: Pick<Settings["voice"], "voiceId" | "expressiveModelId" | "accentTag">,
    private readonly baseUrl = API,
  ) {}

  /** Texto tal como se envía: con la indicación de acento delante, salvo que ya la lleve. */
  prepare(text: string): string {
    const accent = this.config.accentTag.trim();
    const body = text.trim();
    return accent && !body.startsWith(accent) ? `${accent} ${body}` : body;
  }

  async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    const url = `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(this.config.voiceId)}?output_format=pcm_${SAMPLE_RATE}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "audio/pcm" },
        body: JSON.stringify({ text: this.prepare(text), model_id: this.config.expressiveModelId }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new VoiceError(`ElevenLabs: sin conexión (${(err as Error).message}).`);
    }
    if (!res.ok) {
      const detail = await res
        .json()
        .then((j: any) => j?.detail?.message ?? (typeof j?.detail === "string" ? j.detail : ""))
        .catch(() => "");
      const hint =
        res.status === 401
          ? "clave de ElevenLabs no válida"
          : res.status === 404
            ? "no existe esa voz en tu cuenta (añádela a «Mis voces» desde la biblioteca)"
            : detail || `respuesta ${res.status}`;
      throw new VoiceError(`ElevenLabs: ${hint}.`);
    }
    const pcm = Buffer.from(await res.arrayBuffer());
    // PCM de 16 bits: si llega un byte suelto al final, se descarta.
    return pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm;
  }

  async speak(sentences: AsyncIterable<string>, onAudio: (pcm: Buffer) => void, signal: AbortSignal): Promise<void> {
    const parts: string[] = [];
    for await (const sentence of sentences) {
      if (signal.aborted) return;
      parts.push(sentence);
    }
    const text = parts.join(" ").trim();
    if (!text || signal.aborted) return;
    const pcm = await this.synthesize(text, signal);
    if (!signal.aborted && pcm.length) onAudio(pcm);
  }
}

/** Sin clave o sin voz elegida: no hay audio y el overlay muestra solo subtítulos. */
export class SilentVoice implements Voice {
  readonly sampleRate = SAMPLE_RATE;

  async speak(sentences: AsyncIterable<string>, _onAudio: (pcm: Buffer) => void): Promise<void> {
    for await (const _ of sentences) {
      // Se consume el texto para que los subtítulos sigan saliendo.
    }
  }
}
