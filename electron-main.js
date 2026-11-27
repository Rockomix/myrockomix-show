const { app, BrowserWindow, ipcMain, screen, Menu, dialog, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const { EngineCore } = require("./core/engine-core.js");
const { createRequestId } = require("./core/command-contract.js");
const { resolveAssignedMidiNote, matchesScorePadAssignment } = require("./core/assigned-midi-resolver.js");
const { PcMidiManager } = require("./pc-midi-manager.js");
const { createScorePadPressDetector } = require("./core/score-pad-press-detector.js");
const {
  chooseRatingPhrase,
  generateRatingScore,
  isRatingScore,
} = require("./js/score-core.js");
const execFileAsync = promisify(execFile);

protocol.registerSchemesAsPrivileged([{
  scheme: "rockomix-audio",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const SHOWROOM_SIZE = { width: 300, height: 500 };
const SHOW_PAD_SIZE = { width: 540, height: 620 };
const SCORE_PREFERRED_SIZE = { width: 1100, height: 700 };
const SCORE_REVEAL_MIN_HOLD_MS = 8_000;
const SCORE_REVEAL_MAX_HOLD_MS = 12_000;
const SCORE_REVEAL_SHORT_LIMIT_MS = 5_000;
const SCORE_REVEAL_SHORT_GRACE_MS = 2_000;
const SCORE_REVEAL_LONG_GRACE_MS = 4_000;
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
let midiManager;
let scorePadAssignment = null;
let scorePadAssignmentMode = false;
const recentAssignedMidiEvents = new Map();
const BLE_DEVICE_NAME_PATTERN = /^smc[\s-]*(?:pad[\s-]*pocket|mixer)(?:[\s-]*bt)?$/i;
const padActions = new Map();
let showPadReady = false;
let activeShowFxPage = 1;
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

function midiPreferencePath() {
  return path.join(app.getPath("userData"), "show-midi-device.json");
}

function loadPreferredMidiDeviceId() {
  try {
    const value = JSON.parse(fs.readFileSync(midiPreferencePath(), "utf8"));
    return typeof value?.deviceId === "string" ? value.deviceId : "";
  } catch {
    return "";
  }
}

function savePreferredMidiDeviceId(deviceId) {
  try {
    fs.mkdirSync(path.dirname(midiPreferencePath()), { recursive: true });
    fs.writeFileSync(midiPreferencePath(), JSON.stringify({ deviceId }, null, 2));
  } catch (error) {
    console.warn("SHOW MIDI: no se pudo guardar el dispositivo preferido.", error);
  }
}

function scorePadAssignmentPath() {
  return path.join(app.getPath("userData"), "show-score-pad-assignment.json");
}

function defaultScorePadAssignment() {
  return {
    profileId: "m-vave-smc-pad-pocket",
    profileName: "SMC-PAD POCKET",
    page: 1,
    padId: 4,
    note: 39,
    deviceName: "SMC-PAD Pocket-Bt",
    deviceId: "",
  };
}

function loadScorePadAssignment() {
  scorePadAssignment = defaultScorePadAssignment();
  try {
    const value = JSON.parse(fs.readFileSync(scorePadAssignmentPath(), "utf8"));
    const page = Number(value?.page);
    const padId = Number(value?.padId);
    const note = Number(value?.note);
    if (typeof value?.profileId === "string" && Number.isInteger(page) && page > 0
      && Number.isInteger(padId) && padId >= 1 && padId <= 16
      && Number.isInteger(note) && note >= 0 && note <= 127) {
      scorePadAssignment = { ...scorePadAssignment, ...value, page, padId, note };
    }
  } catch {
    // La asignación predeterminada se utiliza en la primera ejecución.
  }
}

function saveScorePadAssignment() {
  try {
    fs.mkdirSync(path.dirname(scorePadAssignmentPath()), { recursive: true });
    fs.writeFileSync(scorePadAssignmentPath(), JSON.stringify(scorePadAssignment, null, 2));
  } catch (error) {
    console.warn("SHOW SCORE: no se pudo guardar la asignación MIDI.", error);
  }
}

function isActiveMidiPayload(payload) {
  const activeId = midiManager?.getState().connectedDeviceId;
  console.info("[MIDI TRACE] assigned.active-check", { payloadDeviceId: payload?.deviceId, activeDeviceId: activeId, transport: payload?.transport });
  return Boolean(activeId) && String(activeId) === String(payload?.deviceId || "");
}

function isDuplicateAssignedMidiEvent(payload, resolved) {
  const timestamp = Number(payload?.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  // El mismo Note On puede llegar por más de un transporte. El timestamp
  // identifica la misma entrega física sin confundirla con una segunda
  // pulsación válida dentro de la ventana de doble pulsación.
  const key = [
    resolved.profileId,
    resolved.page,
    resolved.padId,
    Number(payload?.status) & 0xff,
    Number(payload?.note),
    Number(payload?.velocity),
    timestamp,
  ].join(":");
  if (recentAssignedMidiEvents.has(key)) return true;

  const timer = setTimeout(() => recentAssignedMidiEvents.delete(key), 1_000);
  recentAssignedMidiEvents.set(key, timer);
  return false;
}

async function dispatchAssignedScore(score) {
  const command = {
    type: "SCORE_SHOW",
    // Reutiliza el mismo contrato que los botones CALIFICAR y 10.
    id_pad: "score",
    source: "pc",
    params: score === 10 ? { score: 10 } : {},
    requestId: createRequestId(),
  };
  console.info("[MIDI TRACE] assigned.dispatch-score", { score: score ?? "random", command });
  const result = await engine.dispatch(command);
  console.info("[MIDI TRACE] assigned.dispatch-score-result", { score: score ?? "random", result });
  return result;
}

const scorePadPressDetector = createScorePadPressDetector({
  onSingle: () => dispatchAssignedScore(),
  onDouble: () => dispatchAssignedScore(10),
});

async function handleAssignedScoreMidi(payload) {
  console.info("[MIDI TRACE] assigned.enter", { payload, savedAssignment: scorePadAssignment, assignmentMode: scorePadAssignmentMode });
  if (!isActiveMidiPayload(payload)) {
    console.debug("SHOW SCORE MIDI: evento ignorado porque el deviceId no es el conectado.", {
      payloadDeviceId: payload?.deviceId,
      activeDeviceId: midiManager?.getState().connectedDeviceId,
      transport: payload?.transport,
    });
    return null;
  }
  const status = Number(payload?.status) & 0xff;
  const velocity = Number(payload?.velocity) || 0;
  if ((status & 0xf0) !== 0x90 || velocity <= 0) {
    console.info("[MIDI TRACE] assigned.discard", { reason: (status & 0xf0) !== 0x90 ? "not-note-on" : "velocity-not-positive", status, velocity, note: payload?.note, data1: payload?.data1 });
    return null;
  }

  const resolved = resolveAssignedMidiNote(payload, {
    devices: midiManager?.getState().devices,
    profiles: midiProfiles,
  });
  console.info("[MIDI TRACE] assigned.resolution", { payloadDeviceId: payload?.deviceId, payloadDeviceName: payload?.deviceName, payloadProfileId: payload?.profileId, note: payload?.note, noteNumber: payload?.noteNumber, data1: payload?.data1, resolved });
  if (!resolved) {
    console.info("[MIDI TRACE] assigned.discard", { reason: "assigned-note-unmapped" });
    return null;
  }
  if (isDuplicateAssignedMidiEvent(payload, resolved)) {
    console.info("[MIDI TRACE] assigned.discard", { reason: "duplicate-event", resolved });
    return { accepted: false, ignored: true, duplicate: true, page: resolved.page, padId: resolved.padId };
  }

  if (scorePadAssignmentMode) {
    await midiManager.handleMidiMessage(payload, { skipPadDispatch: true });
    scorePadAssignment = {
      ...scorePadAssignment,
      profileId: resolved.profileId,
      profileName: resolved.profileName,
      page: resolved.page,
      padId: resolved.padId,
      note: Number(payload.note),
      deviceId: String(payload.deviceId || ""),
      deviceName: String(payload.deviceName || ""),
    };
    scorePadAssignmentMode = false;
    saveScorePadAssignment();
    return { accepted: true, action: "assigned", assignment: { ...scorePadAssignment }, page: resolved.page, padId: resolved.padId };
  }

  if (!matchesScorePadAssignment(resolved, scorePadAssignment)) {
    console.debug("SHOW SCORE MIDI: evento recibido fuera de la asignación.", {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      profileId: payload.profileId,
      resolved,
      assignment: scorePadAssignment,
    });
    return null;
  }
  console.info("[MIDI TRACE] assigned.match", { resolved, assignment: scorePadAssignment });
  await midiManager.handleMidiMessage(payload, { skipPadDispatch: true });
  const key = `${resolved.profileId}:${resolved.page}:${resolved.padId}`;
  const pressResult = await scorePadPressDetector.press(key);
  console.info("[MIDI TRACE] assigned.detector-result", { key, pressResultKind: pressResult.kind });
  if (pressResult.kind === "double") {
    const result = pressResult.result;
    return { ...result, action: "score10", page: resolved.page, padId: resolved.padId };
  }
  return { accepted: true, action: "score-pending", page: resolved.page, padId: resolved.padId };
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

async function registerLocalAudioProtocol() {
  await protocol.handle("rockomix-audio", async (request) => {
    const relativePath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
    if (!relativePath.startsWith("sounds/") || relativePath.includes("..")) return new Response("Not found", { status: 404 });
    const filePath = path.join(app.getAppPath(), "assets", "audio", relativePath.slice("sounds/".length));
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      const response = await net.fetch(pathToFileURL(filePath).href);
      if (!response.ok) return new Response("Not found", { status: response.status });
      const headers = new Headers(response.headers);
      headers.set("Content-Type", "audio/mpeg");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Range, Content-Type");
      headers.set("Cache-Control", "no-cache");
      return new Response(await response.arrayBuffer(), { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
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
  showroomWindow.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    const pocket = (Array.isArray(devices) ? devices : []).find((device) => {
      return BLE_DEVICE_NAME_PATTERN.test(String(device?.deviceName || "").trim());
    });
    if (pocket) {
      callback(pocket.deviceId);
      return;
    }
    // Electron emits this event repeatedly while the scan is in progress.
    // Do not cancel requestDevice() just because the first list is empty.
  });
  const bluetoothSession = showroomWindow.webContents.session;
  if (typeof bluetoothSession.setBluetoothPairingHandler === "function") {
    bluetoothSession.setBluetoothPairingHandler((details, callback) => {
      const pairingKind = String(details?.pairingKind || "confirm");
      const message = pairingKind === "providePin"
        ? "El SMC-PAD Pocket solicita un PIN Bluetooth."
        : "¿Permitir el emparejamiento Bluetooth del SMC-PAD Pocket?";
      void dialog.showMessageBox(showroomWindow, {
        type: "question",
        buttons: ["Cancelar", "Permitir"],
        defaultId: 0,
        cancelId: 0,
        title: "Bluetooth MIDI",
        message,
        detail: pairingKind === "confirmPin" && details?.pin
          ? `Confirma el PIN ${details.pin} en el dispositivo.`
          : undefined,
      }).then(({ response }) => callback({ confirmed: response === 1 }))
        .catch(() => callback({ confirmed: false }));
    });
  }
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

function createShowPadWindow({ visible = true } = {}) {
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
  showPadWindow.once("ready-to-show", () => {
    if (visible) showPadWindow?.show();
  });
  showPadWindow.on("closed", () => {
    showPadWindow = undefined;
    showPadReady = false;
    activeShowFxPage = 1;
    queuedPadTriggers.length = 0;
  });
}

function ensureShowPadWindowHidden() {
  if (!showPadWindow || showPadWindow.isDestroyed()) {
    createShowPadWindow({ visible: false });
  }
  return showPadWindow;
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

function scheduleScoreHideAfterReveal(durationMs) {
  const requested = Number(durationMs);
  const holdMs = Number.isFinite(requested)
    ? requested + (requested < SCORE_REVEAL_SHORT_LIMIT_MS
      ? SCORE_REVEAL_SHORT_GRACE_MS
      : SCORE_REVEAL_LONG_GRACE_MS)
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

const engine = new EngineCore();
engine.register("SCORE_SHOW", (command) => {
  console.info("[MIDI TRACE] SCORE_SHOW.handler", { source: command.source, id_pad: command.id_pad, params: command.params, requestId: command.requestId });
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
  const requestedPage = Number(command.params.page);
  const page = command.params.origin === "midi" && showPadWindow && !showPadWindow.isDestroyed()
    ? activeShowFxPage
    : requestedPage;
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

  ensureShowPadWindowHidden();
  const wasReady = showPadReady && showPadWindow && !showPadWindow.isDestroyed();
  const sent = sendPadTriggerToWindow(visualEvent);
  if (!sent && !wasReady && queuedPadTriggers.includes(visualEvent)) {
    return { accepted: true, action: "fx", page, padId };
  }
  return { accepted: sent, action: "fx", page, padId, error: sent ? undefined : "SHOW PAD FX no está disponible." };
});

ipcMain.handle("show:dispatch-command", (_event, command) => engine.dispatch(command));
ipcMain.handle("show:open-pad", () => {
  showOrCreateShowPadWindow();
  return { opened: true };
});
ipcMain.handle("show:midi-input", async (event, payload) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents) {
    return { accepted: false, error: "Origen MIDI no autorizado." };
  }
  if (!midiManager) return { accepted: false, error: "MIDI manager is not ready." };
  const scoreResult = await handleAssignedScoreMidi(payload);
  if (scoreResult) return scoreResult;
  return midiManager.handleMidiMessage(payload);
});

ipcMain.handle("show:score-pad-assignment-get", (event) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents) return null;
  return scorePadAssignment ? { ...scorePadAssignment } : defaultScorePadAssignment();
});

ipcMain.handle("show:score-pad-assignment-begin", (event) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents || !midiManager) {
    return { accepted: false, error: "Origen MIDI no autorizado." };
  }
  if (!midiManager.getState().connectedDeviceId) {
    return { accepted: false, error: "Conecta un dispositivo MIDI antes de asignar." };
  }
  scorePadAssignmentMode = true;
  return { accepted: true };
});

ipcMain.handle("show:score-pad-assignment-cancel", (event) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents) return { accepted: false };
  scorePadAssignmentMode = false;
  return { accepted: true };
});

ipcMain.on("show:midi-devices", (event, devices) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents || !midiManager) return;
  midiManager.setEnabled(true);
  midiManager.updateDevices(devices);
});

ipcMain.handle("show:midi-physical-inventory", async (event) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents) return [];
  if (process.platform !== "win32") return [];
  const script = [
    "$items = Get-PnpDevice -PresentOnly | Where-Object {",
    "  $_.Class -eq 'MEDIA' -and",
    "  $_.Status -eq 'OK' -and",
    "  $_.InstanceId -match '^USB\\\\' -and",
    "  $_.InstanceId -notmatch '^(BOMEBUS|SWD|ROOT)\\\\'",
    "} | ForEach-Object {",
    "  $props = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_HardwareIds -ErrorAction SilentlyContinue;",
    "  [PSCustomObject]@{ deviceName = $_.FriendlyName; instanceId = $_.InstanceId; hardwareIds = @($props.Data); enumerator = 'USB'; status = $_.Status }",
    "};",
    "$items | ConvertTo-Json -Compress -Depth 4",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    const devices = Array.isArray(parsed) ? parsed : [parsed];
    console.info("SHOW MIDI physical inventory:", devices);
    return devices.filter((device) => device?.instanceId && device?.deviceName);
  } catch (error) {
    console.warn("SHOW MIDI: no se pudo consultar el inventario PnP físico.", error.message);
    return [];
  }
});

ipcMain.on("show:midi-selection", (event, deviceId) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents || !midiManager) return;
  midiManager.chooseDevice(deviceId);
});

ipcMain.handle("show:midi-preferred", (event) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents || !midiManager) return "";
  return midiManager.preferredDeviceId;
});

ipcMain.handle("show:midi-connection", (event, payload) => {
  if (!showroomWindow || event.sender !== showroomWindow.webContents || !midiManager) {
    return { accepted: false, error: "MIDI manager is not ready." };
  }
  if (payload?.connected) return midiManager.markConnected(payload.deviceId);
  midiManager.markDisconnected(payload?.deviceId, payload?.error);
  return { accepted: true, connected: false, deviceId: payload?.deviceId };
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

ipcMain.on("show:fx-page", (event, page) => {
  if (!showPadWindow || event.sender !== showPadWindow.webContents) return;
  const value = Number(page);
  if (Number.isInteger(value) && value >= 1) activeShowFxPage = value;
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

app.whenReady().then(async () => {
  await registerLocalAudioProtocol();
  loadInitialPadActions();
  loadScorePadAssignment();
  midiManager = new PcMidiManager({
    profiles: midiProfiles,
    dispatch: (command) => engine.dispatch(command),
    preferredDeviceId: loadPreferredMidiDeviceId(),
    savePreferredDevice: savePreferredMidiDeviceId,
    onEvent: (event) => {
      if (showroomWindow && !showroomWindow.isDestroyed()) showroomWindow.webContents.send("show-midi:event", event);
    },
  });
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
