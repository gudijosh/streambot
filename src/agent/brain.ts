import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { PERSONA_FILE } from "../paths.js";
import type { Brain, BrainInput, ChatMessage } from "../types.js";

export function loadPersona(name: string, game: string, file = PERSONA_FILE): string {
  return fs
    .readFileSync(file, "utf8")
    .replaceAll("{{NOMBRE}}", name)
    .replaceAll("{{JUEGO}}", game);
}

const KIND_LABEL: Record<ChatMessage["kind"], string> = {
  chat: "",
  sub: "SUSCRIPCIÓN",
  gift: "REGALO",
  follow: "NUEVO SEGUIDOR",
  donation: "DONACIÓN",
};

/** Quita los símbolos de etiqueta para que un mensaje no pueda cerrar el bloque del chat. */
function clean(text: string, max: number): string {
  return text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildUserTurn(input: BrainInput): string {
  const parts: string[] = [
    `<directo>Juego: ${input.game}. Llevas ${input.minutesLive} minutos en directo.</directo>`,
  ];
  if (input.recentSaid.length) {
    parts.push(
      `<lo_ultimo_que_dijiste>\n${input.recentSaid.map((s) => `- ${s}`).join("\n")}\n</lo_ultimo_que_dijiste>`,
    );
  }
  if (input.messages.length) {
    const lines = input.messages.map((m) => {
      const label = KIND_LABEL[m.kind];
      const head = `[${m.platform}] ${clean(m.user, 40)}`;
      const event = label ? ` (${label}${m.detail ? `: ${clean(m.detail, 60)}` : ""})` : "";
      const text = clean(m.text, 300);
      return `${head}${event}${text ? `: ${text}` : ""}`;
    });
    parts.push(`<chat>\n${lines.join("\n")}\n</chat>`);
  }
  if (input.mode === "idle") {
    parts.push(
      "El chat está callado. Di algo por tu cuenta para animar el directo: comenta el juego, lanza un reto o una pregunta al chat.",
    );
  } else if (input.mode === "summary") {
    parts.push(
      "El chat va muy rápido. Reacciona al ambiente general y nombra como mucho a dos usuarios. Di ahora tu intervención en voz alta.",
    );
  } else {
    parts.push("Di ahora tu intervención en voz alta respondiendo a estos mensajes.");
  }
  return parts.join("\n\n");
}

/** Error con un mensaje que el panel puede mostrar tal cual. */
export class BrainError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

export class ClaudeBrain implements Brain {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly persona: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  }

  async *reply(input: BrainInput, signal: AbortSignal): AsyncIterable<string> {
    // Haiku permite desactivar el razonamiento, que es lo más rápido para frases cortas.
    // Los demás modelos lo rechazan, así que ahí solo se baja el esfuerzo.
    const isHaiku = this.model.includes("haiku");
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: isHaiku ? 400 : 2000,
          ...(isHaiku ? { thinking: { type: "disabled" as const } } : {}),
          output_config: { effort: "low" },
          system: [{ type: "text", text: this.persona, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildUserTurn(input) }],
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof Anthropic.AuthenticationError) {
        throw new BrainError("La clave de Anthropic no es válida.", true);
      }
      if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
        throw new BrainError(`El modelo "${this.model}" no está disponible para esta clave.`, true);
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new BrainError("Límite de peticiones de Anthropic alcanzado; reintento en unos segundos.", false);
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new BrainError("Sin conexión con Anthropic; reintento en unos segundos.", false);
      }
      if (err instanceof Anthropic.APIError) {
        throw new BrainError(`Error de Anthropic (${err.status ?? "?"}): ${err.message}`, false);
      }
      throw err;
    }
  }
}

const DEMO_LINES = [
  "Qué más pues, {user}, bienvenido a la organización. Aquí el que entra ya es de la familia.",
  "Hágale pues, {user}, buena pregunta. Eso lo resolvemos ahora mismo en las calles, mire y aprenda.",
  "A lo bien, {user}, usted sí sabe. Muchachos, tomen nota de cómo habla un socio de verdad.",
  "Tranquilo, {user}, que el patrón lo tiene todo bajo control. Plata o plomo, pero en la consola, mijo.",
];
const DEMO_IDLE = [
  "Muy callados los veo, parceros. Cuéntenme, ¿qué misión hacemos ahora?",
  "Mientras el muchacho maneja, yo les pregunto: ¿quién se apunta a la organización hoy?",
];

/** Cerebro de ejemplo para probar la app sin claves (modo demo y tests). */
export class DemoBrain implements Brain {
  private n = 0;

  async *reply(input: BrainInput, signal: AbortSignal): AsyncIterable<string> {
    const pool = input.mode === "idle" ? DEMO_IDLE : DEMO_LINES;
    const user = input.messages[0]?.user ?? "parcero";
    const line = pool[this.n++ % pool.length].replaceAll("{user}", user);
    for (const word of line.split(" ")) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 15));
      yield word + " ";
    }
  }
}
