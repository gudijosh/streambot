import { OBSWebSocket } from "obs-websocket-js";

export interface ObsStatus {
  connected: boolean;
  streaming: boolean;
  detail?: string;
}

/** Control básico de OBS por obs-websocket (incluido en OBS 28+): estado y empezar/parar la emisión. */
export class ObsController {
  status: ObsStatus = { connected: false, streaming: false };
  private obs: OBSWebSocket | null = null;

  constructor(private readonly onChange: () => void) {}

  private set(patch: Partial<ObsStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onChange();
  }

  async connect(url: string, password: string): Promise<void> {
    await this.disconnect();
    const obs = new OBSWebSocket();
    this.obs = obs;
    obs.on("StreamStateChanged", (e) => this.set({ streaming: e.outputActive }));
    obs.on("ConnectionClosed", () => {
      if (this.obs === obs) this.set({ connected: false, streaming: false, detail: "OBS desconectado." });
    });
    try {
      await obs.connect(url, password || undefined);
      const stream = await obs.call("GetStreamStatus");
      this.set({ connected: true, streaming: stream.outputActive, detail: undefined });
    } catch (err) {
      this.obs = null;
      this.set({
        connected: false,
        streaming: false,
        detail: `No se pudo conectar con OBS: ${(err as Error).message || "¿está abierto y con WebSocket activado?"}`,
      });
    }
  }

  async disconnect(): Promise<void> {
    const obs = this.obs;
    this.obs = null;
    if (obs) await obs.disconnect().catch(() => {});
    this.status = { connected: false, streaming: false };
  }

  async setStreaming(on: boolean): Promise<void> {
    if (!this.obs || !this.status.connected) throw new Error("OBS no está conectado.");
    await this.obs.call(on ? "StartStream" : "StopStream");
  }
}
