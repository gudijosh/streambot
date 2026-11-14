// Overlay para OBS (fuente de navegador). Muestra el chat unificado y los subtítulos,
// y reproduce la voz del personaje para que OBS la mezcle con el juego.
// Parámetros: ?chat=0 oculta el chat, ?subs=0 oculta los subtítulos, ?audio=0 silencia.
const params = new URLSearchParams(location.search);
const showChat = params.get("chat") !== "0";
const showSubs = params.get("subs") !== "0";
const playAudio = params.get("audio") !== "0";

const chatEl = document.getElementById("chat");
const voiceEl = document.getElementById("voice");
const replyEl = document.getElementById("reply");
const nameEl = document.getElementById("name");
const subtitleEl = document.getElementById("subtitle");
const unlockEl = document.getElementById("unlock");

const MAX_CHAT = 8;
const CHAT_TTL_MS = 30000;
const EVENT_TEXT = { sub: "se ha suscrito", gift: "envía un regalo", follow: "sigue el canal", donation: "apoya el canal" };

let ws = null;
let audioCtx = null;
let current = null; // { id, sampleRate, nextTime, sources, ended, gotAudio, chars, carry }

function addChat(msg) {
  if (!showChat) return;
  const li = document.createElement("li");
  li.className = msg.platform + (msg.kind !== "chat" ? " event" : "");
  const user = document.createElement("span");
  user.className = "user";
  user.textContent = msg.user;
  li.append(user);
  const parts = [];
  if (msg.kind !== "chat") parts.push(EVENT_TEXT[msg.kind] + (msg.detail ? ` (${msg.detail})` : ""));
  if (msg.text) parts.push(msg.text);
  li.append(parts.join(" · "));
  chatEl.append(li);
  while (chatEl.children.length > MAX_CHAT) chatEl.firstElementChild.remove();
  setTimeout(() => {
    li.classList.add("out");
    setTimeout(() => li.remove(), 700);
  }, CHAT_TTL_MS);
}

function ensureAudio() {
  if (!playAudio) return null;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
    // En OBS el audio arranca solo; en un navegador normal hace falta un clic.
    setTimeout(() => { unlockEl.hidden = !audioCtx || audioCtx.state !== "suspended"; }, 300);
  }
  return audioCtx;
}
unlockEl.addEventListener("click", () => {
  audioCtx?.resume().then(() => { unlockEl.hidden = true; });
});

function startUtterance(msg) {
  stopUtterance();
  current = { id: msg.id, sampleRate: msg.sampleRate, nextTime: 0, sources: new Set(), ended: false, gotAudio: false, chars: 0, carry: null };
  if (showSubs) {
    nameEl.textContent = msg.name || "";
    subtitleEl.textContent = "";
    const first = msg.replyTo && msg.replyTo[0];
    replyEl.textContent = first ? `↩ ${first.user}${first.text ? `: ${first.text}` : ""}` : "";
    voiceEl.hidden = false;
  }
  ensureAudio();
}

function onSubtitle(msg) {
  if (!current || current.id !== msg.id) return;
  current.chars += msg.text.length;
  // El texto llega antes que el audio, así que se va acumulando la intervención completa.
  if (showSubs) subtitleEl.textContent += (subtitleEl.textContent ? " " : "") + msg.text;
}

function onAudio(buffer) {
  const ctx = ensureAudio();
  if (!current || !ctx) return;
  let bytes = new Uint8Array(buffer);
  if (current.carry !== null) {
    const joined = new Uint8Array(bytes.length + 1);
    joined[0] = current.carry;
    joined.set(bytes, 1);
    bytes = joined;
    current.carry = null;
  }
  if (bytes.length % 2) {
    current.carry = bytes[bytes.length - 1];
    bytes = bytes.subarray(0, bytes.length - 1);
  }
  if (!bytes.length) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;

  const audio = ctx.createBuffer(1, samples.length, current.sampleRate);
  audio.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(ctx.destination);
  const at = Math.max(ctx.currentTime + 0.06, current.nextTime);
  source.start(at);
  current.nextTime = at + audio.duration;
  current.gotAudio = true;
  const utterance = current;
  utterance.sources.add(source);
  source.onended = () => {
    utterance.sources.delete(source);
    maybeFinish(utterance);
  };
}

function endUtterance(msg) {
  if (!current || current.id !== msg.id) return;
  current.ended = true;
  if (current.gotAudio) maybeFinish(current);
  else {
    // Sin audio: los subtítulos se quedan un tiempo proporcional al texto.
    const utterance = current;
    setTimeout(() => finish(utterance), Math.max(1500, utterance.chars * 65));
  }
}

function maybeFinish(utterance) {
  if (utterance.ended && utterance.sources.size === 0) finish(utterance);
}

function finish(utterance) {
  if (current !== utterance) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "played", id: utterance.id }));
  current = null;
  setTimeout(() => { if (!current) voiceEl.hidden = true; }, 900);
}

function stopUtterance() {
  if (!current) return;
  for (const source of current.sources) {
    source.onended = null;
    try { source.stop(); } catch { /* ya había terminado */ }
  }
  current = null;
  voiceEl.hidden = true;
}

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws?role=overlay`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return onAudio(event.data);
    const msg = JSON.parse(event.data);
    if (msg.type === "chat") addChat(msg.msg);
    else if (msg.type === "utterance_start") startUtterance(msg);
    else if (msg.type === "subtitle") onSubtitle(msg);
    else if (msg.type === "utterance_end") endUtterance(msg);
    else if (msg.type === "utterance_stop") stopUtterance();
  };
  ws.onclose = () => {
    stopUtterance();
    setTimeout(connect, 1500);
  };
}
connect();
