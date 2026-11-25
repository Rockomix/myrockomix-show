"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCommand,
  validateAndNormalizeCommand,
  validateCommand,
} = require("../command-contract.js");

test("normalizes a legacy command without changing its params", () => {
  const command = normalizeCommand({
    type: "FX_PLAY",
    id_pad: "kikekaraoke-envivo",
    params: { volume: 1 },
    source: "pc",
    requestId: "legacy-1",
  });
  assert.equal(command.requestId, "legacy-1");
  assert.equal(command.id_pad, "kikekaraoke-envivo");
  assert.deepEqual(command.params, { volume: 1 });
});

test("normalizes the proposed payload contract to the legacy shape", () => {
  const command = normalizeCommand({
    type: "FX_PLAY",
    payload: { effectId: "aplausos" },
    source: "android",
    target: "pc",
    requestId: "new-1",
  });
  assert.equal(command.id_pad, "aplausos");
  assert.deepEqual(command.params, { effectId: "aplausos" });
  assert.equal(command.target, "pc");
});

test("generates a requestId when it is absent", () => {
  const command = normalizeCommand({ type: "FX_PLAY", id_pad: "fx" }, { requestIdFactory: () => "generated-1" });
  assert.equal(command.requestId, "generated-1");
});

test("validates a PAD_TRIGGER range", () => {
  const valid = validateAndNormalizeCommand({ type: "PAD_TRIGGER", params: { page: 2, padId: 16 }, source: "pc" });
  const invalid = validateAndNormalizeCommand({ type: "PAD_TRIGGER", params: { page: 0, padId: 17 }, source: "pc" });
  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /page/);
  assert.match(invalid.errors.join(" "), /padId/);
});

test("rejects unsupported commands and sources", () => {
  const result = validateCommand({
    version: 1,
    type: "UNKNOWN",
    requestId: "x",
    source: "unknown",
    target: "pc",
    params: {},
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /unsupported command type/);
  assert.match(result.errors.join(" "), /source/);
});
