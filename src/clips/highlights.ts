export type MarkerReason = "manual" | "chat" | "spike";

export interface Marker {
  id: string;
  ts: number;
  reason: MarkerReason;
  label: string;
  /** Vídeo guardado para este momento, si el búfer de repetición estaba activo. */
  clipId?: string;
}

const WINDOW_MS = 10_000;
const BASELINE_MS = 120_000;
const MIN_COUNT = 8;
const COOLDOWN_MS = 90_000;

/**
 * Detecta cuándo el chat se dispara: muchos más mensajes en los últimos 10 s que
 * la media de los dos minutos anteriores. Suele coincidir con una buena jugada.
 */
export class SpikeDetector {
  private times: number[] = [];
  private lastTrigger = -Infinity;

  add(ts: number): boolean {
    this.times.push(ts);
    while (this.times.length && ts - this.times[0] > BASELINE_MS) this.times.shift();
    const recent = this.times.filter((t) => ts - t <= WINDOW_MS).length;
    const older = this.times.length - recent;
    const baseline = older / ((BASELINE_MS - WINDOW_MS) / WINDOW_MS);
    if (recent >= Math.max(MIN_COUNT, baseline * 3) && ts - this.lastTrigger > COOLDOWN_MS) {
      this.lastTrigger = ts;
      return true;
    }
    return false;
  }
}

const MAX_MARKERS = 200;

/** Lista de momentos destacados del directo actual. */
export class Highlights {
  private markers: Marker[] = [];
  private seq = 0;

  add(ts: number, reason: MarkerReason, label: string): Marker {
    const marker: Marker = { id: `k${++this.seq}`, ts, reason, label };
    this.markers.push(marker);
    if (this.markers.length > MAX_MARKERS) this.markers.shift();
    return marker;
  }


  list(): Marker[] {
    return [...this.markers].reverse();
  }
}
