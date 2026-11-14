// Ventana de escritorio de StreamBot: arranca el núcleo y muestra el panel de control.
const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let core = null;

async function createWindow() {
  const { StreamBotApp } = await import(pathToFileURL(path.join(__dirname, "..", "dist", "app.js")).href);
  core = new StreamBotApp({ port: Number(process.env.STREAMBOT_PORT) || 4747, demo: process.env.STREAMBOT_DEMO === "1" });
  const port = await core.start();

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "StreamBot",
    backgroundColor: "#12100e",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Los enlaces externos se abren en el navegador, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${port}/panel/`);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", async () => {
  if (core) await core.stop().catch(() => {});
  app.quit();
});
