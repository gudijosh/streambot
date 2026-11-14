import type { Connector, ConnectorContext } from "../types.js";

/**
 * Chat de TikTok LIVE con la librería no oficial tiktok-live-connector (TikTok no
 * ofrece API pública). Va aislado y es opcional: si la librería falla o TikTok
 * cambia algo, el resto de la app sigue funcionando.
 */
export class TikTokConnector implements Connector {
  readonly platform = "tiktok" as const;
  private connection: { disconnect(): unknown } | null = null;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly username: string,
    private readonly ctx: ConnectorContext,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const user = this.username.trim().replace(/^@/, "");
    if (!user) {
      this.ctx.onStatus({ state: "error", detail: "Falta el usuario de TikTok." });
      return;
    }
    this.ctx.onStatus({ state: "connecting" });
    let lib: any;
    try {
      lib = await import("tiktok-live-connector");
    } catch {
      this.ctx.onStatus({ state: "error", detail: "La librería de TikTok no está instalada." });
      return;
    }
    await this.connect(lib, user);
  }

  private async connect(lib: any, user: string): Promise<void> {
    if (this.stopped) return;
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    const conn = new TikTokLiveConnection(user);
    this.connection = conn;
    let seq = 0;
    const emit = (data: any, kind: "chat" | "gift" | "follow", text: string, detail?: string) => {
      const name = data?.user?.nickname || data?.user?.uniqueId || "alguien";
      this.ctx.onMessage({
        id: `tiktok:${Date.now()}-${seq++}`,
        platform: "tiktok",
        user: String(name),
        text,
        kind,
        detail,
        ts: Date.now(),
      });
    };
    conn.on(WebcastEvent.CHAT, (data: any) => emit(data, "chat", String(data?.comment ?? "")));
    conn.on(WebcastEvent.GIFT, (data: any) => {
      // Los regalos en racha llegan repetidos; solo cuenta el aviso final.
      if (data?.giftDetails?.giftType === 1 && !data?.repeatEnd) return;
      const giftName = data?.giftDetails?.giftName ?? `regalo ${data?.giftId ?? ""}`.trim();
      emit(data, "gift", "", `${giftName} x${data?.repeatCount ?? 1}`);
    });
    conn.on(WebcastEvent.FOLLOW, (data: any) => emit(data, "follow", ""));
    const retry = (detail: string) => {
      if (this.stopped || this.connection !== conn) return;
      this.ctx.onStatus({ state: "error", detail: `${detail} Reintento en 30 s.` });
      this.timer = setTimeout(() => void this.connect(lib, user), 30_000);
    };
    if (ControlEvent?.DISCONNECTED) conn.on(ControlEvent.DISCONNECTED, () => retry("Desconectado de TikTok."));
    if (WebcastEvent.STREAM_END) conn.on(WebcastEvent.STREAM_END, () => retry("El directo ha terminado."));
    try {
      await conn.connect();
      this.ctx.onStatus({ state: "connected", detail: `@${user}` });
    } catch (err) {
      retry(`No se pudo conectar (${(err as Error).message}). ¿Está @${user} en directo?`);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      await this.connection?.disconnect();
    } catch {
      // Ya estaba desconectado.
    }
    this.connection = null;
    this.ctx.onStatus({ state: "off" });
  }
}
