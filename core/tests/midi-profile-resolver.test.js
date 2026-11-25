"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
  resolveMidiNote,
  findMidiProfile,
  identifyMidiDevice,
  profileDisplayName,
} = require("../midi-profile-resolver.js");

const pocket = JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad-pocket.json", "utf8"));
const pad = JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad.json", "utf8"));
const mixer = JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-mixer.json", "utf8"));
const profiles = [pocket, pad, mixer];

test("resolves SMC-PAD Pocket banked notes", () => {
  assert.deepEqual(resolveMidiNote({ deviceName: "SMC-PAD Pocket", note: 36 }, profiles), {
    profileId: "m-vave-smc-pad-pocket",
    profileName: "SMC-PAD POCKET",
    page: 1,
    padId: 1,
    bank: 1,
  });
  assert.deepEqual(resolveMidiNote({ deviceName: "SMC-PAD Pocket", note: 51 }, profiles).padId, 16);
  assert.deepEqual(resolveMidiNote({ deviceName: "SMC-PAD Pocket", note: 52 }, profiles).page, 2);
});

test("identifies SMC-MIXER-Bt as its independent mixer profile", () => {
  const result = identifyMidiDevice({ deviceId: "ble:mixer-real-id", deviceName: "SMC-MIXER-Bt", manufacturer: "M-VAVE" }, profiles);
  assert.deepEqual(result, {
    deviceId: "ble:mixer-real-id",
    deviceName: "SMC-MIXER-Bt",
    manufacturer: "M-VAVE",
    profileId: "m-vave-smc-mixer",
    profileName: "SMC-Mixer",
  });
  assert.equal(resolveMidiNote({ deviceName: "SMC-MIXER-Bt", deviceId: "ble:mixer-real-id", note: 36 }, profiles), null);
});

test("identifies SMC-PAD POCKET independently from SMC-MIXER-Bt", () => {
  const result = identifyMidiDevice({ deviceId: "usb:pocket-real-id", deviceName: "SMC-PAD Pocket", manufacturer: "M-VAVE" }, profiles);
  assert.equal(result.profileId, "m-vave-smc-pad-pocket");
  assert.equal(result.profileName, "SMC-PAD POCKET");
  assert.notEqual(result.profileId, "m-vave-smc-mixer");
});

test("resolves the classic SMC-PAD profile-defined map", () => {
  const result = resolveMidiNote({ deviceName: "SMC-PAD", note: 51 }, profiles);
  assert.equal(result.profileId, "m-vave-smc-pad");
  assert.equal(result.page, 1);
  assert.equal(result.padId, 16);
});

test("rejects unmapped notes and unsupported profiles", () => {
  assert.equal(resolveMidiNote({ deviceName: "SMC-PAD Pocket", note: 35 }, profiles), null);
  assert.equal(resolveMidiNote({ deviceName: "Unknown device", note: 36 }, profiles), null);
});

test("does not select an unrelated device by list position alone", () => {
  const profile = findMidiProfile({ deviceName: "Unrelated MIDI device", deviceId: "usb:other" }, profiles);
  assert.equal(profile, null);
});

test("preserves the real port id during manual device identification", () => {
  const result = identifyMidiDevice({ deviceId: "usb:7f3a-real-port", deviceName: "SMC-PAD Pocket" }, profiles);
  assert.equal(result.deviceId, "usb:7f3a-real-port");
  assert.equal(result.deviceName, "SMC-PAD Pocket");
});

test("does not invent a profile for an unknown device", () => {
  assert.equal(identifyMidiDevice({ deviceId: "usb:unknown", deviceName: "SMC-Whatever" }, profiles), null);
});

test("uses the required visible Pocket profile name", () => {
  assert.equal(profileDisplayName(pocket), "SMC-PAD POCKET");
});
