/** Indicaciones de interpretación que entienden los modelos expresivos de ElevenLabs (v3 y v4). */
export const VOICE_TAGS = [
  "[relaxed]",
  "[warm]",
  "[chuckles]",
  "[laughs softly]",
  "[excited, raising voice]",
  "[serious, low voice]",
  "[slowly]",
  "[pause]",
  "[long pause]",
];

/** Quita las indicaciones entre corchetes, para subtítulos, registros y voces que no las entienden. */
export function stripTags(text: string): string {
  return text
    .replace(/\[[^\]\n]{1,60}\]/g, " ")
    .replace(/\s+([,.!?…;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
