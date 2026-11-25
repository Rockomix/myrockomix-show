"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
  resolveAssignedMidiNote,
  matchesScorePadAssignment,
} = require("../assigned-midi-resolver.js");

const profiles = [
  JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad-pocket.json", "utf8")),
  JSON.parse(readFileSync("modules/show-pad/devices/m-vave-smc-pad.json", "utf8")),
];

test("resuelve PAD 4 por profileId aunque el nombre recibido difiera", () => {
  const resolved = resolveAssignedMidiNote({
    deviceId: "usb:pocket",
    deviceName: "Puerto MIDI renombrado",
    note: 39,
  }, {
    devices: [{ deviceId: "usb:pocket", profileId: "m-vave-smc-pad-pocket" }],
    profiles,
  });
  assert.equal(resolved.padId, 4);
  assert.equal(resolved.profileId, "m-vave-smc-pad-pocket");
});

test("solo coincide con el pad asignado y permite una asignación personalizada", () => {
  const pad4 = resolveAssignedMidiNote({ deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket", note: 39 }, { profiles });
  const pad5 = resolveAssignedMidiNote({ deviceId: "usb:pocket", deviceName: "SMC-PAD Pocket", note: 40 }, { profiles });
  const assignment = { profileId: "m-vave-smc-pad-pocket", page: 1, padId: 5 };
  assert.equal(matchesScorePadAssignment(pad4, assignment), false);
  assert.equal(matchesScorePadAssignment(pad5, assignment), true);
});
