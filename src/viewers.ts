import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "./types.js";

interface ViewerRecord {
  first: number;
  last: number;
  /** Número de directos en los que ha escrito. */
  streams: number;
  messages: number;
}

const MAX_VIEWERS = 20_000;

/**
 * Recuerda quién ha escrito en directos anteriores para que el personaje pueda
 * dar la bienvenida a los nuevos y reconocer a los habituales.
 */
export class Viewers {
  private records: Record<string, ViewerRecord> = {};
  private readonly seenNow = new Set<string>();
  private dirty = false;

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) this.records = raw;
    } catch {
      // Sin historial todavía.
    }
  }

  /** Registra el mensaje y devuelve una nota para el personaje la primera vez que el usuario escribe hoy. */
  touch(msg: ChatMessage): string | undefined {
    if (msg.platform === "sim") return undefined;
    const key = `${msg.platform}:${msg.user.toLowerCase()}`;
    const firstToday = !this.seenNow.has(key);
    this.seenNow.add(key);
    const record = Object.hasOwn(this.records, key) ? this.records[key] : undefined;
    this.dirty = true;
    if (!record) {
      this.records[key] = { first: msg.ts, last: msg.ts, streams: 1, messages: 1 };
      return "primera vez en el canal";
    }
    record.messages++;
    record.last = msg.ts;
    if (!firstToday) return undefined;
    record.streams++;
    return record.streams >= 3 ? `habitual, ${record.streams} directos` : "ya estuvo en otro directo";
  }

  save(): void {
    if (!this.dirty) return;
    const keys = Object.keys(this.records);
    if (keys.length > MAX_VIEWERS) {
      keys.sort((a, b) => this.records[a].last - this.records[b].last);
      for (const key of keys.slice(0, keys.length - MAX_VIEWERS)) delete this.records[key];
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.records));
    this.dirty = false;
  }
}
