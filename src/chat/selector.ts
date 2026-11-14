import type { ChatMessage } from "../types.js";

export interface Selection {
  mode: "reply" | "summary";
  messages: ChatMessage[];
}

const MAX_PENDING = 60;
const MAX_AGE_MS = 45_000;
const EVENT_MAX_AGE_MS = 120_000;
/** A partir de este número de mensajes en espera se resume el chat en vez de contestar uno a uno. */
const BUSY_THRESHOLD = 12;
const SUMMARY_SAMPLE = 8;

/** Guarda los mensajes aptos y elige a cuáles responde el personaje en cada intervención. */
export class Selector {
  private pending: ChatMessage[] = [];
  private lastAnswered = new Map<string, number>();

  add(msg: ChatMessage): void {
    this.pending.push(msg);
    if (this.pending.length > MAX_PENDING) {
      // Se descarta primero el chat normal más antiguo; los eventos se conservan.
      const idx = this.pending.findIndex((m) => m.kind === "chat");
      this.pending.splice(idx === -1 ? 0 : idx, 1);
    }
  }

  get size(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
  }

  pick(now: number, maxPerTurn: number): Selection | null {
    this.pending = this.pending.filter(
      (m) => now - m.ts < (m.kind === "chat" ? MAX_AGE_MS : EVENT_MAX_AGE_MS),
    );
    if (this.pending.length === 0) return null;

    const events = this.pending.filter((m) => m.kind !== "chat");
    const chat = this.pending.filter((m) => m.kind === "chat");

    if (chat.length > BUSY_THRESHOLD) {
      const sample = [...events.slice(0, 2), ...this.diverse(chat, SUMMARY_SAMPLE, now)];
      this.pending = [];
      this.markAnswered(sample, now);
      return { mode: "summary", messages: sample };
    }

    const chosen = [...events.slice(0, maxPerTurn)];
    if (chosen.length < maxPerTurn) {
      chosen.push(...this.diverse(chat, maxPerTurn - chosen.length, now));
    }
    const ids = new Set(chosen.map((m) => m.id));
    this.pending = this.pending.filter((m) => !ids.has(m.id));
    this.markAnswered(chosen, now);
    return { mode: "reply", messages: chosen };
  }

  /** Los más recientes primero, un mensaje por usuario, dando preferencia a quien lleva más sin respuesta. */
  private diverse(chat: ChatMessage[], count: number, now: number): ChatMessage[] {
    const seen = new Set<string>();
    const unique: ChatMessage[] = [];
    for (const m of [...chat].reverse()) {
      const key = `${m.platform}:${m.user}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(m);
    }
    const waited = (m: ChatMessage) => now - (this.lastAnswered.get(`${m.platform}:${m.user}`) ?? 0);
    const fresh = unique.filter((m) => waited(m) > 60_000);
    const rest = unique.filter((m) => waited(m) <= 60_000);
    return [...fresh, ...rest].slice(0, count).sort((a, b) => a.ts - b.ts);
  }

  private markAnswered(messages: ChatMessage[], now: number): void {
    for (const m of messages) this.lastAnswered.set(`${m.platform}:${m.user}`, now);
    if (this.lastAnswered.size > 2000) {
      for (const [k, t] of this.lastAnswered) if (now - t > 600_000) this.lastAnswered.delete(k);
    }
  }
}
