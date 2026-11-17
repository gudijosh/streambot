// Ventana de escritorio de StreamBot: arranca el núcleo y muestra el panel de control.
const { app, BrowserWindow, globalShortcut, shell } = require("electron");
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

  // Atajos globales: funcionan aunque la ventana no esté en primer plano.
  globalShortcut.register("CommandOrControl+Shift+C", () => void core.clipNow("manual", "Atajo de teclado"));
  globalShortcut.register("CommandOrControl+Shift+P", () => core.togglePause());
  globalShortcut.register("CommandOrControl+Shift+S", () => core.skip());
}

// Si ya está abierto, volver a abrirlo solo trae la ventana al frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow);
}
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", async () => {
  if (core) await core.stop().catch(() => {});
  app.quit();
});
