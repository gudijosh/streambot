// Panel de control de StreamBot.
const $ = (sel) => document.querySelector(sel);
const chatEl = $("#chat");
const logEl = $("#log");
const MAX_ROWS = 200;
const PLATFORM_NAMES = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", sim: "Simulado" };
const STATE_TEXT = { off: "apagado", connecting: "conectando", connected: "conectado", error: "error" };
const KIND_TEXT = { sub: "suscripción", gift: "regalo", follow: "nuevo seguidor", donation: "donación" };
const MODE_TEXT = { reply: "respuesta", summary: "resumen del chat", idle: "por su cuenta", manual: "manual" };

let state = null;
let formsFilled = false;

function toast(text, bad = false) {
  const el = $("#toast");
  el.textContent = text;
  el.className = bad ? "bad" : "";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 4000);
}

async function api(route, body) {
  const res = await fetch(`/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}

function fillForms(settings) {
  for (const form of document.querySelectorAll("form[data-settings]")) {
    for (const el of form.elements) {
      if (!el.name) continue;
      const value = getPath(settings, el.name);
      if (el.type === "checkbox") el.checked = !!value;
      else if (Array.isArray(value)) el.value = value.join("\n");
      else el.value = value ?? "";
    }
  }
  updateQuota();
}

function readForm(form) {
  const patch = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    let value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "number") value = Number(el.value);
    else if (el.tagName === "TEXTAREA") value = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else value = el.value.trim();
    if (el.type === "number" && !Number.isFinite(value)) continue;
    setPath(patch, el.name, value);
  }
  return patch;
}

function updateQuota() {
  const seconds = Number(document.querySelector('[name="youtube.pollSeconds"]').value) || 6;
  const hours = 10000 / 5 / (3600 / seconds);
  $("#quota").textContent = `Con la cuota gratuita de YouTube alcanza para unas ${hours.toFixed(1)} h de directo al día.`;
}

function render() {
  if (!state) return;
  if (!formsFilled) {
    fillForms(state.settings);
    formsFilled = true;
  }

  const pills = $("#pills");
  pills.replaceChildren();
  const pill = (label, cls, title) => {
    const el = document.createElement("span");
    el.className = `pill ${cls}`;
    el.textContent = label;
    if (title) el.title = title;
    pills.append(el);
  };
  for (const [platform, status] of Object.entries(state.connectors)) {
    if (platform === "sim" && !state.simulator) continue;
    const detail = status.detail ? ` · ${status.detail}` : "";
    pill(`${PLATFORM_NAMES[platform]}: ${STATE_TEXT[status.state]}${status.state === "error" ? detail : ""}`, status.state, status.detail);
  }
  pill(`Overlay: ${state.overlays ? "conectado" : "sin conectar"}`, state.overlays ? "connected" : "off");
  pill(
    `OBS: ${state.obs.connected ? (state.obs.streaming ? "emitiendo" : "conectado") : "sin conectar"}`,
    state.obs.connected ? "connected" : "off",
  );

  for (const el of document.querySelectorAll(".flag")) {
    const set = state.secrets[el.dataset.flag];
    el.textContent = set ? "guardada" : "sin poner";
    el.classList.toggle("set", set);
  }

  $("#sim").checked = state.simulator;
  $("#obs-detail").textContent = state.obs.detail || "";
  $("#overlay-url").value = `http://127.0.0.1:${state.port}/overlay/`;

  const a = state.agent;
  const status = $("#agent-status");
  let text;
  let cls = "";
  if (a.problem) { text = a.problem; cls = "bad"; }
  else if (a.brain === "none") { text = "Falta la clave de Anthropic (Ajustes → Claves). Hasta entonces el personaje solo dice lo que escribas."; cls = "bad"; }
  else if (!state.settings.agent.enabled || a.paused) text = "En pausa: el personaje no responde al chat.";
  else if (a.speaking) { text = "Hablando…"; cls = "live"; }
  else { text = `Escuchando el chat · ${a.pending} en espera`; cls = "live"; }
  if (a.brain === "demo") text += " (respuestas de ejemplo)";
  if (a.voice === "silent" && a.brain !== "none") text += " · Sin voz: solo subtítulos (faltan la clave de ElevenLabs o el ID de voz).";
  status.textContent = text;
  status.className = cls;

  const pause = $("#pause");
  pause.textContent = a.paused ? "Reanudar" : "Pausar";
  pause.setAttribute("aria-pressed", String(a.paused));
}

function addRow(list, li) {
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(li);
  while (list.children.length > MAX_ROWS) list.firstElementChild.remove();
  if (stick) list.scrollTop = list.scrollHeight;
}

function addChat({ msg, blocked }) {
  $("#chat-empty").hidden = true;
  const li = document.createElement("li");
  li.className = `${msg.platform}${blocked ? " blocked" : ""}${msg.kind !== "chat" ? " event" : ""}`;
  const user = document.createElement("span");
  user.className = "user";
  user.textContent = msg.user;
  li.append(user);
  const parts = [];
  if (msg.kind !== "chat") parts.push(`[${KIND_TEXT[msg.kind]}${msg.detail ? `: ${msg.detail}` : ""}]`);
  if (msg.text) parts.push(msg.text);
  li.append(parts.join(" "));
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = PLATFORM_NAMES[msg.platform] + (blocked ? ` · ignorado (${blocked})` : "");
  li.append(tag);
  addRow(chatEl, li);
}

function addLog(entry) {
  $("#log-empty").hidden = true;
  const li = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  const who = entry.replyTo.length ? ` a ${entry.replyTo.map((r) => r.user).join(", ")}` : "";
  const left = document.createElement("span");
  left.textContent = `${new Date(entry.ts).toLocaleTimeString()} · ${MODE_TEXT[entry.mode]}${who}`;
  const right = document.createElement("span");
  right.textContent = entry.latencyMs == null ? "" : `${(entry.latencyMs / 1000).toFixed(1)} s`;
  right.title = "Tiempo hasta el primer audio";
  meta.append(left, right);
  li.append(meta);
  if (entry.text) li.append(entry.text);
  if (entry.error) {
    const err = document.createElement("div");
    err.className = "err";
    err.textContent = entry.error;
    li.append(err);
  }
  addRow(logEl, li);
}

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=panel`);
  ws.onopen = () => {
    chatEl.replaceChildren();
    logEl.replaceChildren();
  };
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    const msg = JSON.parse(event.data);
    if (msg.type === "state") { state = msg.state; render(); }
    else if (msg.type === "chat") addChat(msg);
    else if (msg.type === "log") addLog(msg.entry);
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

function act(promise, okText) {
  promise.then(() => { if (okText) toast(okText); }).catch((err) => toast(err.message, true));
}

for (const form of document.querySelectorAll("form[data-settings]")) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    act(api("settings", readForm(form)), "Guardado.");
  });
}
document.querySelector('[name="youtube.pollSeconds"]').addEventListener("input", updateQuota);

$("#secrets").addEventListener("submit", (event) => {
  event.preventDefault();
  const patch = {};
  for (const el of event.target.elements) if (el.name && el.value) patch[el.name] = el.value.trim();
  if (!Object.keys(patch).length) return toast("No has escrito ninguna clave.", true);
  act(api("secrets", patch).then(() => event.target.reset()), "Claves guardadas.");
});

$("#sim").addEventListener("change", (event) => act(api("simulator", { on: event.target.checked })));
$("#pause").addEventListener("click", () => act(api("control", { action: state?.agent.paused ? "resume" : "pause" })));
$("#skip").addEventListener("click", () => act(api("control", { action: "skip" })));
$("#say").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#say-text");
  if (!input.value.trim()) return;
  act(api("say", { text: input.value }).then(() => { input.value = ""; }));
});
for (const button of document.querySelectorAll("[data-obs]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.obs;
    if (action === "stop" && !confirm("¿Parar la emisión en OBS?")) return;
    act(api("obs", { action }));
  });
}
$("#overlay-url").addEventListener("focus", (event) => event.target.select());

connect();
