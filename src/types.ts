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
    /** "claude" (en la nube) o "local" (modelo en este ordenador). */
    engine: string;
    model: string;
    /** Servidor del modelo local, con API de chat compatible con OpenAI (Ollama). */
    localUrl: string;
    localModel: string;
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
    /** "elevenlabs" (en la nube) o "local" (modelo en este ordenador). */
    engine: string;
    voiceId: string;
    modelId: string;
    stability: number;
    similarity: number;
    speed: number;
    /** Servidor de voz local (mlx-audio). */
    localUrl: string;
    localModel: string;
    /** Voz predefinida del modelo local; vacío si se clona con un audio de referencia. */
    localVoice: string;
    /** Código de idioma que espera el modelo local (Kokoro: "e" para español). */
    localLang: string;
    /** Audio de referencia para clonar la voz, como ruta en este ordenador. */
    localRefAudio: string;
    /** Lo que se dice en el audio de referencia. */
    localRefText: string;
    /**
     * Modelo expresivo de ElevenLabs para jugar solo y narrar clips (entiende
     * indicaciones de tono entre corchetes). Vacío para usar siempre el modelo rápido.
     */
    expressiveModelId: string;
    /** Indicación de acento que se antepone a cada texto con el modelo expresivo. */
    accentTag: string;
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
  session: {
    /** "stream": responde al chat del directo. "solo": narra la partida sin directo. */
    mode: string;
  };
  solo: {
    /** Segundos de silencio entre una narración y la siguiente. */
    narrateEverySeconds: number;
  };
}

export interface Secrets {
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  youtubeApiKey: string;
  obsPassword: string;
}

/** Entrada para generar una intervención del personaje. */
export interface BrainInput {
  /** "narrate": jugando sin directo, comenta la captura de la partida. */
  mode: "reply" | "summary" | "idle" | "narrate";
  messages: ChatMessage[];
  recentSaid: string[];
  game: string;
  minutesLive: number;
  /** Captura del juego en JPEG (base64), si el personaje puede ver la partida. */
  image?: string;
  /** La voz entiende indicaciones de tono entre corchetes: el personaje puede usarlas. */
  tags?: boolean;
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
  /** true si entiende indicaciones de tono entre corchetes ([serious], [chuckles]…). */
  readonly tags?: boolean;
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
