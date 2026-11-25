"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { PcMidiManager } = require("../../pc-midi-manager.js");

const profiles = [
  JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad-pocket.json", "utf8")),
  JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad.json", "utf8")),
  JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-mixer.json", "utf8")),
];

test("prefers the saved device instead of list order", () => {
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }), preferredDeviceId: "usb:pocket" });
  const preferred = manager.updateDevices([
    { id: "usb:mixer", name: "SMC-MIXER-Bt", manufacturer: "M-VAVE" },
    { id: "usb:pocket", name: "SMC-PAD Pocket", manufacturer: "M-VAVE" },
  ]);
  assert.equal(preferred.deviceId, "usb:pocket");
  assert.equal(preferred.profileId, "m-vave-smc-pad-pocket");
});

test("does not treat an available Mixer port as the active connection", () => {
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }) });
  manager.updateDevices([{
    deviceId: "midi:mixer-port",
    deviceName: "SMC-MIXER-Bt",
    manufacturer: "M-VAVE",
    connected: false,
  }]);
  assert.equal(manager.connectedDeviceId, "");
  assert.equal(manager.devices.get("midi:mixer-port").connected, false);
});

test("keeps mixer and Pocket identities separate", () => {
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }) });
  manager.updateDevices([
    { id: "ble:mixer", name: "SMC-MIXER-Bt", manufacturer: "M-VAVE" },
    { id: "usb:pocket", name: "SMC-PAD Pocket", manufacturer: "M-VAVE" },
  ]);
  assert.equal(manager.devices.get("ble:mixer").profileId, "m-vave-smc-mixer");
  assert.equal(manager.devices.get("usb:pocket").profileId, "m-vave-smc-pad-pocket");
});

test("allows manual selection and persists the real device id", () => {
  let saved = "";
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }), savePreferredDevice: id => { saved = id; } });
  manager.updateDevices([{ id: "usb:real", name: "SMC-PAD Pocket", manufacturer: "M-VAVE" }]);
  const result = manager.chooseDevice("usb:real");
  assert.equal(result.accepted, true);
  assert.equal(saved, "usb:real");
  assert.equal(manager.preferredDeviceId, "usb:real");
});

test("dispatches one mapped Note On event to the core", async () => {
  const commands = [];
  const manager = new PcMidiManager({ profiles, dispatch: async command => { commands.push(command); return { accepted: true, action: "fx" }; } });
  manager.updateDevices([{ id: "usb:pocket", name: "SMC-PAD Pocket", manufacturer: "M-VAVE" }]);
  manager.markConnected("usb:pocket");
  const result = await manager.handleMidiMessage({ deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket", status: 0x9a, note: 36, velocity: 100, requestId: "midi-1" });
  assert.equal(result.accepted, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "PAD_TRIGGER");
  assert.equal(commands[0].params.page, 1);
  assert.equal(commands[0].params.padId, 1);
});

test("does not dispatch mixer notes or unknown devices as pads", async () => {
  let calls = 0;
  const manager = new PcMidiManager({ profiles, dispatch: async () => { calls += 1; return { accepted: true }; } });
  manager.updateDevices([{ id: "ble:mixer", name: "SMC-MIXER-Bt", manufacturer: "M-VAVE" }]);
  manager.markConnected("ble:mixer");
  const mixerResult = await manager.handleMidiMessage({ deviceId: "ble:mixer", deviceName: "SMC-MIXER-Bt", note: 36, status: 0x90, velocity: 100 });
  const unknownResult = await manager.handleMidiMessage({ deviceId: "usb:unknown", deviceName: "Unknown", note: 36, status: 0x90, velocity: 100 });
  assert.equal(mixerResult.accepted, false);
  assert.equal(unknownResult.ignored, true);
  assert.equal(calls, 0);
});

test("does not dispatch a Note On after the active device disconnects", async () => {
  let calls = 0;
  const manager = new PcMidiManager({ profiles, dispatch: async () => { calls += 1; return { accepted: true }; } });
  manager.updateDevices([{ id: "usb:pocket", name: "SMC-PAD Pocket" }]);
  manager.markConnected("usb:pocket");
  manager.markDisconnected("usb:pocket");
  const result = await manager.handleMidiMessage({
    deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket", status: 0x90, note: 39, velocity: 100,
  });
  assert.equal(result.ignored, true);
  assert.equal(calls, 0);
});

test("prevents a second active MIDI connection", () => {
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }) });
  manager.updateDevices([
    { id: "usb:a", name: "SMC-PAD Pocket" },
    { id: "usb:b", name: "SMC-PAD" },
  ]);
  assert.equal(manager.markConnected("usb:a").accepted, true);
  assert.equal(manager.markConnected("usb:b").accepted, false);
});

test("does not activate an unknown device by manual selection", () => {
  const manager = new PcMidiManager({ profiles, dispatch: async () => ({ accepted: true }) });
  manager.updateDevices([{ id: "usb:unknown", name: "Unknown MIDI" }]);
  assert.equal(manager.chooseDevice("usb:unknown").accepted, false);
  assert.equal(manager.markConnected("usb:unknown").accepted, false);
});

test("reports non-Note-On events without dispatching pad actions", async () => {
  const events = [];
  let calls = 0;
  const manager = new PcMidiManager({
    profiles,
    dispatch: async () => { calls += 1; return { accepted: true }; },
    onEvent: event => events.push(event),
  });
  manager.updateDevices([{ id: "usb:pocket", name: "SMC-PAD Pocket" }]);
  manager.markConnected("usb:pocket");
  const result = await manager.handleMidiMessage({ deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket", status: 0x80, note: 36, velocity: 0 });
  assert.equal(result.ignored, true);
  assert.equal(calls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "note-off");
  assert.equal(events[0].channel, 1);
});

test("can report a Note On without dispatching a pad action", async () => {
  const events = [];
  let calls = 0;
  const manager = new PcMidiManager({
    profiles,
    dispatch: async () => { calls += 1; return { accepted: true }; },
    onEvent: event => events.push(event),
  });
  manager.updateDevices([{ deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket" }]);
  manager.markConnected("usb:pocket");
  const result = await manager.handleMidiMessage({
    deviceId: "usb:pocket",
    deviceName: "SMC-PAD Pocket",
    status: 0x90,
    note: 39,
    velocity: 100,
  }, { skipPadDispatch: true });
  assert.equal(result.ignored, true);
  assert.equal(calls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "note-on");
});

test("registers the direct BLE Pocket before accepting its MIDI events", async () => {
  const events = [];
  const manager = new PcMidiManager({
    profiles,
    dispatch: async () => ({ accepted: true }),
    onEvent: event => events.push(event),
  });
  manager.updateDevices([{
    deviceId: "ble:direct-pocket",
    deviceName: "SMC-PAD Pocket-Bt",
    deviceNameOriginal: "SMC-PAD Pocket-Bt",
    manufacturer: "M-VAVE",
    transport: "ble-midi",
  }]);
  assert.equal(manager.markConnected("ble:direct-pocket").accepted, true);
  const result = await manager.handleMidiMessage({
    deviceId: "ble:direct-pocket",
    deviceName: "SMC-PAD Pocket-Bt",
    manufacturer: "M-VAVE",
    transport: "ble-midi",
    status: 0x9a,
    note: 36,
    velocity: 100,
  });
  assert.equal(result.accepted, true);
  assert.equal(events[0].profileId, "m-vave-smc-pad-pocket");
  assert.equal(events[0].transport, "ble-midi");
});
