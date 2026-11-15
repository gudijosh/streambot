import fs from "node:fs";
import type http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Sirve un fichero local admitiendo peticiones parciales, necesarias para moverse por un vídeo. */
export function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end("No encontrado");
      return;
    }
    const headers: Record<string, string | number> = {
      "Content-Type": contentType(file),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = stat.size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, stat.size - Number(range[2]));
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
    } else {
      headers["Content-Length"] = stat.size;
      res.writeHead(200, headers);
    }
    if (req.method === "HEAD" || stat.size === 0) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
}
