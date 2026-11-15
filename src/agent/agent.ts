import { Selector } from "../chat/selector.js";
import type { Brain, BrainInput, ChatMessage, Settings, Voice } from "../types.js";
import { BrainError } from "./brain.js";
import { toSentences } from "./sentences.js";

export interface LogEntry {
  ts: number;
  mode: "reply" | "summary" | "idle" | "narrate" | "manual";
  text: string;
  replyTo: { platform: string; user: string }[];
  /** Milisegundos desde que se eligieron los mensajes hasta el primer audio (o primer texto si no hay voz). */
  latencyMs: number | null;
  error?: string;
}

export interface AgentOutput {
  utteranceStart(u: { id: string; replyTo: ChatMessage[]; sampleRate: number }): void;
  subtitle(id: string, text: string): void;
  audio(id: string, pcm: Buffer): void;
  utteranceEnd(id: string): void;
  /** Corta la reproducción en curso en el overlay. */
  stop(id: string): void;
  /** Se resuelve cuando el overlay termina de reproducir, o al pasar fallbackMs. */
  waitPlayed(id: string, fallbackMs: number, signal: AbortSignal): Promise<void>;
  log(entry: LogEntry): void;
  status(): void;
}

export interface AgentDeps {
  settings(): Settings;
  brain(): Brain | null;
  voice(): Voice;
  output: AgentOutput;
  /** Captura del juego en JPEG base64, o null si no hay. */
  screenshot?: (width?: number) => Promise<string | null>;
  /** Si el cerebro actual puede ver imágenes (el modelo local no). */
  canSee?: () => boolean;
  now?: () => number;
}

type Job =
  | { mode: "manual"; text: string }
  | { mode: "reply" | "summary" | "idle"; messages: ChatMessage[] }
  | { mode: "narrate"; messages: ChatMessage[]; image: string };

const MS_PER_CHAR_SILENT = 65;
/** Ancho de la captura para narrar: algo más grande que para comentar en directo. */
const NARRATE_SHOT_WIDTH = 1024;
/** Respuesta con la que el modelo indica que no hay nada que narrar (menús, cargas). */
const SILENCE = /^\W*silencio\W*$/i;

/** Decide cuándo habla el personaje y coordina texto, voz y overlay. */
export class Agent {
  readonly selector = new Selector();
  paused = false;
  speaking = false;
  problem = "";

  private manual: string[] = [];
  private recentSaid: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private current: AbortController | null = null;
  private nextAllowed = 0;
  /** Mientras se pide la captura para narrar, para no lanzar dos a la vez. */
  private preparing = false;
  private lastActivity: number;
  private readonly startedAt: number;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly deps: AgentDeps) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.lastActivity = this.startedAt;
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current?.abort();
  }

  offer(msg: ChatMessage): void {
    this.selector.add(msg);
  }

  /** El operador escribe una frase y el personaje la dice tal cual. */
  say(text: string): void {
    const clean = text.trim().slice(0, 600);
    if (clean) this.manual.push(clean);
  }

  skip(): void {
    this.current?.abort();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.selector.clear();
    else {
      this.problem = "";
      this.lastActivity = this.now();
    }
    this.deps.output.status();
  }

  async tick(): Promise<void> {
    if (this.speaking || this.preparing) return;
    const now = this.now();
    const settings = this.deps.settings();

    const manual = this.manual.shift();
    if (manual) return this.run({ mode: "manual", text: manual });

    if (this.paused || !settings.agent.enabled || now < this.nextAllowed) return;
    if (!this.deps.brain()) return;

    if (settings.session.mode === "solo") return this.narrate(now, settings);

    const selection = this.selector.pick(now, settings.agent.maxPerTurn);
    if (selection) return this.run(selection);

    if (settings.agent.idleSeconds > 0 && now - this.lastActivity > settings.agent.idleSeconds * 1000) {
      return this.run({ mode: "idle", messages: [] });
    }
  }

  /** Jugando sin directo: cada pocos segundos mira la partida y la comenta. */
  private async narrate(now: number, settings: Settings): Promise<void> {
    const every = Math.max(2, settings.solo.narrateEverySeconds) * 1000;
    if (now - this.lastActivity < every) return;
    const warn = (problem: string) => {
      this.lastActivity = this.now();
      if (this.problem !== problem) {
        this.problem = problem;
        this.deps.output.status();
      }
    };
    if (this.deps.canSee && !this.deps.canSee()) {
      return warn("Para narrar la partida hace falta el cerebro en la nube (Claude): el modelo local no ve imágenes.");
    }
    this.preparing = true;
    let image: string | null = null;
    try {
      image = this.deps.screenshot ? await this.deps.screenshot(NARRATE_SHOT_WIDTH).catch(() => null) : null;
    } finally {
      this.preparing = false;
    }
    if (!image) return warn("Para narrar la partida, conecta OBS: el personaje necesita ver lo que pasa en pantalla.");
    if (this.paused || this.speaking) return;
    return this.run({ mode: "narrate", messages: [], image });
  }

  private async run(job: Job): Promise<void> {
    const { output } = this.deps;
    const settings = this.deps.settings();
    const voice = this.deps.voice();
    const id = `u${++this.seq}`;
    const abort = new AbortController();
    const started = this.now();
    const replyTo = job.mode === "manual" ? [] : job.messages;

    this.speaking = true;
    this.current = abort;
    output.status();
    // El bocadillo del overlay aparece con la primera frase, no antes: si el modelo
    // decide callarse, en el vídeo no queda nada.
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      output.utteranceStart({ id, replyTo, sampleRate: voice.sampleRate });
    };

    let text = "";
    let firstTextAt: number | null = null;
    let firstAudioAt: number | null = null;
    let audioBytes = 0;
    let error: string | undefined;

    const source = job.mode === "manual" ? once(job.text) : this.generate(job, settings, abort.signal);
    const sentences = async function* (self: Agent) {
      for await (const sentence of toSentences(source)) {
        if (abort.signal.aborted) return;
        if (SILENCE.test(sentence)) continue;
        show();
        firstTextAt ??= self.now();
        text += (text ? " " : "") + sentence;
        output.subtitle(id, sentence);
        yield sentence;
      }
    };
    const stream = sentences(this);

    try {
      await voice.speak(
        stream,
        (pcm) => {
          if (abort.signal.aborted) return;
          firstAudioAt ??= this.now();
          audioBytes += pcm.length;
          output.audio(id, pcm);
        },
        abort.signal,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (err instanceof BrainError) {
        if (err.fatal) {
          this.paused = true;
          this.problem = error;
        } else {
          this.nextAllowed = this.now() + 10_000;
        }
      } else {
        // Fallo de la voz: se termina de mostrar el texto como subtítulos.
        this.problem = error;
        try {
          for await (const _ of stream) {
            // Se consume el resto para completar los subtítulos.
          }
        } catch {
          // El texto restante se descarta.
        }
      }
    }

    if (!shown) {
      // No dijo nada: no hay nada que cerrar en el overlay.
    } else if (abort.signal.aborted) {
      output.stop(id);
    } else {
      output.utteranceEnd(id);
      const audioMs = (audioBytes / (2 * voice.sampleRate)) * 1000;
      const remaining =
        audioBytes > 0 && firstAudioAt !== null
          ? Math.max(0, firstAudioAt + audioMs - this.now()) + 1500
          : text.length * MS_PER_CHAR_SILENT;
      await output.waitPlayed(id, remaining, abort.signal);
      if (abort.signal.aborted) output.stop(id);
    }

    // Si esta intervención salió bien, el aviso de un fallo anterior ya no aplica.
    if (!error && !this.paused && !abort.signal.aborted) this.problem = "";
    if (text) {
      this.recentSaid.push(text);
      if (this.recentSaid.length > 6) this.recentSaid.shift();
    }
    if (text || error) {
      output.log({
        ts: started,
        mode: job.mode,
        text,
        replyTo: replyTo.map((m) => ({ platform: m.platform, user: m.user })),
        latencyMs: (firstAudioAt ?? firstTextAt) !== null ? (firstAudioAt ?? firstTextAt)! - started : null,
        error,
      });
    }

    const end = this.now();
    this.lastActivity = end;
    this.nextAllowed = Math.max(this.nextAllowed, end + settings.agent.minGapSeconds * 1000);
    this.speaking = false;
    this.current = null;
    output.status();
  }

  private async *generate(
    job: Exclude<Job, { mode: "manual" }>,
    settings: Settings,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    let image: string | undefined = job.mode === "narrate" ? job.image : undefined;
    if (job.mode === "idle" && settings.agent.watchGame && this.deps.screenshot) {
      image = (await this.deps.screenshot().catch(() => null)) ?? undefined;
    }
    const input: BrainInput = {
      mode: job.mode,
      messages: job.messages,
      recentSaid: this.recentSaid,
      game: settings.game,
      minutesLive: Math.round((this.now() - this.startedAt) / 60_000),
      image,
    };
    yield* this.deps.brain()!.reply(input, signal);
  }
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}
