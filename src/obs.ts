import { OBSWebSocket } from "obs-websocket-js";

export interface ObsStatus {
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  /** Búfer de repetición en marcha: permite guardar los últimos segundos como clip. */
  replay: boolean;
  scenes: string[];
  scene: string;
  detail?: string;
}

export interface ObsEvents {
  onChange(): void;
  onReplaySaved(file: string): void;
  onRecordingSaved(file: string): void;
}

const OFF: ObsStatus = { connected: false, streaming: false, recording: false, replay: false, scenes: [], scene: "" };

/** Control de OBS por obs-websocket (incluido en OBS 28+). */
export class ObsController {
  status: ObsStatus = { ...OFF };
  private obs: OBSWebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private auto: { url: string; password: string } | null = null;

  constructor(private readonly events: ObsEvents) {}

  private set(patch: Partial<ObsStatus>): void {
    this.status = { ...this.status, ...patch };
    this.events.onChange();
  }

  /** Mantiene la conexión con OBS: reintenta cada 10 s mientras no esté disponible. */
  setAutoConnect(config: { url: string; password: string } | null): void {
    const changed = JSON.stringify(config) !== JSON.stringify(this.auto);
    this.auto = config;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (config && (changed || !this.status.connected)) void this.connect(config.url, config.password);
  }

  private scheduleRetry(): void {
    if (!this.auto || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.auto && !this.status.connected) void this.connect(this.auto.url, this.auto.password);
    }, 10_000);
  }

  async connect(url: string, password: string): Promise<void> {
    await this.disconnect();
    const obs = new OBSWebSocket();
    this.obs = obs;
    obs.on("StreamStateChanged", (e) => this.set({ streaming: e.outputActive }));
    obs.on("RecordStateChanged", (e) => {
      this.set({ recording: e.outputActive });
      if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED" && e.outputPath) this.events.onRecordingSaved(e.outputPath);
    });
    obs.on("ReplayBufferStateChanged", (e) => this.set({ replay: e.outputActive }));
    obs.on("ReplayBufferSaved", (e) => this.events.onReplaySaved(e.savedReplayPath));
    obs.on("CurrentProgramSceneChanged", (e) => this.set({ scene: e.sceneName }));
    obs.on("SceneListChanged", () => void this.refreshScenes());
    obs.on("ConnectionClosed", () => {
      if (this.obs !== obs) return;
      this.obs = null;
      this.set({ ...OFF, detail: "OBS desconectado." });
      this.scheduleRetry();
    });
    try {
      await obs.connect(url, password || undefined);
      const [stream, record, replay] = await Promise.all([
        obs.call("GetStreamStatus"),
        obs.call("GetRecordStatus"),
        // Si el búfer de repetición no está activado en los ajustes de OBS, la consulta falla.
        obs.call("GetReplayBufferStatus").catch(() => ({ outputActive: false })),
      ]);
      this.status = {
        ...OFF,
        connected: true,
        streaming: stream.outputActive,
        recording: record.outputActive,
        replay: replay.outputActive,
      };
      await this.refreshScenes();
    } catch (err) {
      this.obs = null;
      this.set({
        ...OFF,
        detail: `No se pudo conectar con OBS: ${(err as Error).message || "¿está abierto y con el servidor WebSocket activado?"}`,
      });
      this.scheduleRetry();
    }
  }

  private async refreshScenes(): Promise<void> {
    if (!this.obs) return;
    try {
      const list = await this.obs.call("GetSceneList");
      this.set({
        // OBS devuelve las escenas de abajo arriba.
        scenes: list.scenes.map((s) => String(s.sceneName)).reverse(),
        scene: list.currentProgramSceneName,
      });
    } catch {
      this.events.onChange();
    }
  }

  async disconnect(): Promise<void> {
    const obs = this.obs;
    this.obs = null;
    if (obs) await obs.disconnect().catch(() => {});
    this.status = { ...OFF };
  }

  async stop(): Promise<void> {
    this.auto = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    await this.disconnect();
  }

  private client(): OBSWebSocket {
    if (!this.obs || !this.status.connected) throw new Error("OBS no está conectado.");
    return this.obs;
  }

  async setStreaming(on: boolean): Promise<void> {
    await this.client().call(on ? "StartStream" : "StopStream");
  }

  async setRecording(on: boolean): Promise<void> {
    await this.client().call(on ? "StartRecord" : "StopRecord");
  }

  async setReplay(on: boolean): Promise<void> {
    try {
      await this.client().call(on ? "StartReplayBuffer" : "StopReplayBuffer");
    } catch (err) {
      if (!this.status.connected) throw err;
      throw new Error("Activa el búfer de repetición en OBS: Ajustes → Salida → Búfer de repetición.");
    }
  }

  /** Guarda los últimos segundos del búfer de repetición. El aviso con el archivo llega por onReplaySaved. */
  async saveReplay(): Promise<void> {
    await this.client().call("SaveReplayBuffer");
  }

  async setScene(name: string): Promise<void> {
    await this.client().call("SetCurrentProgramScene", { sceneName: name });
  }

  /** Captura reducida de lo que se está emitiendo, en JPEG base64. Devuelve null si no hay OBS. */
  async screenshot(width = 768): Promise<string | null> {
    if (!this.obs || !this.status.connected || !this.status.scene) return null;
    const shot = await this.obs.call("GetSourceScreenshot", {
      sourceName: this.status.scene,
      imageFormat: "jpg",
      imageWidth: width,
      imageCompressionQuality: 60,
    });
    const comma = shot.imageData.indexOf(",");
    return comma === -1 ? null : shot.imageData.slice(comma + 1);
  }
}
