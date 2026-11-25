"use strict";

function createScorePadPressDetector({ delayMs = 350, onSingle, onDouble } = {}) {
  if (typeof onSingle !== "function" || typeof onDouble !== "function") {
    throw new TypeError("onSingle and onDouble must be functions");
  }

  let pending = null;

  function clearPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  }

  return {
    async press(key) {
      console.info("[MIDI TRACE] detector.press", { key, hasPending: Boolean(pending), delayMs });
      if (pending?.key === key) {
        clearPending();
        console.info("[MIDI TRACE] detector.double", { key });
        return { kind: "double", result: await onDouble(key) };
      }

      clearPending();
      const timer = setTimeout(() => {
        pending = null;
        console.info("[MIDI TRACE] detector.single.timer-fired", { key, delayMs });
        void Promise.resolve(onSingle(key)).catch((error) => {
          console.error("SHOW SCORE MIDI:", error);
        });
      }, delayMs);
      pending = { key, timer };
      return { kind: "pending" };
    },

    cancel() {
      clearPending();
    },
  };
}

module.exports = { createScorePadPressDetector };
