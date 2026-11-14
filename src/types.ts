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
  /** Dato sobre el espectador para el personaje (p. ej. "primera vez en el canal"). */
  note?: string;
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
    /** Si está activo y OBS conectado, el personaje mira una captura del juego cuando habla por su cuenta. */
    watchGame: boolean;
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
  brand: {
    /** Color principal del overlay, en formato #rrggbb. */
    accent: string;
    /** Mostrar las redes sociales rotando en el overlay. */
    ticker: boolean;
    /** Una red por línea: "TikTok = @usuario". */
    socials: string[];
  };
  clips: {
    /** Carpeta de exportación; vacío = carpeta por defecto. */
    folder: string;
    /** Guardar un clip automáticamente cuando el chat se dispara. */
    autoOnSpike: boolean;
    /** Permitir que el chat pida un clip con !clip. */
    chatCommand: boolean;
    /** Ruta de ffmpeg; vacío = buscarlo automáticamente. */
    ffmpegPath: string;
  };
  /** Comandos del chat, uno por línea: "redes = Sígueme en TikTok". */
  commands: string[];
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
  /** Captura del juego en JPEG (base64), si el personaje puede ver la partida. */
  image?: string;
}

export interface ClipCopy {
  title: string;
  description: string;
  hashtags: string[];
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
