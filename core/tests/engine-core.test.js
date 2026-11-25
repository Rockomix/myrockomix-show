"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EngineCore } = require("../engine-core.js");

test("dispatches a registered command", async () => {
  const engine = new EngineCore({ requestIdFactory: () => "generated" });
  engine.register("FX_PLAY", (command) => ({ accepted: true, effectId: command.id_pad }));
  const result = await engine.dispatch({ type: "FX_PLAY", id_pad: "aplausos", source: "pc" });
  assert.deepEqual(result, { accepted: true, effectId: "aplausos" });
});

test("rejects a duplicate request before calling the handler twice", async () => {
  const engine = new EngineCore();
  let calls = 0;
  engine.register("FX_PLAY", () => { calls += 1; return { accepted: true }; });
  const command = { type: "FX_PLAY", id_pad: "fx", source: "pc", requestId: "same" };
  const first = await engine.dispatch(command);
  const second = await engine.dispatch(command);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.match(second.error, /Duplicate/);
  assert.equal(calls, 1);
});

test("evicts the oldest request at the configured limit", async () => {
  const engine = new EngineCore({ maxSeenRequests: 2 });
  engine.register("FX_PLAY", () => ({ accepted: true }));
  await engine.dispatch({ type: "FX_PLAY", id_pad: "a", source: "pc", requestId: "1" });
  await engine.dispatch({ type: "FX_PLAY", id_pad: "b", source: "pc", requestId: "2" });
  await engine.dispatch({ type: "FX_PLAY", id_pad: "c", source: "pc", requestId: "3" });
  assert.equal(engine.hasSeenRequest("1"), false);
  assert.equal(engine.hasSeenRequest("2"), true);
});

test("returns handler failures as structured errors", async () => {
  const engine = new EngineCore();
  engine.register("FX_PLAY", () => { throw new Error("audio unavailable"); });
  const result = await engine.dispatch({ type: "FX_PLAY", id_pad: "fx", source: "pc", requestId: "fail" });
  assert.equal(result.accepted, false);
  assert.equal(result.details, "audio unavailable");
});

test("does not call a handler for invalid commands", async () => {
  const engine = new EngineCore();
  let calls = 0;
  engine.register("PAD_TRIGGER", () => { calls += 1; });
  const result = await engine.dispatch({ type: "PAD_TRIGGER", params: { page: 1, padId: 17 }, source: "pc" });
  assert.equal(result.accepted, false);
  assert.equal(calls, 0);
});
