import { Agent, type LogEntry } from "./agent/agent.js";
import { ClaudeBrain, DemoBrain, loadPersona } from "./agent/brain.js";
import { ChatFilter } from "./chat/filter.js";
import { ConfigStore } from "./config.js";
import { SimulatorConnector } from "./connectors/simulator.js";
import { TikTokConnector } from "./connectors/tiktok.js";
import { TwitchConnector } from "./connectors/twitch.js";
import { YouTubeConnector } from "./connectors/youtube.js";
import { ObsController } from "./obs.js";
import { LocalServer, type Role } from "./server.js";
import type { Brain, ChatMessage, Connector, ConnectorContext, ConnectorStatus, Platform, Voice } from "./types.js";
import { ElevenLabsVoice, SilentVoice } from "./voice/elevenlabs.js";

export interface AppOptions {
  port?: number;
  demo?: boolean;
  configDir?: string;
  /** Sustituyen al cerebro y la voz reales (tests). */
  brain?: Brain;
  voice?: Voice;
}

const HISTORY = 80;

/** Une configuración, conectores de chat, agente, OBS y servidor local. */
export class StreamBotApp {
  readonly config: ConfigStore;
  readonly server: LocalServer;
  readonly agent: Agent;
  readonly obs: ObsController;

  private readonly filter: ChatFilter;
  private readonly connectors = new Map<Platform, { connector: Connector; signature: string }>();
  private readonly statuses: Record<Platform, ConnectorStatus> = {
    twitch: { state: "off" },
    youtube: { state: "off" },
    tiktok: { state: "off" },
    sim: { state: "off" },
  };
  private brain: Brain | null = null;
  private brainKind: "claude" | "demo" | "none" = "none";
  private voice: Voice = new SilentVoice();
  private voiceKind: "elevenlabs" | "silent" = "silent";
  private simOn = false;
  private readonly chatHistory: unknown[] = [];
  private readonly logHistory: LogEntry[] = [];
  private readonly played = new Map<string, () => void>();

  constructor(private readonly options: AppOptions = {}) {
    this.config = new ConfigStore(options.configDir);
    this.filter = new ChatFilter(this.config.settings.filter);
    this.obs = new ObsController(() => this.pushState());
    this.server = new LocalServer({
      handle: (method, route, body) => this.handleApi(method, route, body),
      hello: (role) => this.hello(role),
      onClientMessage: (role, data) => this.onClientMessage(role, data),
    });
    this.agent = new Agent({
      settings: () => this.config.settings,
      brain: () => this.brain,
      voice: () => this.voice,
      output: {
        utteranceStart: (u) =>
          this.server.send("all", {
            type: "utterance_start",
            id: u.id,
            sampleRate: u.sampleRate,
            name: this.config.settings.personaName,
            replyTo: u.replyTo.map((m) => ({ platform: m.platform, user: m.user, text: m.text })),
          }),
        subtitle: (id, text) => this.server.send("all", { type: "subtitle", id, text }),
        audio: (_id, pcm) => this.server.sendBinary("overlay", pcm),
        utteranceEnd: (id) => this.server.send("all", { type: "utterance_end", id }),
        stop: (id) => this.server.send("all", { type: "utterance_stop", id }),
        waitPlayed: (id, fallbackMs, signal) => this.waitPlayed(id, fallbackMs, signal),
        log: (entry) => {
          this.logHistory.push(entry);
          if (this.logHistory.length > HISTORY) this.logHistory.shift();
          this.server.send("panel", { type: "log", entry });
        },
        status: () => this.pushState(),
      },
    });
  }

  async start(): Promise<number> {
    const port = await this.server.listen(this.options.port ?? 4747);
    this.simOn = !!this.options.demo;
    await this.apply();
    this.agent.start();
    return port;
  }

  async stop(): Promise<void> {
    this.agent.stop();
    for (const { connector } of this.connectors.values()) await connector.stop().catch(() => {});
    this.connectors.clear();
    await this.obs.disconnect();
    await this.server.close();
  }

  /** Recibe un mensaje de cualquier plataforma: lo muestra y, si pasa el filtro, lo ofrece al personaje. */
  ingest(msg: ChatMessage): void {
    const verdict = this.filter.check(msg);
    const event = { type: "chat", msg, blocked: verdict.ok ? null : verdict.reason };
    this.chatHistory.push(event);
    if (this.chatHistory.length > HISTORY) this.chatHistory.shift();
    this.server.send("panel", event);
    if (verdict.ok) {
      this.server.send("overlay", event);
      if (!this.agent.paused && this.config.settings.agent.enabled) this.agent.offer(msg);
    }
  }

  private context(platform: Platform): ConnectorContext {
    return {
      onMessage: (msg) => this.ingest(msg),
      onStatus: (status) => {
        this.statuses[platform] = status;
        this.pushState();
      },
    };
  }

  /** Aplica ajustes y claves: reinicia solo los conectores cuya configuración ha cambiado. */
  private async apply(): Promise<void> {
    const { settings, secrets } = this.config;
    this.filter.setOptions(settings.filter);

    const wanted = new Map<Platform, { signature: string; make: () => Connector }>();
    if (settings.twitch.enabled && settings.twitch.channel) {
      wanted.set("twitch", {
        signature: settings.twitch.channel,
        make: () => new TwitchConnector(settings.twitch.channel, this.context("twitch")),
      });
    }
    if (settings.youtube.enabled && settings.youtube.videoId) {
      wanted.set("youtube", {
        signature: [settings.youtube.videoId, settings.youtube.pollSeconds, secrets.youtubeApiKey].join("|"),
        make: () =>
          new YouTubeConnector(
            settings.youtube.videoId,
            secrets.youtubeApiKey,
            Math.max(3, settings.youtube.pollSeconds),
            this.context("youtube"),
          ),
      });
    }
    if (settings.tiktok.enabled && settings.tiktok.username) {
      wanted.set("tiktok", {
        signature: settings.tiktok.username,
        make: () => new TikTokConnector(settings.tiktok.username, this.context("tiktok")),
      });
    }
    if (this.simOn) {
      wanted.set("sim", { signature: "sim", make: () => new SimulatorConnector(this.context("sim")) });
    }

    for (const [platform, running] of this.connectors) {
      if (wanted.get(platform)?.signature !== running.signature) {
        await running.connector.stop().catch(() => {});
        this.connectors.delete(platform);
      }
    }
    for (const [platform, want] of wanted) {
      if (this.connectors.has(platform)) continue;
      const connector = want.make();
      this.connectors.set(platform, { connector, signature: want.signature });
      void connector.start().catch((err) => {
        this.statuses[platform] = { state: "error", detail: (err as Error).message };
        this.pushState();
      });
    }

    if (this.options.brain) {
      this.brain = this.options.brain;
      this.brainKind = "demo";
    } else if (secrets.anthropicApiKey) {
      const persona = loadPersona(settings.personaName, settings.game);
      this.brain = new ClaudeBrain(secrets.anthropicApiKey, settings.agent.model, persona);
      this.brainKind = "claude";
    } else if (this.options.demo) {
      this.brain = new DemoBrain();
      this.brainKind = "demo";
    } else {
      this.brain = null;
      this.brainKind = "none";
    }

    if (this.options.voice) {
      this.voice = this.options.voice;
      this.voiceKind = "elevenlabs";
    } else if (secrets.elevenLabsApiKey && settings.voice.voiceId) {
      this.voice = new ElevenLabsVoice(secrets.elevenLabsApiKey, settings.voice);
      this.voiceKind = "elevenlabs";
    } else {
      this.voice = new SilentVoice();
      this.voiceKind = "silent";
    }
    this.pushState();
  }

  private state() {
    return {
      settings: this.config.settings,
      secrets: this.config.secretFlags(),
      connectors: this.statuses,
      simulator: this.simOn,
      agent: {
        paused: this.agent.paused,
        speaking: this.agent.speaking,
        problem: this.agent.problem,
        pending: this.agent.selector.size,
        brain: this.brainKind,
        voice: this.voiceKind,
      },
      obs: this.obs.status,
      overlays: this.server.count("overlay"),
      port: this.server.port,
    };
  }

  private pushState(): void {
    this.server.send("panel", { type: "state", state: this.state() });
  }

  private hello(role: Role): unknown[] {
    if (role === "overlay") {
      // Se avisa al panel de que hay un overlay nuevo conectado.
      setTimeout(() => this.pushState(), 0);
      return [{ type: "hello", name: this.config.settings.personaName }];
    }
    return [
      { type: "state", state: this.state() },
      ...this.chatHistory,
      ...this.logHistory.map((entry) => ({ type: "log", entry })),
    ];
  }

  private onClientMessage(role: Role, data: unknown): void {
    if (role !== "overlay" || typeof data !== "object" || data === null) return;
    const msg = data as { type?: string; id?: string };
    if (msg.type === "played" && typeof msg.id === "string") this.played.get(msg.id)?.();
  }

  private waitPlayed(id: string, fallbackMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.played.delete(id);
        resolve();
      };
      const timer = setTimeout(done, fallbackMs);
      signal.addEventListener("abort", done);
      this.played.set(id, done);
    });
  }

  private async handleApi(method: string, route: string, body: unknown): Promise<unknown> {
    const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (method === "GET" && route === "state") return this.state();
    if (method !== "POST") throw new Error("Método no admitido.");
    switch (route) {
      case "settings":
        this.config.updateSettings(data);
        await this.apply();
        return this.state();
      case "secrets":
        this.config.updateSecrets(data);
        await this.apply();
        return this.state();
      case "control":
        if (data.action === "pause") this.agent.setPaused(true);
        else if (data.action === "resume") this.agent.setPaused(false);
        else if (data.action === "skip") this.agent.skip();
        else throw new Error("Acción desconocida.");
        return { ok: true };
      case "say":
        if (typeof data.text !== "string" || !data.text.trim()) throw new Error("Escribe el texto que debe decir.");
        this.agent.say(data.text);
        return { ok: true };
      case "simulator":
        this.simOn = !!data.on;
        await this.apply();
        return { ok: true };
      case "obs":
        if (data.action === "connect") {
          await this.obs.connect(this.config.settings.obs.url, this.config.secrets.obsPassword);
        } else if (data.action === "start") await this.obs.setStreaming(true);
        else if (data.action === "stop") await this.obs.setStreaming(false);
        else throw new Error("Acción desconocida.");
        return { ok: true };
      default:
        throw new Error("Ruta desconocida.");
    }
  }
}
