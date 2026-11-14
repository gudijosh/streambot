import type { Brain, BrainInput } from "../types.js";
import { BrainError, buildUserTurn } from "./brain.js";

/**
 * Quita del texto los bloques <think>…</think> que algunos modelos locales escriben
 * antes de responder, aunque la etiqueta llegue partida entre trozos.
 */
export class ThinkStripper {
  private buffer = "";
  private thinking = false;

  push(delta: string): string {
    this.buffer += delta;
    let out = "";
    for (;;) {
      const tag = this.thinking ? "</think>" : "<think>";
      const at = this.buffer.indexOf(tag);
      if (at !== -1) {
        if (!this.thinking) out += this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + tag.length);
        this.thinking = !this.thinking;
        continue;
      }
      // Se retiene el final por si es el principio de una etiqueta a medias.
      let keep = 0;
      for (let n = Math.min(tag.length - 1, this.buffer.length); n > 0; n--) {
        if (tag.startsWith(this.buffer.slice(-n))) {
          keep = n;
          break;
        }
      }
      if (!this.thinking) out += this.buffer.slice(0, this.buffer.length - keep);
      this.buffer = this.buffer.slice(this.buffer.length - keep);
      return out;
    }
  }

  flush(): string {
    const rest = this.thinking ? "" : this.buffer;
    this.buffer = "";
    return rest;
  }
}

/**
 * Cerebro en este ordenador: un modelo servido por Ollama (o cualquier servidor con
 * la API de chat de OpenAI). No ve imágenes, así que ignora las capturas del juego.
 */
export class LocalBrain implements Brain {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly persona: string,
  ) {}

  async *reply(input: BrainInput, signal: AbortSignal): AsyncIterable<string> {
    const base = this.baseUrl.trim().replace(/\/+$/, "");
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model.trim(),
          stream: true,
          max_tokens: 300,
          messages: [
            { role: "system", content: this.persona },
            { role: "user", content: buildUserTurn({ ...input, image: undefined }) },
          ],
        }),
        signal,
      });
    } catch {
      if (signal.aborted) return;
      throw new BrainError(`No encuentro el modelo local en ${base}. ¿Está Ollama abierto?`, true);
    }
    if (!res.ok || !res.body) {
      const detail = await res
        .json()
        .then((j: any) => j?.error?.message ?? j?.detail ?? "")
        .catch(() => "");
      const text = String(detail || `error ${res.status}`);
      throw new BrainError(`Modelo local "${this.model}": ${text}`, res.status === 404 || res.status === 400);
    }

    const stripper = new ThinkStripper();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      for await (const chunk of res.body) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.trim();
          if (!data.startsWith("data:")) continue;
          const payload = data.slice(5).trim();
          if (payload === "[DONE]") continue;
          let delta: unknown;
          try {
            delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          } catch {
            continue;
          }
          if (typeof delta !== "string" || !delta) continue;
          const text = stripper.push(delta);
          if (text) yield text;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      throw new BrainError(`Se cortó la respuesta del modelo local: ${(err as Error).message}`, false);
    }
    const rest = stripper.flush();
    if (rest) yield rest;
  }
}
