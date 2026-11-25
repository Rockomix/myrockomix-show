"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createScorePadPressDetector } = require("../score-pad-press-detector.js");

test("una pulsación ejecuta solo la acción sencilla después de 350 ms", async () => {
  const calls = [];
  const detector = createScorePadPressDetector({
    delayMs: 5,
    onSingle: () => calls.push("single"),
    onDouble: () => calls.push("double"),
  });

  await detector.press("pocket:1:4");
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(calls, ["single"]);
});

test("doble pulsación cancela la sencilla y ejecuta solo 10", async () => {
  const calls = [];
  const detector = createScorePadPressDetector({
    delayMs: 25,
    onSingle: () => calls.push("single"),
    onDouble: () => { calls.push("double"); return { score: 10 }; },
  });

  await detector.press("pocket:1:4");
  const result = await detector.press("pocket:1:4");
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(calls, ["double"]);
  assert.deepEqual(result, { kind: "double", result: { score: 10 } });
});
