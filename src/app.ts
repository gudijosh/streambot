import { spawn } from "node:child_process";
import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { Agent, type LogEntry } from "./agent/agent.js";
import { BrainError, ClaudeBrain, DemoBrain, generateClipCopy, generateNarrationScript, loadPersona } from "./agent/brain.js";
import { LocalBrain } from "./agent/local-brain.js";
import { BrandKit, MAX_UPLOAD_BYTES, SLOTS, isSlot, parsePairs } from "./brand.js";
import { ChatFilter } from "./chat/filter.js";
import { buildFfmpegArgs, findFfmpeg, isClipFormat, runFfmpeg } from "./clips/ffmpeg.js";
import { Highlights, type Marker, type MarkerReason, SpikeDetector } from "./clips/highlights.js";
import { ClipLibrary } from "./clips/library.js";
import { type Frame, MAX_NARRATION_SECONDS, narrateClip, type ScriptLine } from "./clips/narrate.js";
import { ConfigStore } from "./config.js";
import { SimulatorConnector } from "./connectors/simulator.js";
import { TikTokConnector } from "./connectors/tiktok.js";
import { TwitchConnector } from "./connectors/twitch.js";
import { YouTubeConnector } from "./connectors/youtube.js";
import { serveFile } from "./media.js";
import { ObsController } from "./obs.js";
import { BRAND_DIR } from "./paths.js";
import { LocalServer, type Role } from "./server.js";
import { Stats } from "./stats.js";
import type { Brain, ChatMessage, Connector, ConnectorContext, ConnectorStatus, Platform, Voice } from "./types.js";
import { Viewers } from "./viewers.js";
import { ElevenLabsExpressiveVoice, ElevenLabsVoice, SilentVoice } from "./voice/elevenlabs.js";
import { LocalVoice } from "./voice/local.js";

export interface AppOptions {
  port?: number;
  demo?: boolean;
  configDir?: string;
  /** Sustituyen al cerebro y la voz reales (tests). */
  brain?: Brain;
  voice?: Voice;
  /** Servidor de ElevenLabs para la voz expresiva (tests). */
  elevenLabsBaseUrl?: string;
  /** Sustituye a Claude al escribir la narración de un clip (tests). */
  narrator?: (frames: Frame[], duration: number) => Promise<ScriptLine[]>;
}

const HISTORY = 80;
const CHAT_LOG = 500;
const COMMAND_COOLDOWN_MS = 30_000;
const MAX_CLIP_SECONDS = 600;

function timeTag(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}s`;
}

/** Une configuración, conectores de chat, agente, clips, marca, OBS y servidor local. */
export class StreamBotApp {
  readonly config: ConfigStore;
  readonly server: LocalServer;
  readonly agent: Agent;
  readonly obs: ObsController;
  readonly brand: BrandKit;
  readonly library: ClipLibrary;

  private readonly filter: ChatFilter;
  private readonly viewers: Viewers;
  private readonly stats = new Stats();
  private readonly highlights = new Highlights();
  private readonly spike = new SpikeDetector();
  private readonly dataDir: string;
  private readonly connectors = new Map<Platform, { connector: Connector; signature: string }>();
  private readonly statuses: Record<Platform, ConnectorStatus> = {
    twitch: { state: "off" },
    youtube: { state: "off" },
    tiktok: { state: "off" },
    sim: { state: "off" },
  };
  private brain: Brain | null = null;
  private brainKind: "claude" | "local" | "demo" | "none" = "none";
  private voice: Voice = new SilentVoice();
  /** Voz expresiva (ElevenLabs v3/v4) para jugar solo y narrar clips, si está configurada. */
  private expressiveVoice: Voice | null = null;
  private voiceKind: "elevenlabs" | "local" | "silent" = "silent";
  private simOn = false;
  private ffmpegBin: string | null = null;
  private exportJob: { abort: AbortController; clipId: string; kind: "export" | "narrate" } | null = null;
  private readonly pendingReplay: Marker[] = [];
  private readonly commandUsed = new Map<string, number>();
  private readonly chatHistory: unknown[] = [];
  private readonly chatLog: ChatMessage[] = [];
  private readonly logHistory: LogEntry[] = [];
  private readonly played = new Map<string, () => void>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly options: AppOptions = {}) {
    this.config = new ConfigStore(options.configDir);
    this.dataDir = path.join(this.config.dir, "data");
    this.brand = new BrandKit(path.join(this.config.dir, "brand"), BRAND_DIR);
    this.library = new ClipLibrary(path.join(this.dataDir, "clips.json"));
    this.viewers = new Viewers(path.join(this.dataDir, "viewers.json"));
    this.filter = new ChatFilter(this.config.settings.filter);
    this.obs = new ObsController({
      onChange: () => this.pushState(),
      onReplaySaved: (file) => this.onReplaySaved(file),
      onRecordingSaved: (file) => this.addVideo(file, "recording"),
    });
    this.server = new LocalServer({
      handle: (method, route, body) => this.handleApi(method, route, body),
      raw: (req, res, url) => this.handleRaw(req, res, url),
      hello: (role) => this.hello(role),
      onClientMessage: (role, data) => this.onClientMessage(role, data),
    });
    this.agent = new Agent({
      settings: () => this.config.settings,
      brain: () => this.brain,
      // Jugando solo la espera importa menos: se usa la voz expresiva si la hay.
      voice: () => (this.config.settings.session.mode === "solo" ? this.narrationVoice() : this.voice),
      screenshot: (width) => this.obs.screenshot(width),
      canSee: () => this.brainKind === "claude" || this.brainKind === "demo",
      output: {
        utteranceStart: (u) =>
          this.server.send(["panel", "overlay"], {
            type: "utterance_start",
            id: u.id,
            sampleRate: u.sampleRate,
            replyTo: u.replyTo.map((m) => ({ platform: m.platform, user: m.user, text: m.text })),
          }),
        subtitle: (id, text) => this.server.send(["panel", "overlay"], { type: "subtitle", id, text }),
        audio: (_id, pcm) => this.server.sendBinary("overlay", pcm),
        utteranceEnd: (id) => this.server.send(["panel", "overlay"], { type: "utterance_end", id }),
        stop: (id) => this.server.send(["panel", "overlay"], { type: "utterance_stop", id }),
        waitPlayed: (id, fallbackMs, signal) => this.waitPlayed(id, fallbackMs, signal),
        log: (entry) => {
          this.stats.spoken(entry.text);
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
    this.timers.push(
      setInterval(() => {
        if (this.server.count("panel")) this.server.send("panel", { type: "stats", stats: this.statsSnapshot() });
      }, 2000),
      setInterval(() => this.viewers.save(), 60_000),
    );
    return port;
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.agent.stop();
    this.exportJob?.abort.abort();
    for (const { connector } of this.connectors.values()) await connector.stop().catch(() => {});
    this.connectors.clear();
    await this.obs.stop();
    this.viewers.save();
    this.stats.saveSummary(path.join(this.dataDir, "sessions"), this.config.settings.voice.modelId, this.voiceKind === "elevenlabs");
    await this.server.close();
  }

  // ---- Chat ----

  /** Recibe un mensaje de cualquier plataforma: lo muestra y, si pasa el filtro, lo ofrece al personaje. */
  ingest(msg: ChatMessage): void {
    // Jugando sin directo no hay chat al que atender.
    if (this.config.settings.session.mode === "solo") return;
    this.stats.message(msg);
    if (msg.kind === "chat" && msg.text.startsWith("!")) this.handleCommand(msg);

    const verdict = this.filter.check(msg);
    if (verdict.ok && msg.kind === "chat") msg.note = this.viewers.touch(msg);
    const event = { type: "chat", msg, blocked: verdict.ok ? null : verdict.reason };
    this.chatHistory.push(event);
    if (this.chatHistory.length > HISTORY) this.chatHistory.shift();
    this.server.send("panel", event);
    if (!verdict.ok) return;

    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_LOG) this.chatLog.shift();
    this.server.send(["overlay", "scene"], event);
    if (msg.kind !== "chat") this.server.send("overlay", { type: "alert", msg });
    if (!this.agent.paused && this.config.settings.agent.enabled) this.agent.offer(msg);

    if (msg.kind === "chat" && this.spike.add(msg.ts) && this.config.settings.clips.autoOnSpike) {
      void this.clipNow("spike", "El chat se disparó");
    }
  }

  private handleCommand(msg: ChatMessage): void {
    const name = msg.text.slice(1).split(/\s+/)[0].toLowerCase();
    if (!name) return;
    const { settings } = this.config;
    const custom = parsePairs(settings.commands).find((c) => c.name.replace(/^!/, "").toLowerCase() === name);
    const isClip = name === "clip" && settings.clips.chatCommand;
    if (!custom && !isClip) return;
    if (msg.ts - (this.commandUsed.get(name) ?? -Infinity) < COMMAND_COOLDOWN_MS) return;
    this.commandUsed.set(name, msg.ts);
    if (custom) this.agent.say(custom.value);
    else void this.clipNow("chat", `Pedido por ${msg.user}`);
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

  // ---- Clips ----

  /** Marca un momento destacado y, si el búfer de repetición de OBS está activo, guarda el vídeo. */
  async clipNow(reason: MarkerReason, label: string): Promise<{ saved: boolean; message: string }> {
    const marker = this.highlights.add(Date.now(), reason, label);
    let saved = false;
    if (this.obs.status.connected && this.obs.status.replay) {
      try {
        this.pendingReplay.push(marker);
        await this.obs.saveReplay();
        saved = true;
      } catch {
        this.pendingReplay.splice(this.pendingReplay.indexOf(marker), 1);
      }
    }
    if (saved) this.server.send("overlay", { type: "toast", text: "Clip guardado" });
    this.pushState();
    return {
      saved,
      message: saved
        ? "Clip guardado."
        : "Momento marcado. Para guardar el vídeo, conecta OBS y activa el búfer de repetición.",
    };
  }

  private onReplaySaved(file: string): void {
    const marker = this.pendingReplay.shift();
    const item = this.addVideo(file, "replay", marker?.ts ?? Date.now());
    if (marker && item) marker.clipId = item.id;
    this.pushState();
  }

  private addVideo(file: string, kind: "replay" | "recording" | "export" | "import", markerTs?: number) {
    try {
      const item = this.library.add(file, kind, markerTs ? { markerTs } : {});
      this.pushState();
      return item;
    } catch {
      return null;
    }
  }

  private clipsFolder(): string {
    const custom = this.config.settings.clips.folder.trim();
    if (custom) return custom;
    return path.join(os.homedir(), process.platform === "darwin" ? "Movies" : "Videos", "StreamBot");
  }

  private startExport(data: Record<string, unknown>): void {
    if (this.exportJob) throw new Error("Ya hay una exportación en marcha.");
    if (!this.ffmpegBin) {
      throw new Error('No encuentro ffmpeg. Instálalo con "brew install ffmpeg" o indica su ruta en Ajustes → Clips.');
    }
    const item = this.library.get(data.id);
    if (!fs.existsSync(item.file)) throw new Error("El archivo original ya no existe.");
    const start = Number(data.start);
    const end = Number(data.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("Marca un inicio y un fin válidos.");
    }
    if (end - start > MAX_CLIP_SECONDS) throw new Error("Un clip no puede durar más de 10 minutos.");
    if (!isClipFormat(data.format)) throw new Error("Formato desconocido.");
    const logo = data.watermark ? this.brand.find("logo") : null;
    if (data.watermark && !logo) throw new Error("Sube antes un logo en la pestaña Marca.");

    const folder = this.clipsFolder();
    fs.mkdirSync(folder, { recursive: true });
    const base = path.parse(item.name).name.replace(/[^\w.-]+/g, "_").slice(0, 60);
    const suffix = data.format === "horizontal" ? "16x9" : "9x16";
    let output = "";
    for (let n = 0; ; n++) {
      output = path.join(folder, `${base}_${timeTag(start)}-${timeTag(end)}_${suffix}${n ? `_${n}` : ""}.mp4`);
      if (!fs.existsSync(output)) break;
    }
    const args = buildFfmpegArgs({
      input: item.file,
      output,
      start,
      end,
      format: data.format,
      cropX: Number.isFinite(Number(data.cropX)) ? Number(data.cropX) : 0.5,
      watermark: logo?.file,
    });

    const abort = new AbortController();
    this.exportJob = { abort, clipId: item.id, kind: "export" };
    const report = (patch: Record<string, unknown>) =>
      this.server.send("panel", { type: "export", clipId: item.id, ...patch });
    let last = 0;
    report({ state: "running", progress: 0 });
    runFfmpeg(this.ffmpegBin, args, end - start, (fraction) => {
      if (Date.now() - last < 250) return;
      last = Date.now();
      report({ state: "running", progress: fraction });
    }, abort.signal)
      .then(() => {
        const created = this.library.add(output, "export", { markerTs: item.markerTs, note: item.note });
        this.exportJob = null;
        report({ state: "done", progress: 1, newId: created.id, file: output });
      })
      .catch((err: Error) => {
        fs.rmSync(output, { force: true });
        this.exportJob = null;
        report({ state: "error", error: err.message });
      })
      .finally(() => this.pushState());
    this.pushState();
  }

  private async clipCopy(data: Record<string, unknown>) {
    const { settings, secrets } = this.config;
    if (!secrets.anthropicApiKey) throw new Error("Falta la clave de Anthropic (Ajustes → Claves).");
    const item = this.library.get(data.id);
    const note = typeof data.note === "string" ? data.note.slice(0, 500) : (item.note ?? "");
    const at = item.markerTs;
    const copy = await generateClipCopy(secrets.anthropicApiKey, settings.agent.model, {
      personaName: settings.personaName,
      game: settings.game,
      note,
      chat: at ? this.chatLog.filter((m) => m.kind === "chat" && m.ts > at - 60_000 && m.ts < at + 10_000).slice(-25) : [],
      said: item.script?.length
        ? item.script
        : at
          ? this.logHistory.filter((l) => l.text && l.ts > at - 60_000 && l.ts < at + 10_000).map((l) => l.text)
          : [],
    });
    this.library.update(item.id, { note, copy });
    this.pushState();
    return copy;
  }

  /** Narra un tramo de un vídeo de la biblioteca con la voz del personaje y lo guarda como vídeo nuevo. */
  private startNarration(data: Record<string, unknown>): void {
    if (this.exportJob) throw new Error("Ya hay una exportación o narración en marcha.");
    if (!this.ffmpegBin) {
      throw new Error('No encuentro ffmpeg. Instálalo con "brew install ffmpeg" o indica su ruta en Ajustes → Clips.');
    }
    const { settings, secrets } = this.config;
    if (!secrets.anthropicApiKey) throw new Error("Narrar clips necesita la clave de Anthropic (Ajustes → Claves).");
    const voice = this.clipVoice();
    if (!voice) {
      throw new Error("Configura una voz (ElevenLabs o local) en Ajustes → Co-host y voz para narrar clips.");
    }
    const item = this.library.get(data.id);
    if (!fs.existsSync(item.file)) throw new Error("El archivo original ya no existe.");
    const start = Number(data.start);
    const end = Number(data.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("Marca un inicio y un fin válidos.");
    }
    if (end - start > MAX_NARRATION_SECONDS) throw new Error("Para narrar, marca un tramo de 3 minutos como mucho.");
    const note = typeof data.note === "string" ? data.note.slice(0, 500) : (item.note ?? "");

    const folder = this.clipsFolder();
    fs.mkdirSync(folder, { recursive: true });
    const base = path.parse(item.name).name.replace(/[^\w.-]+/g, "_").slice(0, 60);
    let output = "";
    for (let n = 0; ; n++) {
      output = path.join(folder, `${base}_narrado_${timeTag(start)}-${timeTag(end)}${n ? `_${n}` : ""}.mp4`);
      if (!fs.existsSync(output)) break;
    }

    const abort = new AbortController();
    this.exportJob = { abort, clipId: item.id, kind: "narrate" };
    const report = (patch: Record<string, unknown>) =>
      this.server.send("panel", { type: "export", clipId: item.id, kind: "narrate", ...patch });
    let last = 0;
    const persona = loadPersona(settings.personaName, settings.game);
    const apiKey = secrets.anthropicApiKey;
    const model = settings.agent.model;
    const game = settings.game;
    report({ state: "running", progress: 0, stage: "Preparando" });
    narrateClip(
      { input: item.file, start, end, output, subtitles: data.subtitles !== false },
      {
        ffmpeg: this.ffmpegBin,
        voice,
        script: (frames, duration, signal) =>
          this.options.narrator
            ? this.options.narrator(frames, duration)
            : generateNarrationScript(apiKey, model, { persona, game, note, duration, frames, tags: !!voice.tags }, signal),
        progress: (stage, fraction) => {
          if (Date.now() - last < 250) return;
          last = Date.now();
          report({ state: "running", progress: fraction, stage });
        },
      },
      abort.signal,
    )
      .then(({ lines }) => {
        const created = this.library.add(output, "export", {
          markerTs: item.markerTs,
          note,
          script: lines.map((l) => l.text),
        });
        this.library.update(item.id, { note });
        this.exportJob = null;
        report({ state: "done", progress: 1, newId: created.id, file: output });
      })
      .catch((err: Error) => {
        fs.rmSync(output, { force: true });
        this.exportJob = null;
        const message = abort.signal.aborted ? "Narración cancelada." : err.message;
        if (err instanceof BrainError && err.fatal) this.agent.problem = err.message;
        report({ state: "error", error: message });
      })
      .finally(() => this.pushState());
    this.pushState();
  }

  /** Voz para narrar: la expresiva si hay, si no la normal. */
  private narrationVoice(): Voice {
    return this.voiceKind === "elevenlabs" && this.expressiveVoice ? this.expressiveVoice : this.voice;
  }

  /**
   * Voz para narrar clips: la local si así se ha elegido (aunque el directo use
   * ElevenLabs), si no la misma que al jugar solo. null si no hay ninguna voz.
   */
  private clipVoice(): Voice | null {
    const { voice } = this.config.settings;
    if (!this.options.voice && voice.clipsEngine === "local") {
      return voice.localModel.trim() ? new LocalVoice(voice) : null;
    }
    return this.voiceKind === "silent" ? null : this.narrationVoice();
  }

  // ---- Configuración ----

  /** Aplica ajustes y claves: reinicia solo los conectores cuya configuración ha cambiado. */
  private async apply(): Promise<void> {
    const { settings, secrets } = this.config;
    this.filter.setOptions(settings.filter);

    const wanted = new Map<Platform, { signature: string; make: () => Connector }>();
    // Jugando sin directo no se conecta a ningún chat.
    const solo = settings.session.mode === "solo";
    if (!solo && settings.twitch.enabled && settings.twitch.channel) {
      wanted.set("twitch", {
        signature: settings.twitch.channel,
        make: () => new TwitchConnector(settings.twitch.channel, this.context("twitch")),
      });
    }
    if (!solo && settings.youtube.enabled && settings.youtube.videoId) {
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
    if (!solo && settings.tiktok.enabled && settings.tiktok.username) {
      wanted.set("tiktok", {
        signature: settings.tiktok.username,
        make: () => new TikTokConnector(settings.tiktok.username, this.context("tiktok")),
      });
    }
    if (!solo && this.simOn) {
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
    } else if (settings.agent.engine === "local" && settings.agent.localModel.trim()) {
      const persona = loadPersona(settings.personaName, settings.game);
      this.brain = new LocalBrain(settings.agent.localUrl, settings.agent.localModel, persona);
      this.brainKind = "local";
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

    this.expressiveVoice = null;
    if (this.options.voice) {
      this.voice = this.options.voice;
      this.voiceKind = "elevenlabs";
    } else if (settings.voice.engine === "local" && settings.voice.localModel.trim()) {
      this.voice = new LocalVoice(settings.voice);
      this.voiceKind = "local";
    } else if (secrets.elevenLabsApiKey && settings.voice.voiceId) {
      this.voice = new ElevenLabsVoice(secrets.elevenLabsApiKey, settings.voice);
      this.voiceKind = "elevenlabs";
      this.expressiveVoice = settings.voice.expressiveModelId.trim()
        ? new ElevenLabsExpressiveVoice(secrets.elevenLabsApiKey, settings.voice, this.options.elevenLabsBaseUrl)
        : null;
    } else {
      this.voice = new SilentVoice();
      this.voiceKind = "silent";
    }

    this.obs.setAutoConnect(settings.obs.enabled ? { url: settings.obs.url, password: secrets.obsPassword } : null);
    this.ffmpegBin = await findFfmpeg(settings.clips.ffmpegPath.trim());
    this.pushBrand();
    this.pushState();
  }

  // ---- Estado para el panel y los overlays ----

  private brandInfo() {
    const { settings } = this.config;
    return {
      name: settings.personaName,
      accent: /^#[0-9a-f]{6}$/i.test(settings.brand.accent) ? settings.brand.accent : "#e8b64c",
      ticker: settings.brand.ticker,
      socials: parsePairs(settings.brand.socials),
      slots: this.brand.describe(),
    };
  }

  private pushBrand(): void {
    this.server.send(["overlay", "scene"], { type: "brand", brand: this.brandInfo() });
  }

  private statsSnapshot() {
    return this.stats.snapshot(this.config.settings.voice.modelId, this.voiceKind === "elevenlabs");
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
      brand: { ...this.brandInfo(), meta: SLOTS },
      clips: {
        ffmpeg: !!this.ffmpegBin,
        folder: this.clipsFolder(),
        exporting: this.exportJob?.clipId ?? null,
        exportingKind: this.exportJob?.kind ?? null,
        items: this.library.list(),
        markers: this.highlights.list(),
      },
      stats: this.statsSnapshot(),
    };
  }

  private pushState(): void {
    if (this.server.count("panel")) this.server.send("panel", { type: "state", state: this.state() });
  }

  private hello(role: Role): unknown[] {
    if (role !== "panel") {
      // Se avisa al panel de que hay un overlay nuevo conectado.
      setTimeout(() => this.pushState(), 0);
      return [{ type: "brand", brand: this.brandInfo() }];
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

  // ---- Controles rápidos (también para los atajos de teclado de la app de escritorio) ----

  togglePause(): void {
    this.agent.setPaused(!this.agent.paused);
  }

  skip(): void {
    this.agent.skip();
  }

  // ---- API ----

  /** Rutas binarias: artes de la marca, vídeos de la biblioteca y subida de archivos. */
  private async handleRaw(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const parts = url.pathname.split("/").filter(Boolean);
    if ((req.method === "GET" || req.method === "HEAD") && parts.length === 2) {
      if (parts[0] === "brand") {
        const asset = isSlot(parts[1]) ? this.brand.find(parts[1]) : null;
        if (!asset) res.writeHead(404).end();
        else serveFile(req, res, asset.file);
        return true;
      }
      if (parts[0] === "media") {
        let file: string;
        try {
          file = this.library.get(parts[1]).file;
        } catch {
          res.writeHead(404).end();
          return true;
        }
        serveFile(req, res, file);
        return true;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/brand/upload") {
      const slot = url.searchParams.get("slot");
      if (!isSlot(slot)) throw new Error("Hueco de marca desconocido.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) throw new Error("El archivo supera los 80 MB.");
        chunks.push(chunk);
      }
      this.brand.save(slot, url.searchParams.get("name") ?? "", Buffer.concat(chunks));
      this.pushBrand();
      this.pushState();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }
    return false;
  }

  private async handleApi(method: string, route: string, body: unknown): Promise<unknown> {
    const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (method === "GET" && route === "state") return this.state();
    if (method !== "POST") throw new Error("Método no admitido.");
    switch (route) {
      case "settings": {
        const before = this.config.settings.session.mode;
        this.config.updateSettings(data);
        if (this.config.settings.session.mode !== before) {
          // Al cambiar de modo se descarta el chat pendiente y los avisos del modo anterior.
          this.agent.selector.clear();
          this.agent.problem = "";
        }
        await this.apply();
        return this.state();
      }
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
        return this.obsAction(data);
      case "brand/remove":
        if (!isSlot(data.slot)) throw new Error("Hueco de marca desconocido.");
        this.brand.remove(data.slot);
        this.pushBrand();
        this.pushState();
        return { ok: true };
      case "clip":
        return this.clipNow("manual", typeof data.label === "string" && data.label.trim() ? data.label.trim().slice(0, 80) : "Marcado a mano");
      case "clips/import": {
        if (typeof data.path !== "string" || !data.path.trim()) throw new Error("Escribe la ruta del vídeo.");
        const item = this.library.add(data.path.trim().replace(/^~(?=\/)/, os.homedir()), "import");
        this.pushState();
        return item;
      }
      case "clips/remove":
        this.library.remove(data.id);
        this.pushState();
        return { ok: true };
      case "clips/note":
        this.library.update(data.id, { note: String(data.note ?? "").slice(0, 500) });
        return { ok: true };
      case "clips/export":
        this.startExport(data);
        return { ok: true };
      case "clips/narrate":
        this.startNarration(data);
        return { ok: true };
      case "clips/cancel":
        this.exportJob?.abort.abort();
        return { ok: true };
      case "clips/copy":
        return this.clipCopy(data);
      case "clips/reveal": {
        const item = this.library.get(data.id);
        if (process.platform !== "darwin") return { file: item.file };
        spawn("open", ["-R", item.file], { stdio: "ignore", detached: true }).unref();
        return { ok: true };
      }
      default:
        throw new Error("Ruta desconocida.");
    }
  }

  private async obsAction(data: Record<string, unknown>): Promise<unknown> {
    switch (data.action) {
      case "connect":
        await this.obs.connect(this.config.settings.obs.url, this.config.secrets.obsPassword);
        if (!this.obs.status.connected) throw new Error(this.obs.status.detail ?? "No se pudo conectar con OBS.");
        break;
      case "start":
        await this.obs.setStreaming(true);
        break;
      case "stop":
        await this.obs.setStreaming(false);
        break;
      case "record-start":
        await this.obs.setRecording(true);
        break;
      case "record-stop":
        await this.obs.setRecording(false);
        break;
      case "replay-start":
        await this.obs.setReplay(true);
        break;
      case "replay-stop":
        await this.obs.setReplay(false);
        break;
      case "scene":
        if (typeof data.name !== "string" || !this.obs.status.scenes.includes(data.name)) {
          throw new Error("Esa escena no existe en OBS.");
        }
        await this.obs.setScene(data.name);
        break;
      default:
        throw new Error("Acción desconocida.");
    }
    return { ok: true };
  }
}
