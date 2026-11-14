import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { PUBLIC_DIR } from "./paths.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export type Role = "panel" | "overlay";

export interface ApiHandlers {
  /** Devuelve el cuerpo JSON de respuesta; lanza un Error para responder 400. */
  handle(method: string, route: string, body: unknown): Promise<unknown>;
  /** Mensaje inicial al conectar un cliente. */
  hello(role: Role): unknown[];
  onClientMessage(role: Role, data: unknown): void;
}

/** Servidor local: panel de control, overlay para OBS, API y WebSocket. Solo escucha en 127.0.0.1. */
export class LocalServer {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, Role>();
  port = 0;

  constructor(private readonly api: ApiHandlers) {
    this.http = http.createServer((req, res) => void this.onRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.http.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws" || !this.sameOrigin(req)) {
        socket.destroy();
        return;
      }
      const role: Role = url.searchParams.get("role") === "overlay" ? "overlay" : "panel";
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.clients.set(ws, role);
        for (const msg of this.api.hello(role)) ws.send(JSON.stringify(msg));
        ws.on("message", (raw, isBinary) => {
          if (isBinary) return;
          try {
            this.api.onClientMessage(role, JSON.parse(raw.toString()));
          } catch {
            // Mensaje mal formado: se ignora.
          }
        });
        ws.on("close", () => this.clients.delete(ws));
        ws.on("error", () => this.clients.delete(ws));
      });
    });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(port, "127.0.0.1", () => {
        const addr = this.http.address();
        this.port = typeof addr === "object" && addr ? addr.port : port;
        resolve(this.port);
      });
    });
  }

  close(): Promise<void> {
    for (const ws of this.clients.keys()) ws.terminate();
    return new Promise((resolve) => this.http.close(() => resolve()));
  }

  count(role: Role): number {
    let n = 0;
    for (const r of this.clients.values()) if (r === role) n++;
    return n;
  }

  send(role: Role | "all", msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const [ws, r] of this.clients) {
      if ((role === "all" || r === role) && ws.readyState === WebSocket.OPEN) ws.send(text);
    }
  }

  sendBinary(role: Role, data: Buffer): void {
    for (const [ws, r] of this.clients) {
      if (r === role && ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
    }
  }

  /**
   * Impide que una web cualquiera abierta en el navegador llame a la API local:
   * si la petición trae Origin, tiene que ser el de este mismo servidor.
   */
  private sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname.startsWith("/api/")) return this.onApi(req, res, url.pathname.slice(5));
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    let rel = url.pathname === "/" ? "/panel/index.html" : url.pathname;
    if (rel.endsWith("/")) rel += "index.html";
    if (rel === "/panel" || rel === "/overlay") {
      res.writeHead(302, { Location: `${rel}/${url.search}` }).end();
      return;
    }
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("No encontrado");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  }

  private async onApi(req: http.IncomingMessage, res: http.ServerResponse, route: string): Promise<void> {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    if (!this.sameOrigin(req)) return reply(403, { error: "Origen no permitido." });
    try {
      let body: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 100_000) return reply(413, { error: "Petición demasiado grande." });
          chunks.push(chunk);
        }
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      }
      reply(200, (await this.api.handle(req.method ?? "GET", route, body)) ?? { ok: true });
    } catch (err) {
      reply(400, { error: err instanceof Error ? err.message : "Error" });
    }
  }
}
