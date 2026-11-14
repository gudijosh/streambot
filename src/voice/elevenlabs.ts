import WebSocket from "ws";
import type { Settings, Voice } from "../types.js";

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
            ws.send(JSON.stringify({ text: sentence + " ", flush: true }));
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

/** Sin clave o sin voz elegida: no hay audio y el overlay muestra solo subtítulos. */
export class SilentVoice implements Voice {
  readonly sampleRate = SAMPLE_RATE;

  async speak(sentences: AsyncIterable<string>, _onAudio: (pcm: Buffer) => void): Promise<void> {
    for await (const _ of sentences) {
      // Se consume el texto para que los subtítulos sigan saliendo.
    }
  }
}
