import type { ChatMessage, Connector, ConnectorContext } from "../types.js";

const API = "https://www.googleapis.com/youtube/v3";

/** Acepta el ID del vídeo o cualquier URL de YouTube que lo contenga. */
export function extractVideoId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  const match = /(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})/.exec(value);
  return match ? match[1] : null;
}

interface YtItem {
  id: string;
  snippet?: {
    type?: string;
    displayMessage?: string;
    publishedAt?: string;
    superChatDetails?: { amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountDisplayString?: string };
  };
  authorDetails?: { displayName?: string };
}

export function youtubeToMessage(item: YtItem, now: number): ChatMessage | null {
  const s = item.snippet;
  const user = item.authorDetails?.displayName ?? "alguien";
  const base = { id: `youtube:${item.id}`, platform: "youtube" as const, user, ts: now };
  switch (s?.type) {
    case "textMessageEvent":
      return { ...base, text: s.displayMessage ?? "", kind: "chat" };
    case "superChatEvent":
      return {
        ...base,
        text: s.superChatDetails?.userComment ?? "",
        kind: "donation",
        detail: `Super Chat ${s.superChatDetails?.amountDisplayString ?? ""}`.trim(),
      };
    case "superStickerEvent":
      return {
        ...base,
        text: "",
        kind: "donation",
        detail: `Super Sticker ${s.superStickerDetails?.amountDisplayString ?? ""}`.trim(),
      };
    case "newSponsorEvent":
    case "memberMilestoneChatEvent":
      return { ...base, text: s.displayMessage ?? "", kind: "sub", detail: "miembro del canal" };
    default:
      return null;
  }
}

/**
 * Chat de YouTube con la API oficial (liveChatMessages.list) y una clave de API.
 * Cada consulta cuesta 5 unidades de la cuota diaria (10.000 por defecto), así que
 * el intervalo de consulta decide cuántas horas de directo cubre la cuota.
 */
export class YouTubeConnector implements Connector {
  readonly platform = "youtube" as const;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private pageToken = "";
  private first = true;

  constructor(
    private readonly videoInput: string,
    private readonly apiKey: string,
    private readonly pollSeconds: number,
    private readonly ctx: ConnectorContext,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    if (!this.apiKey) {
      this.ctx.onStatus({ state: "error", detail: "Falta la clave de API de YouTube." });
      return;
    }
    const videoId = extractVideoId(this.videoInput);
    if (!videoId) {
      this.ctx.onStatus({ state: "error", detail: "Pega el enlace o el ID del directo de YouTube." });
      return;
    }
    this.ctx.onStatus({ state: "connecting" });
    try {
      const data = await this.get("videos", { part: "liveStreamingDetails", id: videoId });
      const chatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        this.ctx.onStatus({ state: "error", detail: "Ese vídeo no tiene un chat en directo activo." });
        return;
      }
      this.ctx.onStatus({ state: "connected", detail: videoId });
      void this.poll(chatId);
    } catch (err) {
      this.ctx.onStatus({ state: "error", detail: (err as Error).message });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ctx.onStatus({ state: "off" });
  }

  private async get(resource: string, params: Record<string, string>): Promise<any> {
    const query = new URLSearchParams({ ...params, key: this.apiKey });
    const res = await fetch(`${API}/${resource}?${query}`, { signal: AbortSignal.timeout(15_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = body?.error?.errors?.[0]?.reason ?? "";
      const text =
        reason === "quotaExceeded"
          ? "Cuota diaria de la API de YouTube agotada."
          : reason === "liveChatEnded"
            ? "El chat del directo ha terminado."
            : (body?.error?.message ?? `Error ${res.status} de YouTube`);
      throw Object.assign(new Error(text), { reason });
    }
    return body;
  }

  private async poll(chatId: string): Promise<void> {
    if (this.stopped) return;
    let wait = this.pollSeconds * 1000;
    try {
      const params: Record<string, string> = {
        liveChatId: chatId,
        part: "snippet,authorDetails",
        maxResults: "200",
      };
      if (this.pageToken) params.pageToken = this.pageToken;
      const data = await this.get("liveChat/messages", params);
      this.pageToken = data.nextPageToken ?? this.pageToken;
      // La primera página trae el historial anterior a conectar: no se reacciona a él.
      if (!this.first) {
        const now = Date.now();
        for (const item of data.items ?? []) {
          const msg = youtubeToMessage(item, now);
          if (msg) this.ctx.onMessage(msg);
        }
      }
      this.first = false;
      wait = Math.max(wait, Number(data.pollingIntervalMillis) || 0);
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      this.ctx.onStatus({ state: "error", detail: (err as Error).message });
      if (reason === "quotaExceeded" || reason === "liveChatEnded" || reason === "forbidden") return;
      wait = 15_000;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(chatId), wait);
  }
}
