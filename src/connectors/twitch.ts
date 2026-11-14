import WebSocket from "ws";
import type { ChatMessage, Connector, ConnectorContext } from "../types.js";

export interface IrcLine {
  tags: Record<string, string>;
  nick: string;
  command: string;
  params: string[];
}

function unescapeTag(value: string): string {
  return value.replace(/\\(.)/g, (_m, c: string) =>
    c === "s" ? " " : c === ":" ? ";" : c === "n" ? "\n" : c === "r" ? "" : c,
  );
}

export function parseIrc(line: string): IrcLine | null {
  let rest = line;
  const tags: Record<string, string> = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) tags[pair] = "";
      else tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let nick = "";
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    nick = rest.slice(1, end).split("!")[0];
    rest = rest.slice(end + 1);
  }
  const trailingAt = rest.indexOf(" :");
  const head = trailingAt === -1 ? rest : rest.slice(0, trailingAt);
  const params = head.split(" ").filter(Boolean);
  const command = params.shift();
  if (!command) return null;
  if (trailingAt !== -1) params.push(rest.slice(trailingAt + 2));
  return { tags, nick, command, params };
}

export function ircToMessage(line: IrcLine, now: number): ChatMessage | null {
  const id = `twitch:${line.tags.id || `${now}-${Math.random().toString(36).slice(2)}`}`;
  const user = line.tags["display-name"] || line.tags.login || line.nick;
  if (line.command === "PRIVMSG") {
    let text = line.params[1] ?? "";
    const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
    if (action) text = action[1];
    const bits = Number(line.tags.bits || 0);
    return {
      id,
      platform: "twitch",
      user,
      text,
      kind: bits > 0 ? "donation" : "chat",
      detail: bits > 0 ? `${bits} bits` : undefined,
      ts: now,
    };
  }
  if (line.command === "USERNOTICE") {
    const type = line.tags["msg-id"] ?? "";
    if (!["sub", "resub", "subgift", "submysterygift", "raid"].includes(type)) return null;
    const detail =
      type === "raid"
        ? `raid con ${line.tags["msg-param-viewerCount"] ?? "?"} espectadores`
        : type === "resub"
          ? `${line.tags["msg-param-cumulative-months"] ?? "?"} meses`
          : type === "subgift"
            ? `regala una suscripción a ${line.tags["msg-param-recipient-display-name"] ?? "alguien"}`
            : type === "submysterygift"
              ? `regala ${line.tags["msg-param-mass-gift-count"] ?? "varias"} suscripciones`
              : "nueva suscripción";
    return { id, platform: "twitch", user, text: line.params[1] ?? "", kind: "sub", detail, ts: now };
  }
  return null;
}

/**
 * Chat de Twitch en solo lectura por IRC anónimo: no necesita clave ni registrar ninguna app.
 */
export class TwitchConnector implements Connector {
  readonly platform = "twitch" as const;
  private ws: WebSocket | null = null;
  private stopped = true;
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly channel: string,
    private readonly ctx: ConnectorContext,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.terminate();
    this.ws = null;
    this.ctx.onStatus({ state: "off" });
  }

  private connect(): void {
    const channel = this.channel.trim().replace(/^#/, "").toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(channel)) {
      this.ctx.onStatus({ state: "error", detail: "Nombre de canal no válido." });
      return;
    }
    this.ctx.onStatus({ state: "connecting" });
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;

    ws.on("open", () => {
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${channel}`);
    });
    ws.on("message", (raw) => {
      for (const text of raw.toString().split("\r\n")) {
        if (!text) continue;
        const line = parseIrc(text);
        if (!line) continue;
        if (line.command === "PING") ws.send(`PONG :${line.params[0] ?? "tmi.twitch.tv"}`);
        else if (line.command === "ROOMSTATE") {
          this.retry = 0;
          this.ctx.onStatus({ state: "connected", detail: `#${channel}` });
        } else if (line.command === "RECONNECT") ws.close();
        else {
          const msg = ircToMessage(line, Date.now());
          if (msg) this.ctx.onMessage(msg);
        }
      }
    });
    ws.on("error", () => {
      // El cierre posterior se encarga de reconectar.
    });
    ws.on("close", () => {
      if (this.stopped || this.ws !== ws) return;
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.ctx.onStatus({ state: "connecting", detail: `Reconectando en ${Math.round(wait / 1000)} s` });
      this.timer = setTimeout(() => this.connect(), wait);
    });
  }
}
