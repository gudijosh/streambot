export type Platform = "twitch" | "youtube" | "tiktok" | "sim";
export type MessageKind = "chat" | "sub" | "gift" | "follow" | "donation";

/** Mensaje de chat normalizado, igual para todas las plataformas. */
export interface ChatMessage {
  id: string;
  platform: Platform;
  user: string;
  text: string;
  kind: MessageKind;
  /** Detalle del evento (p. ej. "100 bits", "Rosa x5"). */
  detail?: string;
  ts: number;
}

export type ConnectorState = "off" | "connecting" | "connected" | "error";

export interface ConnectorStatus {
  state: ConnectorState;
  detail?: string;
}

export interface Connector {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ConnectorContext {
  onMessage(msg: ChatMessage): void;
  onStatus(status: ConnectorStatus): void;
}

export interface Settings {
  personaName: string;
  game: string;
  twitch: { enabled: boolean; channel: string };
  youtube: { enabled: boolean; videoId: string; pollSeconds: number };
  tiktok: { enabled: boolean; username: string };
  agent: {
    enabled: boolean;
    model: string;
    /** Pausa mínima entre intervenciones del personaje. */
    minGapSeconds: number;
    /** Segundos de silencio antes de que el personaje hable por su cuenta. */
    idleSeconds: number;
    /** Mensajes de chat que atiende como máximo en una intervención. */
    maxPerTurn: number;
  };
  voice: {
    voiceId: string;
    modelId: string;
    stability: number;
    similarity: number;
    speed: number;
  };
  obs: { enabled: boolean; url: string };
  filter: { bannedWords: string[]; blockLinks: boolean };
}

export interface Secrets {
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  youtubeApiKey: string;
  obsPassword: string;
}

/** Entrada para generar una intervención del personaje. */
export interface BrainInput {
  mode: "reply" | "summary" | "idle";
  messages: ChatMessage[];
  recentSaid: string[];
  game: string;
  minutesLive: number;
}

export interface Brain {
  /** Devuelve el texto de la intervención en trozos según se genera. */
  reply(input: BrainInput, signal: AbortSignal): AsyncIterable<string>;
}

export interface Voice {
  readonly sampleRate: number;
  /**
   * Convierte frases en audio PCM 16-bit mono. Llama a onAudio con cada trozo.
   * Si no produce audio (sin clave), el overlay solo muestra subtítulos.
   */
  speak(
    sentences: AsyncIterable<string>,
    onAudio: (pcm: Buffer) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
