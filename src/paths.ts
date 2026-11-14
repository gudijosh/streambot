import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raíz del proyecto, tanto ejecutando desde src/ (tsx) como desde dist/ (compilado). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const PERSONA_FILE = path.join(ROOT, "persona", "personaje.md");
