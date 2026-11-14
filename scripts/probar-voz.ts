// Mide la voz local en este ordenador: cuánto tarda en empezar a sonar y cuántas
// veces más rápido que el tiempo real genera. Uso:
//   npm run probar-voz
//   npm run probar-voz -- --model mlx-community/chatterbox-multilingual-v3 --voice "" --lang es --ref ~/voz.wav
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/config.js";
import { LocalVoice } from "../src/voice/local.js";

const PHRASES = [
  "Qué más pues, parceros, bienvenidos a la organización.",
  "Hágale pues, mijo, que hoy la calle está caliente y el patrón no perdona.",
  "A lo bien, ese carro lo vamos a necesitar para salir de aquí antes de que llegue la policía.",
  "Gracias por la suscripción, socio. Aquí el que apoya ya es de la familia.",
];

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : (args[at + 1] ?? "");
};

const saved = new ConfigStore().settings.voice;
const config = {
  ...saved,
  localUrl: arg("url") ?? saved.localUrl,
  localModel: arg("model") ?? saved.localModel,
  localVoice: arg("voice") ?? saved.localVoice,
  localLang: arg("lang") ?? saved.localLang,
  localRefAudio: (arg("ref") ?? saved.localRefAudio).replace(/^~(?=\/)/, os.homedir()),
  localRefText: arg("ref-text") ?? saved.localRefText,
};
const voice = new LocalVoice(config);

console.log(`Servidor: ${config.localUrl}`);
console.log(`Modelo:   ${config.localModel}`);
console.log(`Voz:      ${config.localVoice || "(sin voz predefinida)"} · idioma ${config.localLang || "(por defecto)"}`);
if (config.localRefAudio) console.log(`Clonando: ${config.localRefAudio}`);

const voices = await voice.listVoices();
if (voices.length) console.log(`Voces del modelo: ${voices.join(", ")}`);

const signal = new AbortController().signal;
const pieces: Buffer[] = [];
const rows: { ms: number; seconds: number }[] = [];
try {
  process.stdout.write("\nCargando el modelo (la primera vez tarda más)… ");
  const warm = Date.now();
  await voice.synthesize("Probando.", signal);
  console.log(`${((Date.now() - warm) / 1000).toFixed(1)} s`);

  for (const phrase of PHRASES) {
    const start = Date.now();
    const pcm = await voice.synthesize(phrase, signal);
    const ms = Date.now() - start;
    const seconds = pcm.length / 2 / voice.sampleRate;
    rows.push({ ms, seconds });
    pieces.push(pcm);
    console.log(`  ${String(ms).padStart(5)} ms para ${seconds.toFixed(1)} s de audio (${(seconds / (ms / 1000)).toFixed(1)}x)  «${phrase.slice(0, 40)}…»`);
  }
} catch (err) {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
}

const totalMs = rows.reduce((sum, r) => sum + r.ms, 0);
const totalSeconds = rows.reduce((sum, r) => sum + r.seconds, 0);
const speed = totalSeconds / (totalMs / 1000);
const wait = Math.round(totalMs / rows.length);
console.log(`\nEspera media antes de que suene una frase: ${wait} ms`);
console.log(`Velocidad: ${speed.toFixed(1)} veces el tiempo real`);
console.log(
  speed >= 2 && wait < 1500
    ? "Veredicto: va sobrado para el directo."
    : speed >= 1.1
      ? "Veredicto: sirve, pero con poco margen. Pruébalo con OBS emitiendo antes de fiarte."
      : "Veredicto: demasiado lento para el directo; el personaje se quedaría a trompicones. Usa un modelo más pequeño.",
);

// Se guarda una muestra para escuchar cómo suena.
const pcm = Buffer.concat(pieces);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(voice.sampleRate, 24);
header.writeUInt32LE(voice.sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const out = path.resolve("prueba-voz.wav");
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`\nMuestra guardada en ${out}`);
