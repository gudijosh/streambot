const MIN_CHARS = 24;
const MAX_CHARS = 220;

/**
 * Agrupa el texto que llega a trozos en frases completas, para mandarlas a la voz
 * en cuanto están listas sin cortar palabras.
 */
export class SentenceChunker {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }

  private findCut(): number {
    const re = /[.!?…]+["')\]»]*\s+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.buffer))) {
      const end = match.index + match[0].length;
      if (end >= MIN_CHARS) return end;
    }
    if (this.buffer.length > MAX_CHARS) {
      const comma = this.buffer.lastIndexOf(", ", MAX_CHARS);
      if (comma > MIN_CHARS) return comma + 2;
      const space = this.buffer.lastIndexOf(" ", MAX_CHARS);
      if (space > 0) return space + 1;
    }
    return -1;
  }
}

/** Convierte un flujo de trozos de texto en un flujo de frases. */
export async function* toSentences(deltas: AsyncIterable<string>): AsyncIterable<string> {
  const chunker = new SentenceChunker();
  for await (const delta of deltas) {
    for (const s of chunker.push(delta)) yield s;
  }
  for (const s of chunker.flush()) yield s;
}
