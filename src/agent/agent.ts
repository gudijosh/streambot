import { Selector } from "../chat/selector.js";
import type { Brain, BrainInput, ChatMessage, Settings, Voice } from "../types.js";
import { BrainError } from "./brain.js";
import { toSentences } from "./sentences.js";

export interface LogEntry {
  ts: number;
  mode: "reply" | "summary" | "idle" | "manual";
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
  now?: () => number;
}

type Job =
  | { mode: "manual"; text: string }
  | { mode: "reply" | "summary" | "idle"; messages: ChatMessage[] };

const MS_PER_CHAR_SILENT = 65;

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
    if (this.speaking) return;
    const now = this.now();
    const settings = this.deps.settings();

    const manual = this.manual.shift();
    if (manual) return this.run({ mode: "manual", text: manual });

    if (this.paused || !settings.agent.enabled || now < this.nextAllowed) return;
    if (!this.deps.brain()) return;

    const selection = this.selector.pick(now, settings.agent.maxPerTurn);
    if (selection) return this.run(selection);

    if (settings.agent.idleSeconds > 0 && now - this.lastActivity > settings.agent.idleSeconds * 1000) {
      return this.run({ mode: "idle", messages: [] });
    }
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
    output.utteranceStart({ id, replyTo, sampleRate: voice.sampleRate });

    let text = "";
    let firstTextAt: number | null = null;
    let firstAudioAt: number | null = null;
    let audioBytes = 0;
    let error: string | undefined;

    const source = job.mode === "manual" ? once(job.text) : this.generate(job, settings, abort.signal);
    const sentences = async function* (self: Agent) {
      for await (const sentence of toSentences(source)) {
        if (abort.signal.aborted) return;
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

    if (abort.signal.aborted) {
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

  private generate(
    job: Exclude<Job, { mode: "manual" }>,
    settings: Settings,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const input: BrainInput = {
      mode: job.mode,
      messages: job.messages,
      recentSaid: this.recentSaid,
      game: settings.game,
      minutesLive: Math.round((this.now() - this.startedAt) / 60_000),
    };
    return this.deps.brain()!.reply(input, signal);
  }
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}
