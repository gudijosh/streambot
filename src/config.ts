import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Secrets, Settings } from "./types.js";

export const DEFAULT_SETTINGS: Settings = {
  personaName: "Don Escobar",
  game: "GTA VI",
  twitch: { enabled: false, channel: "" },
  youtube: { enabled: false, videoId: "", pollSeconds: 6 },
  tiktok: { enabled: false, username: "" },
  agent: {
    enabled: true,
    engine: "claude",
    model: "claude-haiku-5-5",
    localUrl: "http://127.0.0.1:11434/v1",
    localModel: "qwen3.5:4b",
    minGapSeconds: 4,
    idleSeconds: 45,
    maxPerTurn: 3,
    watchGame: false,
  },
  voice: {
    engine: "elevenlabs",
    voiceId: "",
    modelId: "eleven_flash_v2_5",
    stability: 0.45,
    similarity: 0.8,
    speed: 1,
    localUrl: "http://127.0.0.1:8000",
    localModel: "mlx-community/Kokoro-82M-bf16",
    localVoice: "em_alex",
    localLang: "e",
    localRefAudio: "",
    localRefText: "",
  },
  obs: { enabled: false, url: "ws://127.0.0.1:4455" },
  filter: { bannedWords: [], blockLinks: true },
  brand: { accent: "#e8b64c", ticker: true, socials: [] },
  clips: { folder: "", autoOnSpike: true, chatCommand: true, ffmpegPath: "" },
  commands: [],
  session: { mode: "stream" },
  solo: { narrateEverySeconds: 10 },
};

const EMPTY_SECRETS: Secrets = {
  anthropicApiKey: "",
  elevenLabsApiKey: "",
  youtubeApiKey: "",
  obsPassword: "",
};

export function configDir(): string {
  if (process.env.STREAMBOT_CONFIG_DIR) return process.env.STREAMBOT_CONFIG_DIR;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "StreamBot");
  }
  return path.join(os.homedir(), ".config", "streambot");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mezcla `patch` sobre `base` aceptando solo claves que ya existen en `base` y con el mismo tipo. */
export function mergeKnown<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, current] of Object.entries(base)) {
    const next = patch[key];
    if (next === undefined) continue;
    if (isObject(current)) out[key] = mergeKnown(current, next);
    else if (Array.isArray(current)) {
      if (Array.isArray(next)) out[key] = next.filter((x) => typeof x === "string");
    } else if (typeof next === typeof current) out[key] = next;
  }
  return out as T;
}

/** Ajustes y claves guardados en un fichero local fuera del repositorio (permisos 600). */
export class ConfigStore {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private stored: Secrets = { ...EMPTY_SECRETS };
  private readonly file: string;
  readonly dir: string;

  constructor(dir = configDir()) {
    this.dir = dir;
    this.file = path.join(dir, "config.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.settings = mergeKnown(this.settings, raw.settings);
      this.stored = mergeKnown(this.stored, raw.secrets);
    } catch {
      // Primera ejecución o fichero ilegible: se usan los valores por defecto.
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ settings: this.settings, secrets: this.stored }, null, 2),
      { mode: 0o600 },
    );
  }

  updateSettings(patch: unknown): void {
    this.settings = mergeKnown(this.settings, patch);
    this.save();
  }

  updateSecrets(patch: unknown): void {
    this.stored = mergeKnown(this.stored, patch);
    this.save();
  }

  /** Claves efectivas: las variables de entorno tienen prioridad sobre el fichero. */
  get secrets(): Secrets {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || this.stored.anthropicApiKey,
      elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || this.stored.elevenLabsApiKey,
      youtubeApiKey: process.env.YOUTUBE_API_KEY || this.stored.youtubeApiKey,
      obsPassword: process.env.OBS_PASSWORD || this.stored.obsPassword,
    };
  }

  /** Qué claves están puestas, sin revelar su valor (para el panel). */
  secretFlags(): Record<keyof Secrets, boolean> {
    const s = this.secrets;
    return {
      anthropicApiKey: !!s.anthropicApiKey,
      elevenLabsApiKey: !!s.elevenLabsApiKey,
      youtubeApiKey: !!s.youtubeApiKey,
      obsPassword: !!s.obsPassword,
    };
  }
}
