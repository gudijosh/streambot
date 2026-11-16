/** Guiones fijos del personaje que se lanzan con un botón (intro, despedida, pausa). */
export type ScriptKind = "intros" | "outros" | "brb";

export function isScriptKind(value: unknown): value is ScriptKind {
  return value === "intros" || value === "outros" || value === "brb";
}

/** Elige un guion al azar sin repetir el último dicho, salvo que solo haya uno. */
export function pickScript(list: string[], last: string | undefined, random = Math.random): string | null {
  const options = list.map((s) => s.trim()).filter(Boolean);
  if (!options.length) return null;
  const pool = options.length > 1 ? options.filter((s) => s !== last) : options;
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}
