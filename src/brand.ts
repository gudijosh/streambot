import fs from "node:fs";
import path from "node:path";

type Kind = "image" | "video" | "audio";

const EXTENSIONS: Record<Kind, string[]> = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  video: [".mp4", ".webm"],
  audio: [".mp3", ".wav", ".ogg", ".m4a"],
};

/** Huecos del kit de marca: cada uno admite un archivo y tiene un uso fijo en el directo. */
export const SLOTS = {
  logo: { label: "Logo", hint: "Marca de agua en la esquina del directo y de los clips. PNG con fondo transparente.", kinds: ["image"] },
  avatar: { label: "Avatar del personaje", hint: "Aparece junto a los subtítulos cuando el personaje habla.", kinds: ["image"] },
  frame: { label: "Marco", hint: "Imagen a pantalla completa sobre el juego. PNG transparente de 1920 × 1080.", kinds: ["image"] },
  starting: { label: "Pantalla: empezamos pronto", hint: "Fondo de la escena de inicio. Imagen o vídeo en bucle.", kinds: ["image", "video"] },
  brb: { label: "Pantalla: vuelvo enseguida", hint: "Fondo de la escena de pausa. Imagen o vídeo en bucle.", kinds: ["image", "video"] },
  ending: { label: "Pantalla: fin del directo", hint: "Fondo de la escena de despedida. Imagen o vídeo en bucle.", kinds: ["image", "video"] },
  alert: { label: "Imagen de alerta", hint: "Se muestra con cada suscripción, regalo, donación o seguidor nuevo.", kinds: ["image"] },
  alertSound: { label: "Sonido de alerta", hint: "Suena con cada alerta.", kinds: ["audio"] },
} as const satisfies Record<string, { label: string; hint: string; kinds: readonly Kind[] }>;

export type Slot = keyof typeof SLOTS;

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && Object.hasOwn(SLOTS, value);
}

export interface BrandAsset {
  file: string;
  kind: Kind;
  version: number;
  /** true si viene de la carpeta brand/ del proyecto y no de una subida del panel. */
  bundled: boolean;
}

/**
 * Artes de la marca. Cada hueco se guarda como <hueco>.<ext>. Se buscan primero las
 * subidas desde el panel y después las incluidas en la carpeta brand/ del proyecto.
 */
export class BrandKit {
  constructor(
    private readonly userDir: string,
    private readonly bundledDir: string,
  ) {}

  find(slot: Slot): BrandAsset | null {
    for (const [dir, bundled] of [[this.userDir, false], [this.bundledDir, true]] as const) {
      for (const kind of SLOTS[slot].kinds) {
        for (const ext of EXTENSIONS[kind]) {
          const file = path.join(dir, slot + ext);
          try {
            const stat = fs.statSync(file);
            if (stat.isFile()) return { file, kind, version: Math.round(stat.mtimeMs), bundled };
          } catch {
            // No existe con esta extensión.
          }
        }
      }
    }
    return null;
  }

  save(slot: Slot, filename: string, data: Buffer): BrandAsset {
    const ext = path.extname(filename).toLowerCase();
    const allowed = SLOTS[slot].kinds.flatMap((k) => EXTENSIONS[k]);
    if (!allowed.includes(ext)) {
      throw new Error(`"${SLOTS[slot].label}" admite: ${allowed.join(", ")}.`);
    }
    if (data.length === 0) throw new Error("El archivo está vacío.");
    if (data.length > MAX_UPLOAD_BYTES) throw new Error("El archivo supera los 80 MB.");
    fs.mkdirSync(this.userDir, { recursive: true });
    this.removeFrom(this.userDir, slot);
    fs.writeFileSync(path.join(this.userDir, slot + ext), data);
    return this.find(slot)!;
  }

  /** Quita la subida del panel. Si el proyecto trae un arte para ese hueco, vuelve a usarse. */
  remove(slot: Slot): void {
    this.removeFrom(this.userDir, slot);
  }

  private removeFrom(dir: string, slot: Slot): void {
    for (const kind of SLOTS[slot].kinds) {
      for (const ext of EXTENSIONS[kind]) fs.rmSync(path.join(dir, slot + ext), { force: true });
    }
  }

  /** Resumen para el panel y los overlays: qué huecos están ocupados y con qué dirección se sirven. */
  describe(): Record<Slot, { url: string; kind: Kind; bundled: boolean } | null> {
    const out = {} as Record<Slot, { url: string; kind: Kind; bundled: boolean } | null>;
    for (const slot of Object.keys(SLOTS) as Slot[]) {
      const asset = this.find(slot);
      out[slot] = asset ? { url: `/brand/${slot}?v=${asset.version}`, kind: asset.kind, bundled: asset.bundled } : null;
    }
    return out;
  }
}

/** Convierte líneas "Nombre = valor" en pares, ignorando las mal formadas. */
export function parsePairs(lines: string[]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (name && value) out.push({ name, value });
  }
  return out;
}
