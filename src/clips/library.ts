import fs from "node:fs";
import path from "node:path";
import type { ClipCopy } from "../types.js";

export const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".mkv", ".webm"];

export type ClipKind = "replay" | "recording" | "export" | "import";

export interface ClipItem {
  id: string;
  file: string;
  name: string;
  kind: ClipKind;
  createdAt: number;
  /** Momento del directo al que corresponde (para dar contexto del chat a la IA). */
  markerTs?: number;
  /** Nota del operador: de qué va el clip. */
  note?: string;
  copy?: ClipCopy;
}

const MAX_ITEMS = 500;

/** Índice de vídeos de la app: clips guardados, grabaciones y exportaciones. No mueve ni borra archivos. */
export class ClipLibrary {
  private items: ClipItem[] = [];
  private seq = 0;

  constructor(private readonly indexFile: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (Array.isArray(raw)) {
        this.items = raw.filter((i) => i && typeof i.id === "string" && typeof i.file === "string");
      }
    } catch {
      // Sin índice todavía.
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify(this.items, null, 2));
  }

  add(file: string, kind: ClipKind, extra: Partial<Pick<ClipItem, "markerTs" | "note">> = {}): ClipItem {
    const resolved = path.resolve(file);
    if (!VIDEO_EXTENSIONS.includes(path.extname(resolved).toLowerCase())) {
      throw new Error(`Solo se admiten vídeos (${VIDEO_EXTENSIONS.join(", ")}).`);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error("No existe ningún archivo en esa ruta.");
    }
    const existing = this.items.find((i) => i.file === resolved);
    if (existing) return existing;
    const item: ClipItem = {
      id: `c${Date.now().toString(36)}${(this.seq++).toString(36)}`,
      file: resolved,
      name: path.basename(resolved),
      kind,
      createdAt: Date.now(),
      ...extra,
    };
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items.shift();
    this.save();
    return item;
  }

  get(id: unknown): ClipItem {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error("Ese vídeo ya no está en la biblioteca.");
    return item;
  }

  update(id: unknown, patch: Partial<Pick<ClipItem, "note" | "copy">>): ClipItem {
    const item = this.get(id);
    Object.assign(item, patch);
    this.save();
    return item;
  }

  /** Quita el vídeo de la lista. El archivo se queda en el disco. */
  remove(id: unknown): void {
    this.get(id);
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }

  /** Más recientes primero, indicando si el archivo sigue existiendo. */
  list(): (ClipItem & { missing: boolean })[] {
    return [...this.items].reverse().map((i) => ({ ...i, missing: !fs.existsSync(i.file) }));
  }
}
