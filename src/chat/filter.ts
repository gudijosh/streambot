import type { ChatMessage } from "../types.js";

export type FilterVerdict =
  | { ok: true }
  | { ok: false; reason: "vacio" | "comando" | "enlace" | "vetado" | "duplicado" | "spam" | "manipulacion" };

export interface FilterOptions {
  bannedWords: string[];
  blockLinks: boolean;
}

const LINK = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|gg|ly|tv|io|xyz|ru|link)\b/i;

/** Frases típicas para intentar que la IA ignore su papel. Se muestran en el chat pero no llegan al personaje. */
const INJECTION = [
  /ignor[ae]\s+(tus|las|all|your|previous|todas)/i,
  /olvida\s+(tus|las|todo)/i,
  /(system|developer)\s*prompt/i,
  /instrucciones\s+(anteriores|del sistema|originales)/i,
  /previous\s+instructions/i,
  /you\s+are\s+now\b/i,
  /ahora\s+eres\b/i,
  /act[uú]a\s+como\s+si\s+no/i,
  /repite\s+(exactamente|textualmente|literalmente)/i,
  /jailbreak/i,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decide si un mensaje puede llegar al personaje. Todos los mensajes se muestran
 * en el chat unificado; el filtro solo controla a qué reacciona la IA.
 */
export class ChatFilter {
  private recent: { key: string; user: string; ts: number }[] = [];

  constructor(private options: FilterOptions) {}

  setOptions(options: FilterOptions): void {
    this.options = options;
  }

  check(msg: ChatMessage): FilterVerdict {
    // Los eventos (subs, regalos, follows) pasan aunque no traigan texto.
    if (msg.kind !== "chat" && !msg.text.trim()) return { ok: true };

    const text = msg.text.trim();
    if (!text) return { ok: false, reason: "vacio" };
    if (text.startsWith("!") || text.startsWith("/")) return { ok: false, reason: "comando" };
    if (this.options.blockLinks && LINK.test(text)) return { ok: false, reason: "enlace" };

    const norm = normalize(text);
    for (const word of this.options.bannedWords) {
      const w = normalize(word);
      if (w && norm.includes(w)) return { ok: false, reason: "vetado" };
    }
    if (INJECTION.some((re) => re.test(text))) return { ok: false, reason: "manipulacion" };

    const now = msg.ts;
    this.recent = this.recent.filter((r) => now - r.ts < 60_000);
    const same = this.recent.filter((r) => r.key === norm);
    const verdict: FilterVerdict = same.some((r) => r.user === msg.user)
      ? { ok: false, reason: "duplicado" }
      : same.length >= 3
        ? { ok: false, reason: "spam" }
        : { ok: true };
    if (verdict.ok) this.recent.push({ key: norm, user: msg.user, ts: now });
    return verdict;
  }
}
