// Panel de control de StreamBot.
const $ = (sel) => document.querySelector(sel);
const chatEl = $("#chat");
const logEl = $("#log");
const MAX_ROWS = 200;
const PLATFORM_NAMES = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", sim: "Simulado" };
const STATE_TEXT = { off: "apagado", connecting: "conectando", connected: "conectado", error: "error" };
const KIND_TEXT = { sub: "suscripción", gift: "regalo", follow: "nuevo seguidor", donation: "donación" };
const MODE_TEXT = { reply: "respuesta", summary: "resumen del chat", idle: "por su cuenta", narrate: "narrando la partida", manual: "manual" };
const CLIP_KIND = { replay: "Clip", recording: "Grabación", export: "Exportado", import: "Añadido" };
const MARKER_TEXT = { manual: "A mano", chat: "Desde el chat", spike: "Chat disparado" };

let state = null;
let formsFilled = false;
let selectedClip = null;
let lastBrand = "";
let lastClips = "";

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function toast(text, bad = false) {
  const box = $("#toast");
  box.textContent = text;
  box.className = bad ? "bad" : "";
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 4500);
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

function act(promise, okText) {
  return promise
    .then((data) => { if (okText) toast(typeof okText === "function" ? okText(data) : okText); return data; })
    .catch((err) => { toast(err.message, true); });
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- Pestañas ----
for (const tab of document.querySelectorAll("[role=tab]")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[role=tab]")) {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      $(`#tab-${other.dataset.tab}`).hidden = !on;
    }
    if (tab.dataset.tab !== "clips") $("#player").pause();
  });
}

// ---- Formularios de ajustes ----
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
    for (const field of form.elements) {
      if (!field.name) continue;
      const value = getPath(settings, field.name);
      if (field.type === "checkbox") field.checked = !!value;
      else if (Array.isArray(value)) field.value = value.join("\n");
      else field.value = value ?? "";
    }
  }
  updateQuota();
  updateEngines();
}

// Muestra solo los campos del motor elegido (nube o local) para el cerebro y la voz.
function updateEngines() {
  for (const select of document.querySelectorAll("[data-engine-for]")) {
    const kind = select.dataset.engineFor;
    // Otros selectores pueden pedir también los campos locales (p. ej. narrar clips en local).
    const alsoLocal = [...document.querySelectorAll(`[data-engine-also="${kind}"]`)].some((s) => s.value === "local");
    for (const group of document.querySelectorAll(`[data-engine^="${kind}:"]`)) {
      const engine = group.dataset.engine.slice(kind.length + 1);
      group.hidden = !(engine === select.value || (engine === "local" && alsoLocal));
    }
  }
}
for (const select of document.querySelectorAll("[data-engine-for], [data-engine-also]")) select.addEventListener("change", updateEngines);

function readForm(form) {
  const patch = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    let value;
    if (field.type === "checkbox") value = field.checked;
    else if (field.type === "number") value = Number(field.value);
    else if (field.tagName === "TEXTAREA") value = field.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else value = field.value.trim();
    if (field.type === "number" && !Number.isFinite(value)) continue;
    setPath(patch, field.name, value);
  }
  return patch;
}

function updateQuota() {
  const seconds = Number(document.querySelector('[name="youtube.pollSeconds"]').value) || 6;
  const hours = 10000 / 5 / (3600 / seconds);
  $("#quota").textContent = `Con la cuota gratuita de YouTube alcanza para unas ${hours.toFixed(1)} h de directo al día.`;
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
  for (const field of event.target.elements) if (field.name && field.value) patch[field.name] = field.value.trim();
  if (!Object.keys(patch).length) return toast("No has escrito ninguna clave.", true);
  act(api("secrets", patch).then(() => event.target.reset()), "Claves guardadas.");
});

// ---- Render ----
function render() {
  if (!state) return;
  if (!formsFilled) {
    fillForms(state.settings);
    formsFilled = true;
  }
  renderPills();
  renderLive();
  renderClips();
  renderBrand();
  renderSettings();
}

function renderPills() {
  const pills = $("#pills");
  pills.replaceChildren();
  const pill = (label, cls, title) => pills.append(el("span", { className: `pill ${cls}`, textContent: label, title: title ?? "" }));
  for (const [platform, status] of Object.entries(state.connectors)) {
    if (platform === "sim" ? !state.simulator : status.state === "off") continue;
    const detail = status.state === "error" && status.detail ? ` · ${status.detail}` : "";
    pill(`${PLATFORM_NAMES[platform]}: ${STATE_TEXT[status.state]}${detail}`, status.state, status.detail);
  }
  pill(`Overlay: ${state.overlays ? "conectado" : "sin conectar"}`, state.overlays ? "connected" : "off");
  const obs = state.obs;
  pill(`OBS: ${obs.connected ? (obs.streaming ? "emitiendo" : "conectado") : "sin conectar"}`, obs.connected ? "connected" : "off", obs.detail);
}

function renderLive() {
  const { agent: a, obs } = state;
  const solo = state.settings.session.mode === "solo";
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-checked", String(button.dataset.mode === state.settings.session.mode));
  }
  $("#mode-hint").textContent = solo
    ? `Sin directo ni chat: el personaje mira la partida y la narra tras ${state.settings.solo.narrateEverySeconds} s de silencio. Su voz queda grabada en OBS con el juego.`
    : "Responde al chat del directo.";
  $("#col-chat").classList.toggle("solo-mode", solo);

  const status = $("#agent-status");
  let text;
  let cls = "";
  if (a.problem) { text = a.problem; cls = "bad"; }
  else if (a.brain === "none") { text = "Falta la clave de Anthropic (Ajustes → Claves) o elegir un modelo local. Hasta entonces el personaje solo dice lo que escribas."; cls = "bad"; }
  else if (!state.settings.agent.enabled || a.paused) text = solo ? "En pausa: el personaje no narra." : "En pausa: el personaje no responde al chat.";
  else if (a.speaking) { text = "Hablando…"; cls = "live"; }
  else if (solo) { text = "Mirando la partida para narrarla"; cls = "live"; }
  else { text = `Escuchando el chat · ${a.pending} en espera`; cls = "live"; }
  if (a.brain === "demo") text += " (respuestas de ejemplo)";
  if (a.brain === "local") text += " · Cerebro local";
  if (a.voice === "local") text += " · Voz local";
  if (a.voice === "silent" && a.brain !== "none") text += " · Sin voz: solo subtítulos (faltan la clave de ElevenLabs y el ID de voz, o elegir voz local).";
  status.textContent = text;
  status.className = cls;

  const pause = $("#pause");
  pause.textContent = a.paused ? "Reanudar" : "Pausar";
  pause.setAttribute("aria-pressed", String(a.paused));
  $("#sim").checked = state.simulator;

  $("#clip-hint").textContent = obs.connected && obs.replay
    ? "Guarda los últimos segundos de la partida."
    : "Ahora solo marca el momento. Para guardar el vídeo, conecta OBS y enciende el búfer de repetición.";

  const toggles = { stream: obs.streaming, record: obs.recording, replay: obs.replay };
  for (const button of document.querySelectorAll("[data-toggle]")) {
    const on = toggles[button.dataset.toggle];
    button.disabled = !obs.connected;
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("on", on);
  }
  $("#obs-live-hint").textContent = obs.connected ? "" : "OBS sin conectar. Conéctalo en Ajustes → OBS.";

  const scenes = $("#scenes");
  scenes.replaceChildren(...obs.scenes.map((name) => {
    const button = el("button", { type: "button", textContent: name, className: name === obs.scene ? "current" : "" });
    if (name === obs.scene) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => act(api("obs", { action: "scene", name })));
    return button;
  }));
  if (!obs.scenes.length) scenes.append(el("span", { className: "hint", textContent: "Las escenas de OBS aparecerán aquí." }));

  renderStats(state.stats);
}

function renderStats(s) {
  const rows = [
    ["Tiempo", `${s.minutes} min`],
    ["Mensajes", s.messages],
    ["Mensajes/min (pico)", `${s.perMinute} (${s.peakPerMinute})`],
    ["Personas en el chat", s.chatters],
    ["Suscripciones · regalos", `${s.events.sub} · ${s.events.gift}`],
    ["Donaciones · seguidores", `${s.events.donation} · ${s.events.follow}`],
    ["Intervenciones del personaje", s.utterances],
    ["Créditos de voz (aprox.)", state?.agent.voice === "local" ? "0 (voz local)" : s.voiceCredits.toLocaleString("es")],
  ];
  $("#stats").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: String(v) })]));
  $("#top").replaceChildren(...s.top.map((t) => el("li", {}, t.user, el("span", { textContent: String(t.count) }))));
}

function renderClips() {
  const { clips } = state;
  const key = JSON.stringify([clips.items, clips.markers, selectedClip]);
  if (key !== lastClips) {
    lastClips = key;
    $("#markers-empty").hidden = clips.markers.length > 0;
    $("#markers").replaceChildren(...clips.markers.map((m) => {
      const label = `${new Date(m.ts).toLocaleTimeString()} · ${MARKER_TEXT[m.reason]}`;
      if (!m.clipId) {
        return el("li", { className: "plain" }, el("span", {}, el("span", { className: "title", textContent: m.label }), el("span", { className: "sub", textContent: `${label} · sin vídeo` })));
      }
      const button = el("button", { type: "button", className: "item" }, el("span", { className: "title", textContent: m.label }), el("span", { className: "sub", textContent: label }));
      button.addEventListener("click", () => selectClip(m.clipId));
      return el("li", {}, button);
    }));
    $("#clips-empty").hidden = clips.items.length > 0;
    $("#clips").replaceChildren(...clips.items.map((item) => {
      const sub = `${CLIP_KIND[item.kind]} · ${new Date(item.createdAt).toLocaleString()}${item.missing ? " · archivo no encontrado" : ""}`;
      const button = el("button", { type: "button", className: "item" }, el("span", { className: "title", textContent: item.copy?.title || item.name }), el("span", { className: "sub", textContent: sub }));
      if (item.id === selectedClip) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => selectClip(item.id));
      return el("li", {}, button);
    }));
    if (selectedClip && !clips.items.some((i) => i.id === selectedClip)) selectClip(null);
  }
  const exporting = clips.exporting !== null;
  $("#export").disabled = exporting || !clips.ffmpeg;
  $("#narrate").disabled = exporting || !clips.ffmpeg;
  $("#cancel-export").hidden = !exporting;
  if (!exporting) $("#progress").hidden = true;
  if (!clips.ffmpeg) $("#export-status").textContent = 'Para exportar hace falta ffmpeg. En el Mac: abre Terminal y ejecuta "brew install ffmpeg".';
}

function selectClip(id) {
  selectedClip = id;
  const item = id ? state.clips.items.find((i) => i.id === id) : null;
  $("#editor-empty").hidden = !!item;
  $("#editor-body").hidden = !item;
  const player = $("#player");
  if (!item) {
    player.removeAttribute("src");
    player.load();
    lastClips = "";
    renderClips();
    return;
  }
  $("#editor-name").textContent = item.name;
  $("#player-hint").hidden = true;
  player.src = `/media/${item.id}`;
  $("#in").value = 0;
  $("#out").value = 0;
  $("#note").value = item.note ?? "";
  $("#export-status").textContent = "";
  showCopy(item.copy);
  updateLength();
  lastClips = "";
  renderClips();
  for (const tab of document.querySelectorAll("[role=tab]")) if (tab.dataset.tab === "clips" && tab.getAttribute("aria-selected") !== "true") tab.click();
}

function showCopy(copy) {
  $("#copy").hidden = !copy;
  if (!copy) return;
  $("#copy-title").value = copy.title;
  $("#copy-desc").value = copy.description;
  $("#copy-tags").value = copy.hashtags.map((h) => `#${h}`).join(" ");
}

function updateLength() {
  const length = Number($("#out").value) - Number($("#in").value);
  $("#length").textContent = length > 0 ? `Duración: ${clock(length)}` : "";
}

function renderBrand() {
  const { brand, port } = state;
  const key = JSON.stringify([brand.slots, port]);
  if (key === lastBrand) return;
  lastBrand = key;

  const base = `http://127.0.0.1:${port}/overlay/`;
  const urls = [
    ["Directo: chat, subtítulos, voz y alertas", base],
    ["Empezamos pronto (cuenta atrás de 5 min)", `${base}scene.html?tipo=starting&min=5`],
    ["Vuelvo enseguida", `${base}scene.html?tipo=brb`],
    ["Fin del directo", `${base}scene.html?tipo=ending`],
  ];
  $("#urls").replaceChildren(...urls.flatMap(([label, url]) => {
    const input = el("input", { readOnly: true, value: url });
    input.setAttribute("aria-label", label);
    const copy = el("button", { type: "button", textContent: "Copiar" });
    copy.addEventListener("click", () => copyText(url));
    return [el("dt", { textContent: label }), el("dd", {}, el("span", { className: "row" }, input, copy))];
  }));

  $("#slots").replaceChildren(...Object.entries(brand.meta).map(([slot, meta]) => {
    const asset = brand.slots[slot];
    const preview = el("div", { className: "preview" });
    if (!asset) preview.textContent = "Vacío";
    else if (asset.kind === "image") preview.append(el("img", { src: asset.url, alt: "" }));
    else if (asset.kind === "video") preview.append(el("video", { src: asset.url, muted: true, loop: true, autoplay: true }));
    else preview.append(el("audio", { src: asset.url, controls: true }));

    const input = el("input", { type: "file", hidden: true });
    input.addEventListener("change", () => { if (input.files[0]) upload(slot, input.files[0]); });
    const pick = el("button", { type: "button", textContent: asset ? "Cambiar" : "Subir archivo" });
    pick.addEventListener("click", () => input.click());
    const buttons = el("div", { className: "row" }, pick, input);
    if (asset && !asset.bundled) {
      const remove = el("button", { type: "button", className: "danger", textContent: "Quitar" });
      remove.addEventListener("click", () => act(api("brand/remove", { slot }), "Arte quitado."));
      buttons.append(remove);
    }

    const card = el("div", { className: "slot" }, el("h4", { textContent: meta.label }), preview, el("p", { className: "hint", textContent: meta.hint }), buttons);
    card.addEventListener("dragover", (event) => { event.preventDefault(); card.classList.add("over"); });
    card.addEventListener("dragleave", () => card.classList.remove("over"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("over");
      if (event.dataTransfer.files[0]) upload(slot, event.dataTransfer.files[0]);
    });
    return card;
  }));
}

function upload(slot, file) {
  const query = new URLSearchParams({ slot, name: file.name });
  act(
    fetch(`/api/brand/upload?${query}`, { method: "POST", body: file }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo subir el archivo.");
    }),
    "Arte guardado.",
  );
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast("Copiado."), () => toast("No se pudo copiar; selecciónalo a mano.", true));
}

function renderSettings() {
  for (const flag of document.querySelectorAll(".flag")) {
    const set = state.secrets[flag.dataset.flag];
    flag.textContent = set ? "guardada" : "sin poner";
    flag.classList.toggle("set", set);
  }
  $("#obs-detail").textContent = state.obs.connected ? "Conectado con OBS." : (state.obs.detail || "");
  $("#clips-folder").placeholder = state.clips.folder;
  $("#ffmpeg-status").textContent = state.clips.ffmpeg
    ? "ffmpeg encontrado: se pueden exportar clips."
    : 'ffmpeg no encontrado. En el Mac: "brew install ffmpeg".';
}

// ---- Chat y registro ----
function addRow(list, li) {
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(li);
  while (list.children.length > MAX_ROWS) list.firstElementChild.remove();
  if (stick) list.scrollTop = list.scrollHeight;
}

function addChat({ msg, blocked }) {
  $("#chat-empty").hidden = true;
  const li = el("li", { className: `${msg.platform}${blocked ? " blocked" : ""}${msg.kind !== "chat" ? " event" : ""}` });
  li.append(el("span", { className: "user", textContent: msg.user }));
  const parts = [];
  if (msg.kind !== "chat") parts.push(`[${KIND_TEXT[msg.kind]}${msg.detail ? `: ${msg.detail}` : ""}]`);
  if (msg.text) parts.push(msg.text);
  li.append(parts.join(" "));
  const tags = [PLATFORM_NAMES[msg.platform]];
  if (msg.note) tags.push(msg.note);
  if (blocked) tags.push(`ignorado (${blocked})`);
  li.append(el("span", { className: "tag", textContent: tags.join(" · ") }));
  addRow(chatEl, li);
}

function addLog(entry) {
  $("#log-empty").hidden = true;
  const who = entry.replyTo.length ? ` a ${entry.replyTo.map((r) => r.user).join(", ")}` : "";
  const right = el("span", { textContent: entry.latencyMs == null ? "" : `${(entry.latencyMs / 1000).toFixed(1)} s`, title: "Tiempo hasta el primer audio" });
  const li = el("li", {}, el("div", { className: "meta" }, el("span", { textContent: `${new Date(entry.ts).toLocaleTimeString()} · ${MODE_TEXT[entry.mode]}${who}` }), right));
  if (entry.text) li.append(entry.text);
  if (entry.error) li.append(el("div", { className: "err", textContent: entry.error }));
  addRow(logEl, li);
}

function onExport(msg) {
  const status = $("#export-status");
  const progress = $("#progress");
  if (msg.state === "running") {
    progress.hidden = false;
    progress.value = msg.progress;
    const verb = msg.kind === "narrate" ? msg.stage || "Narrando" : "Exportando";
    status.textContent = `${verb}… ${Math.round(msg.progress * 100)} %`;
  } else if (msg.state === "done") {
    progress.hidden = true;
    const what = msg.kind === "narrate" ? "Clip narrado" : "Clip exportado";
    status.textContent = `${what} en ${msg.file}`;
    toast(`${what}.`);
    // Se abre el resultado en el editor para revisarlo.
    if (msg.kind === "narrate" && msg.newId) setTimeout(() => selectClip(msg.newId), 300);
  } else {
    progress.hidden = true;
    status.textContent = msg.error;
    toast(msg.error, true);
  }
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
    else if (msg.type === "stats") { if (state) { state.stats = msg.stats; renderStats(msg.stats); } }
    else if (msg.type === "chat") addChat(msg);
    else if (msg.type === "log") addLog(msg.entry);
    else if (msg.type === "export") onExport(msg);
    else if (msg.type === "utterance_start") { $("#now-saying").textContent = ""; $("#now-saying").hidden = false; }
    else if (msg.type === "subtitle") $("#now-saying").textContent += ($("#now-saying").textContent ? " " : "") + msg.text;
    else if (msg.type === "utterance_end" || msg.type === "utterance_stop") $("#now-saying").hidden = true;
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

// ---- Acciones ----
$("#sim").addEventListener("change", (event) => act(api("simulator", { on: event.target.checked })));
$("#pause").addEventListener("click", () => act(api("control", { action: state?.agent.paused ? "resume" : "pause" })));
$("#skip").addEventListener("click", () => act(api("control", { action: "skip" })));
for (const button of document.querySelectorAll("[data-script]")) {
  button.addEventListener("click", () => act(api("script", { kind: button.dataset.script })));
}
$("#say").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#say-text");
  if (!input.value.trim()) return;
  act(api("say", { text: input.value }).then(() => { input.value = ""; }));
});
$("#clip-now").addEventListener("click", () => act(api("clip"), (data) => data.message));
$("#obs-connect").addEventListener("click", () => act(api("obs", { action: "connect" }), "Conectado con OBS."));

const TOGGLE_ACTIONS = { stream: ["start", "stop"], record: ["record-start", "record-stop"], replay: ["replay-start", "replay-stop"] };
for (const button of document.querySelectorAll("[data-toggle]")) {
  button.addEventListener("click", () => {
    const on = button.getAttribute("aria-pressed") === "true";
    const kind = button.dataset.toggle;
    if (kind === "stream" && on && !confirm("¿Parar la emisión en OBS?")) return;
    act(api("obs", { action: TOGGLE_ACTIONS[kind][on ? 1 : 0] }));
  });
}

// Editor de clips
const player = $("#player");
player.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(player.duration)) {
    $("#out").value = player.duration.toFixed(1);
    $("#in").max = $("#out").max = player.duration.toFixed(1);
    updateLength();
  }
});
player.addEventListener("error", () => { if (player.getAttribute("src")) $("#player-hint").hidden = false; });
$("#set-in").addEventListener("click", () => { $("#in").value = player.currentTime.toFixed(1); updateLength(); });
$("#set-out").addEventListener("click", () => { $("#out").value = player.currentTime.toFixed(1); updateLength(); });
$("#in").addEventListener("input", updateLength);
$("#out").addEventListener("input", updateLength);
$("#preview").addEventListener("click", () => {
  const end = Number($("#out").value);
  player.currentTime = Number($("#in").value) || 0;
  player.play().catch(() => {});
  const stop = () => {
    if (player.currentTime >= end || player.paused) {
      player.pause();
      player.removeEventListener("timeupdate", stop);
    }
  };
  player.addEventListener("timeupdate", stop);
});
$("#format").addEventListener("change", (event) => { $("#crop-wrap").hidden = event.target.value !== "vertical-crop"; });
$("#export").addEventListener("click", () => {
  if (!selectedClip) return;
  act(api("clips/export", {
    id: selectedClip,
    start: Number($("#in").value),
    end: Number($("#out").value),
    format: $("#format").value,
    cropX: Number($("#crop").value) / 100,
    watermark: $("#watermark").checked,
  }));
});
$("#cancel-export").addEventListener("click", () => act(api("clips/cancel")));
$("#narrate").addEventListener("click", () => {
  if (!selectedClip) return;
  act(api("clips/narrate", {
    id: selectedClip,
    start: Number($("#in").value),
    end: Number($("#out").value),
    note: $("#note").value,
    subtitles: $("#narrate-subs").checked,
  }));
});
for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-checked") === "true") return;
    act(api("settings", { session: { mode: button.dataset.mode } }), button.dataset.mode === "solo" ? "Modo Jugar solo." : "Modo Directo.");
  });
}
$("#reveal").addEventListener("click", () => act(api("clips/reveal", { id: selectedClip }), (data) => (data.file ? `Está en ${data.file}` : "")));
$("#remove-clip").addEventListener("click", () => {
  if (!confirm("¿Quitar este vídeo de la lista? El archivo no se borra del disco.")) return;
  act(api("clips/remove", { id: selectedClip }));
});
$("#note").addEventListener("change", (event) => { if (selectedClip) act(api("clips/note", { id: selectedClip, note: event.target.value })); });
$("#make-copy").addEventListener("click", (event) => {
  if (!selectedClip) return;
  const button = event.target;
  button.disabled = true;
  button.textContent = "Generando…";
  act(api("clips/copy", { id: selectedClip, note: $("#note").value }).then(showCopy)).finally(() => {
    button.disabled = false;
    button.textContent = "Generar título y hashtags";
  });
});
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", () => copyText($(`#${button.dataset.copy}`).value));
}
$("#import").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.target.elements.path;
  act(api("clips/import", { path: input.value }).then((item) => { input.value = ""; selectedClip = item.id; setTimeout(() => selectClip(item.id), 100); }), "Vídeo añadido.");
});

connect();
