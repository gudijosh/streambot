import type { ChatMessage, Connector, ConnectorContext, Platform } from "../types.js";

const USERS = ["juanchoGamer", "la_paisa_22", "xXTonyXx", "maria.fdz", "elparcero99", "NeonVice", "sofi_plays", "DonChepe"];
const LINES = [
  "qué más pues patrón",
  "saludos desde Medellín!",
  "¿cuándo robamos el banco?",
  "ese carro está brutal",
  "jajaja casi lo atrapa la policía",
  "primera vez que veo el directo, me quedo",
  "¿qué misión viene ahora?",
  "saluda a mi hermano Kevin",
  "plata o plomo jaja",
  "sube al helicóptero!!",
  "¿de dónde es usted patrón?",
  "ese outfit está duro",
];
const PLATFORMS: Platform[] = ["twitch", "youtube", "tiktok"];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

let seq = 0;

export function fakeMessage(now = Date.now()): ChatMessage {
  const roll = Math.random();
  const base = { id: `sim:${now}-${seq++}`, platform: pick(PLATFORMS), user: pick(USERS), ts: now };
  if (roll < 0.05) return { ...base, text: "", kind: "sub", detail: "nueva suscripción" };
  if (roll < 0.09) return { ...base, text: "", kind: "follow" };
  if (roll < 0.12) return { ...base, text: "tome para la gasolina", kind: "donation", detail: "200 bits" };
  return { ...base, text: pick(LINES), kind: "chat" };
}

/** Chat de mentira para probar la app sin estar en directo. */
export class SimulatorConnector implements Connector {
  readonly platform = "sim" as const;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: ConnectorContext,
    private readonly everyMs = 2500,
  ) {}

  async start(): Promise<void> {
    this.ctx.onStatus({ state: "connected", detail: "chat simulado" });
    const tick = () => {
      this.ctx.onMessage(fakeMessage());
      this.timer = setTimeout(tick, this.everyMs * (0.4 + Math.random() * 1.2));
    };
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ctx.onStatus({ state: "off" });
  }
}
