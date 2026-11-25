const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("showHost", {
  dispatchCommand: (command) => ipcRenderer.invoke("show:dispatch-command", command),
  openShowPad: () => ipcRenderer.invoke("show:open-pad"),
  sendMidiInput: (payload) => ipcRenderer.invoke("show:midi-input", payload),
  getScorePadAssignment: () => ipcRenderer.invoke("show:score-pad-assignment-get"),
  beginScorePadAssignment: () => ipcRenderer.invoke("show:score-pad-assignment-begin"),
  cancelScorePadAssignment: () => ipcRenderer.invoke("show:score-pad-assignment-cancel"),
  reportMidiDevices: (devices) => ipcRenderer.send("show:midi-devices", devices),
  getPhysicalMidiInventory: () => ipcRenderer.invoke("show:midi-physical-inventory"),
  reportMidiSelection: (deviceId) => ipcRenderer.send("show:midi-selection", deviceId),
  reportMidiConnection: (payload) => ipcRenderer.invoke("show:midi-connection", payload),
  getPreferredMidiDevice: () => ipcRenderer.invoke("show:midi-preferred"),
  triggerPad: (payload) => ipcRenderer.invoke("show:trigger-pad", payload),
  setShowFxPage: (page) => ipcRenderer.send("show:fx-page", page),
  registerPadActions: (items) => ipcRenderer.send("show:register-pad-actions", items),
  onPadTrigger: (listener) => {
    const callback = (_event, payload) => listener(payload);
    ipcRenderer.on("show-pad:trigger", callback);
    return () => ipcRenderer.removeListener("show-pad:trigger", callback);
  },
  onMidiEvent: (listener) => {
    const callback = (_event, payload) => listener(payload);
    ipcRenderer.on("show-midi:event", callback);
    return () => ipcRenderer.removeListener("show-midi:event", callback);
  },
});

contextBridge.exposeInMainWorld("showScorePresentation", {
  onStart: (listener) => {
    const callback = (_event, result) => listener(result);
    ipcRenderer.on("score:start", callback);
    return () => ipcRenderer.removeListener("score:start", callback);
  },
  onStop: (listener) => {
    const callback = () => listener();
    ipcRenderer.on("score:stop", callback);
    return () => ipcRenderer.removeListener("score:stop", callback);
  },
  playRevealAudio: (score) => ipcRenderer.send("score:play-reveal-audio", { score }),
});

contextBridge.exposeInMainWorld("showScoreAudio", {
  onPlay: (listener) => {
    const callback = (_event, payload) => listener(payload);
    ipcRenderer.on("score:play-audio", callback);
    return () => ipcRenderer.removeListener("score:play-audio", callback);
  },
  reportRevealDuration: (score, durationMs) => ipcRenderer.send("score:reveal-duration", { score, durationMs }),
  reportScoreFadeComplete: () => ipcRenderer.send("score:fade-complete"),
});
