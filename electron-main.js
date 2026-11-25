const { app, BrowserWindow, ipcMain, screen, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { LocalShowEngine, createRequestId } = require("./js/show-engine.js");
const {
  chooseRatingPhrase,
  generateRatingScore,
  isRatingScore,
} = require("./js/score-core.js");

const SHOWROOM_SIZE = { width: 300, height: 500 };
const SHOW_PAD_SIZE = { width: 540, height: 620 };
const SCORE_PREFERRED_SIZE = { width: 1100, height: 700 };
const SCORE_REVEAL_MIN_HOLD_MS = 8_000;
const SCORE_REVEAL_MAX_HOLD_MS = 12_000;
let showroomWindow;
let showPadWindow;
let scoreWindow;
let audioWindow;
let queuedScoreResult;
let scoreSequenceTimer;
let scoreSequenceActive = false;
let scoreCloseInProgress = false;
let scoreRevealStartedAt;
let applicationShutdownInProgress = false;
const padActions = new Map();
let showPadReady = false;
const queuedPadTriggers = [];
const midiProfiles = loadMidiProfiles();

function loadMidiProfiles() {
  const directory = path.join(__dirname, "modules", "show-pad", "devices");
  try {
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const profile = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
        const pattern = profile.profileId === "m-vave-smc-pad-pocket"
          ? "smc[\\s-]*pad[\\s-]*pocket"
          : String(profile.match?.nameRegex || "").replace(/^\(\?i\)/, "");
        return { ...profile, _namePattern: pattern ? new RegExp(pattern, "i") : null };
      })
      .sort((a, b) => Number(/pocket/i.test(b.profileId)) - Number(/pocket/i.test(a.profileId)));
  } catch (error) {
    console.error("SHOW MIDI: no se pudieron cargar los perfiles", error);
    return [];
  }
}

function setPadActions(items, { persist = false } = {}) {
  padActions.clear();
  if (Array.isArray(items)) {
    for (const item of items) {
      const page = Number(item?.page);
      const padId = Number(item?.padId);
      const action = item?.action;
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(padId) || padId < 1 || padId > 16) continue;
      if (!["fx", "score", "score10"].includes(action)) continue;
      padActions.set(`${page}:${padId}`, action);
    }
  }
  if (persist) {
    try {
      const file = path.join(app.getPath("userData"), "show-pad-actions.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...padActions].map(([key, action]) => {
        const [page, padId] = key.split(":").map(Number);
        return { page, padId, action };
      }), null, 2));
    } catch (error) {
      console.warn("SHOW PAD: no se pudieron guardar las acciones locales.", error);
    }
  }
}

function loadInitialPadActions() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "modules", "show-pad", "show-pad-config.json"), "utf8"));
    setPadActions(config.padActions || []);
  } catch (error) {
    console.warn("SHOW PAD: se utilizarán acciones FX por defecto.", error.message);
  }
  try {
    const file = path.join(app.getPath("userData"), "show-pad-actions.json");
    if (fs.existsSync(file)) setPadActions(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    console.warn("SHOW PAD: no se pudieron recuperar las acciones locales.", error);
  }
}

function resolveMidiPad(deviceName, note, deviceId = "") {
  // El SMC-PAD Pocket puede anunciarse por BLE como "SMC-Mixer-Bt".
  // La implementación MIDI original identificaba ese transporte por el
  // prefijo ble:, no por el nombre Bluetooth anunciado.
  const isSmcPadBleTransport = String(deviceId).startsWith("ble:") ||
    /^smc[\s-]*mixer[\s-]*bt$/i.test(String(deviceName || ""));
  const profile = isSmcPadBleTransport
    ? midiProfiles.find((item) => item.profileId === "m-vave-smc-pad-pocket")
    : midiProfiles.find((item) => item._namePattern?.test(String(deviceName || "")));
  const mapping = profile?.padMapping;
  if (!mapping) return null;

  if (mapping.strategy === "banked-note-range") {
    const firstNote = Number(mapping.firstBankFirstNote);
    const padsPerBank = Number(mapping.padsPerBank);
    const bankCount = Number(mapping.bankCount);
    const offset = Number(mapping.notesPerBankOffset || padsPerBank);
    const delta = Number(note) - firstNote;
    if (!Number.isInteger(delta) || delta < 0 || delta >= bankCount * offset || padsPerBank < 1) return null;
    const bank = Math.floor(delta / offset);
    const padId = (delta % offset) + 1;
    return { profileId: profile.profileId, page: bank + 1, padId, bank: bank + 1 };
  }

  if (mapping.strategy === "profile-defined-midi-map") {
    const notes = mapping.firstBank?.pad01ToPad16Notes || [];
    const index = notes.indexOf(Number(note));
    if (index < 0) return null;
    return { profileId: profile.profileId, page: 1, padId: index + 1, bank: 1 };
  }
  return null;
}

function sendPadTriggerToWindow(payload) {
  if (!showPadWindow || showPadWindow.isDestroyed()) return false;
  if (!showPadReady) {
    queuedPadTriggers.push(payload);
    return true;
  }
  showPadWindow.webContents.send("show-pad:trigger", payload);
  return true;
}

function flushQueuedPadTriggers() {
  if (!showPadReady || !showPadWindow || showPadWindow.isDestroyed()) return;
  while (queuedPadTriggers.length) {
    showPadWindow.webContents.send("show-pad:trigger", queuedPadTriggers.shift());
  }
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function resolveAppAsset(...segments) {
  return pathToFileURL(path.join(app.getAppPath(), ...segments)).href;
}

function createWindowOptions(extra = {}) {
  return {
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
    ...extra,
  };
}

function selectPresentationDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((display) => display.id !== primary.id) ?? primary;
}

function presentationBounds() {
  const display = selectPresentationDisplay();
  const area = display.workArea;
  const width = Math.min(SCORE_PREFERRED_SIZE.width, area.width);
  const height = Math.min(SCORE_PREFERRED_SIZE.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function repositionScoreWindow() {
  if (!scoreWindow || scoreWindow.isDestroyed()) return;
  scoreWindow.setBounds(presentationBounds());
}

function ensureScoreTopmost() {
  if (!scoreWindow || scoreWindow.isDestroyed()) return;
  scoreWindow.setAlwaysOnTop(true, "floating");
}

function createShowroomWindow() {
  showroomWindow = new BrowserWindow(createWindowOptions({
    ...SHOWROOM_SIZE,
    minWidth: 200,
    minHeight: 480,
    title: "myRockomix SHOW Â· SHOW ROOM",
    backgroundColor: "#101217",
    autoHideMenuBar: true,
  }));
  showroomWindow.setMenuBarVisibility(false);
  showroomWindow.loadFile(path.join(__dirname, "index.html"));
  showroomWindow.on("closed", () => {
    showroomWindow = undefined;
    requestApplicationShutdown();
  });
}

function showOrCreateShowroomWindow() {
  if (!showroomWindow || showroomWindow.isDestroyed()) {
    createShowroomWindow();
    return;
  }

  if (showroomWindow.isMinimized()) showroomWindow.restore();
  showroomWindow.show();
  showroomWindow.focus();
}

function createShowPadWindow() {
  showPadReady = false;
  showPadWindow = new BrowserWindow(createWindowOptions({
    ...SHOW_PAD_SIZE,
    minWidth: 520,
    minHeight: 580,
    title: "myRockomix SHOW · SHOW PAD FX",
    backgroundColor: "#101216",
    autoHideMenuBar: true,
    show: false,
  }));
  showPadWindow.setMenuBarVisibility(false);
  showPadWindow.loadFile(path.join(__dirname, "modules", "show-pad", "index.html"), {
    query: { view: "pads" },
  });
  showPadWindow.webContents.on("did-start-loading", () => { showPadReady = false; });
  showPadWindow.once("ready-to-show", () => showPadWindow?.show());
  showPadWindow.on("closed", () => {
    showPadWindow = undefined;
    showPadReady = false;
    queuedPadTriggers.length = 0;
  });
}

function showOrCreateShowPadWindow() {
  if (!showPadWindow || showPadWindow.isDestroyed()) {
    createShowPadWindow();
    return;
  }

  if (showPadWindow.isMinimized()) showPadWindow.restore();
  showPadWindow.show();
  showPadWindow.focus();
}

function createScoreWindow() {
  scoreWindow = new BrowserWindow(createWindowOptions({
    ...presentationBounds(),
    title: "myRockomix SHOW Â· SCORE",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
  }));
  ensureScoreTopmost();
  scoreWindow.setIgnoreMouseEvents(true);
  scoreWindow.loadFile(path.join(__dirname, "score.html"));
  scoreWindow.webContents.once("did-finish-load", flushQueuedScore);
  scoreWindow.on("show", ensureScoreTopmost);
  scoreWindow.on("restore", ensureScoreTopmost);
  scoreWindow.on("closed", () => { scoreWindow = undefined; });
}

function createAudioWindow() {
  audioWindow = new BrowserWindow(createWindowOptions({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    focusable: false,
  }));
  audioWindow.loadFile(path.join(__dirname, "audio.html"));
  audioWindow.on("closed", () => { audioWindow = undefined; });
}

function ensureScoreWindow() {
  if (!scoreWindow || scoreWindow.isDestroyed()) createScoreWindow();
  return scoreWindow;
}

function ensureAudioWindow() {
  if (!audioWindow || audioWindow.isDestroyed()) createAudioWindow();
  return audioWindow;
}

function closeApplicationWindows() {
  if (scoreSequenceTimer) clearTimeout(scoreSequenceTimer);
  scoreSequenceTimer = undefined;
  scoreSequenceActive = false;
  scoreCloseInProgress = false;
  scoreRevealStartedAt = undefined;

  for (const window of [scoreWindow, audioWindow]) {
    if (window && !window.isDestroyed()) window.close();
  }
}

function requestApplicationShutdown() {
  if (applicationShutdownInProgress) return;
  applicationShutdownInProgress = true;
  closeApplicationWindows();
  app.quit();
}

function sendAudio(payload) {
  const target = ensureAudioWindow();
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", () => target.webContents.send("score:play-audio", payload));
    return;
  }
  target.webContents.send("score:play-audio", payload);
}

function hideScoreWindow({ preserveCloseState = false } = {}) {
  if (scoreSequenceTimer) clearTimeout(scoreSequenceTimer);
  scoreSequenceTimer = undefined;
  scoreSequenceActive = false;
  if (!preserveCloseState) scoreCloseInProgress = false;
  scoreRevealStartedAt = undefined;
  if (scoreWindow && !scoreWindow.isDestroyed()) scoreWindow.hide();
  // El audio deliberadamente no se pausa ni se destruye aquÃ­.
}

function scheduleScoreHideAfterReveal(durationMs = SCORE_REVEAL_MIN_HOLD_MS) {
  const requested = Number(durationMs);
  const holdMs = Number.isFinite(requested)
    ? Math.min(SCORE_REVEAL_MAX_HOLD_MS, Math.max(SCORE_REVEAL_MIN_HOLD_MS, requested))
    : SCORE_REVEAL_MIN_HOLD_MS;
  if (scoreSequenceTimer) clearTimeout(scoreSequenceTimer);
  const elapsed = scoreRevealStartedAt === undefined ? 0 : Date.now() - scoreRevealStartedAt;
  scoreSequenceTimer = setTimeout(hideScoreWindow, Math.max(0, holdMs - elapsed));
}

function flushQueuedScore() {
  if (!queuedScoreResult || !scoreWindow || scoreWindow.isDestroyed()) return;
  const result = queuedScoreResult;
  queuedScoreResult = undefined;
  repositionScoreWindow();
  ensureScoreTopmost();
  scoreWindow.showInactive();
  scoreWindow.webContents.send("score:start", result);
}

function startScorePresentation(result) {
  scoreSequenceActive = true;
  scoreCloseInProgress = false;
  const target = ensureScoreWindow();
  queuedScoreResult = result;
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", flushQueuedScore);
  } else {
    flushQueuedScore();
  }
  sendAudio({ type: "spin" });
}

function beginManualScoreClose() {
  if (scoreCloseInProgress) return false;
  scoreCloseInProgress = true;
  if (scoreSequenceTimer) clearTimeout(scoreSequenceTimer);
  scoreSequenceTimer = undefined;
  sendAudio({ type: "score-fade-out", durationMs: 1_000 });
  hideScoreWindow({ preserveCloseState: true });
  return true;
}

const engine = new LocalShowEngine();
engine.register("SCORE_SHOW", (command) => {
  if (false) {
    return { accepted: false, error: "El cierre de SCORE está en curso." };
  }
  const scoreVisible = Boolean(
    scoreWindow &&
    !scoreWindow.isDestroyed() &&
    scoreWindow.isVisible()
  );
  if (scoreVisible) {
    if (scoreCloseInProgress) {
      return { accepted: false, closing: true };
    }
    if (!scoreWindow.webContents.isDestroyed()) scoreWindow.webContents.send("score:stop");
    beginManualScoreClose();
    return { accepted: true, closing: true };
  }
  if (false) {
    return { accepted: false, error: "Ya hay una calificaciÃ³n en curso." };
  }
  const explicitScore = command.params.score;
  if (explicitScore !== undefined && !isRatingScore(explicitScore)) {
    return { accepted: false, error: "params.score debe ser un entero entre 6 y 10." };
  }
  const score = explicitScore === undefined ? generateRatingScore() : explicitScore;
  const result = {
    ratingId: command.requestId,
    idPad: command.id_pad ?? null,
    idSong: command.id_song ?? null,
    singerName: typeof command.params.singerName === "string" ? command.params.singerName : "",
    title: typeof command.params.title === "string" ? command.params.title : "",
    score,
    phrase: chooseRatingPhrase(score),
    startedAt: Date.now(),
  };
  startScorePresentation(result);
  return { accepted: true, result };
});

engine.register("FX_PLAY", (command) => {
  if (command.id_pad !== "kikekaraoke-envivo") {
    return { accepted: false, error: "FX_PLAY requiere el PAD kikekaraoke-envivo." };
  }
  sendAudio({
    type: "fx",
    src: resolveAppAsset("assets", "audio", "fxs", "kikekaraoke-envivo.mp3"),
  });
  return { accepted: true, idPad: command.id_pad };
});

// ENGINE decide qué acción corresponde a cada PAD. La interfaz nunca ejecuta
// directamente una acción de PC: solicita PAD_TRIGGER y espera la respuesta.
engine.register("PAD_TRIGGER", async (command) => {
  const page = Number(command.params.page);
  const padId = Number(command.params.padId);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(padId) || padId < 1 || padId > 16) {
    return { accepted: false, error: "PAD_TRIGGER requiere page y padId válidos." };
  }
  const action = padActions.get(`${page}:${padId}`) || "fx";
  const visualEvent = {
    page,
    padId,
    eventId: command.requestId,
    origin: command.params.origin || "midi",
    visualOnly: action !== "fx",
  };

  if (action === "score" || action === "score10") {
    sendPadTriggerToWindow(visualEvent);
    const scoreResult = await engine.dispatch({
      type: "SCORE_SHOW",
      id_pad: `pad-${page}-${padId}`,
      source: "pc",
      params: action === "score10" ? { score: 10 } : {},
      requestId: createRequestId(),
    });
    return { ...scoreResult, action, page, padId };
  }

  if (!showPadWindow || showPadWindow.isDestroyed()) showOrCreateShowPadWindow();
  const sent = sendPadTriggerToWindow(visualEvent);
  return { accepted: sent, action: "fx", page, padId, error: sent ? undefined : "SHOW PAD FX no está disponible." };
});

ipcMain.handle("show:dispatch-command", (_event, command) => engine.dispatch(command));
ipcMain.handle("show:open-pad", () => {
  showOrCreateShowPadWindow();
  return { opened: true };
});
ipcMain.handle("show:midi-input", (event, payload) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents) {
    return { accepted: false, error: "Origen MIDI no autorizado." };
  }
  const status = Number(payload?.status);
  const command = status & 0xf0;
  const velocity = Number(payload?.velocity) || 0;
  if (command !== 0x90 || velocity <= 0) return { accepted: false, ignored: true };
  const resolved = resolveMidiPad(payload?.deviceName, Number(payload?.note), payload?.deviceId);
  if (!resolved) return { accepted: false, error: "Nota MIDI sin mapeo para este dispositivo." };
  const channel = (status & 0x0f) + 1;
  return engine.dispatch({
    type: "PAD_TRIGGER",
    id_pad: `pad-${resolved.page}-${resolved.padId}`,
    source: "pc",
    params: {
      ...resolved,
      channel,
      note: Number(payload.note),
      velocity,
      deviceId: String(payload.deviceId || ""),
      deviceName: String(payload.deviceName || ""),
      origin: "midi",
    },
    requestId: createRequestId(),
  });
});

ipcMain.handle("show:trigger-pad", (event, payload) => {
  if (!showPadWindow || event.sender !== showPadWindow.webContents) {
    return { accepted: false, error: "Origen de PAD no autorizado." };
  }
  return engine.dispatch({
    type: "PAD_TRIGGER",
    id_pad: `pad-${Number(payload?.page)}-${Number(payload?.padId)}`,
    source: "pc",
    params: {
      page: Number(payload?.page),
      padId: Number(payload?.padId),
      origin: "mouse",
    },
    requestId: createRequestId(),
  });
});

ipcMain.on("show:register-pad-actions", (event, items) => {
  if (!showPadWindow || event.sender !== showPadWindow.webContents) return;
  setPadActions(items, { persist: true });
  showPadReady = true;
  flushQueuedPadTriggers();
});
ipcMain.on("score:play-reveal-audio", (_event, { score }) => {
  if (!isRatingScore(score)) return;
  scoreRevealStartedAt = Date.now();
  scheduleScoreHideAfterReveal();
  sendAudio({ type: "reveal", score });
});
ipcMain.on("score:reveal-duration", (_event, { durationMs }) => {
  if (scoreSequenceActive && !scoreCloseInProgress) scheduleScoreHideAfterReveal(durationMs);
});
ipcMain.on("score:fade-complete", () => {
  if (!scoreCloseInProgress) return;
  hideScoreWindow();
});

app.whenReady().then(() => {
  loadInitialPadActions();
  Menu.setApplicationMenu(null);
  createShowroomWindow();
  createScoreWindow();
  createAudioWindow();
  for (const eventName of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(eventName, repositionScoreWindow);
  }
});

app.on("before-quit", () => {
  applicationShutdownInProgress = true;
  closeApplicationWindows();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showOrCreateShowroomWindow);
}

app.on("window-all-closed", () => app.quit());
