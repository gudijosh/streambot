import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, MessageKind, Platform } from "./types.js";

/** Créditos de ElevenLabs por carácter según el modelo de voz (aproximado). */
function creditsPerChar(voiceModel: string): number {
  return /flash|turbo/.test(voiceModel) ? 0.5 : 1;
}

/** Estadísticas del directo en curso. */
export class Stats {
  readonly startedAt = Date.now();
  private messages = 0;
  private readonly byPlatform: Partial<Record<Platform, number>> = {};
  private readonly byKind: Partial<Record<MessageKind, number>> = {};
  private readonly chatters = new Map<string, number>();
  private utterances = 0;
  private charsSpoken = 0;
  private peakPerMinute = 0;
  private window: number[] = [];

  message(msg: ChatMessage): void {
    this.messages++;
    this.byPlatform[msg.platform] = (this.byPlatform[msg.platform] ?? 0) + 1;
    this.byKind[msg.kind] = (this.byKind[msg.kind] ?? 0) + 1;
    const key = `${msg.platform}:${msg.user}`;
    this.chatters.set(key, (this.chatters.get(key) ?? 0) + 1);
    this.window.push(msg.ts);
    while (this.window.length && msg.ts - this.window[0] > 60_000) this.window.shift();
    this.peakPerMinute = Math.max(this.peakPerMinute, this.window.length);
  }

  spoken(text: string): void {
    if (!text) return;
    this.utterances++;
    this.charsSpoken += text.length;
  }

  snapshot(voiceModel: string, hasVoice: boolean) {
    const now = Date.now();
    const top = [...this.chatters.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ platform: key.slice(0, key.indexOf(":")), user: key.slice(key.indexOf(":") + 1), count }));
    return {
      startedAt: this.startedAt,
      minutes: Math.round((now - this.startedAt) / 60_000),
      messages: this.messages,
      perMinute: this.window.filter((t) => now - t <= 60_000).length,
      peakPerMinute: this.peakPerMinute,
      chatters: this.chatters.size,
      byPlatform: this.byPlatform,
      events: {
        sub: this.byKind.sub ?? 0,
        gift: this.byKind.gift ?? 0,
        follow: this.byKind.follow ?? 0,
        donation: this.byKind.donation ?? 0,
      },
      top,
      utterances: this.utterances,
      charsSpoken: this.charsSpoken,
      voiceCredits: hasVoice ? Math.round(this.charsSpoken * creditsPerChar(voiceModel)) : 0,
    };
  }

  /** Guarda el resumen del directo para poder consultarlo después. */
  saveSummary(dir: string, voiceModel: string, hasVoice: boolean): void {
    if (this.messages === 0 && this.utterances === 0) return;
    fs.mkdirSync(dir, { recursive: true });
    const name = new Date(this.startedAt).toISOString().replace(/[:.]/g, "-") + ".json";
    fs.writeFileSync(path.join(dir, name), JSON.stringify(this.snapshot(voiceModel, hasVoice), null, 2));
  }
}
