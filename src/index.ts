import { StreamBotApp } from "./app.js";

const demo = process.env.STREAMBOT_DEMO === "1";
const app = new StreamBotApp({ demo, port: Number(process.env.STREAMBOT_PORT) || 4747 });

const port = await app.start();
console.log(`StreamBot en marcha${demo ? " (modo demo)" : ""}`);
console.log(`  Panel de control: http://127.0.0.1:${port}/panel/`);
console.log(`  Overlay para OBS: http://127.0.0.1:${port}/overlay/`);

const shutdown = () => void app.stop().finally(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
