(() => {
  "use strict";

  const REVEAL_AT = 4_000;
  const SPIN_HIT_TIMES = [68, 298, 530, 706, 878, 1059, 1238, 1417, 1590, 1775, 2041, 2339, 2628, 2965, 3414];

  class ScoreController {
    constructor(elements) {
      this.elements = elements;
      this.active = false;
      this.timers = [];
    }

    start(result) {
      this.clearTimers();
      this.active = true;
      // Reloj monotónico local ajustado a la marca de tiempo del ENGINE.
      this.startedAt = performance.now() - Math.max(0, Date.now() - result.startedAt);
      this.result = result;
      this.elements.overlay.classList.add("is-visible", "is-spinning");
      this.elements.overlay.setAttribute("aria-hidden", "false");
      this.elements.number.textContent = "1";
      this.elements.phrase.textContent = result.phrase;
      this.elements.phrase.hidden = true;
      this.elements.singer.textContent = `Calificación de ${result.singerName || "la interpretación"}`;
      this.elements.song.textContent = result.title || "";
      this.elements.song.hidden = !result.title;
      this.elements.confetti.replaceChildren();
      for (const hitAt of SPIN_HIT_TIMES) this.scheduleAt(hitAt, () => this.renderSpinValue());
      this.scheduleAt(REVEAL_AT, () => this.reveal());
    }

    scheduleAt(targetMs, callback) {
      const delay = Math.max(0, targetMs - (performance.now() - this.startedAt));
      const timer = window.setTimeout(() => {
        this.timers = this.timers.filter((id) => id !== timer);
        callback();
      }, delay);
      this.timers.push(timer);
    }

    renderSpinValue() {
      if (!this.active || performance.now() - this.startedAt >= REVEAL_AT) return;
      const elapsed = performance.now() - this.startedAt;
      const completedHits = SPIN_HIT_TIMES.filter((hitAt) => hitAt <= elapsed).length;
      this.elements.number.textContent = String(1 + (completedHits % 10));
    }

    reveal() {
      if (!this.active) return;
      this.elements.number.textContent = String(this.result.score);
      this.elements.phrase.hidden = false;
      this.elements.overlay.classList.remove("is-spinning");
      this.elements.overlay.classList.add("is-revealed");
      window.showScorePresentation.playRevealAudio(this.result.score);
      if (this.result.score === 10) this.fireConfetti();
    }

    clearTimers() {
      this.timers.forEach((timer) => window.clearTimeout(timer));
      this.timers = [];
    }

    fireConfetti() {
      const colors = ["#fff2a8", "#ff6eb6", "#6ee7ff", "#bba2ff", "#ffffff"];
      for (let index = 0; index < 52; index += 1) {
        const piece = document.createElement("i");
        piece.style.setProperty("--x", `${Math.round((Math.random() - 0.5) * 90)}vw`);
        piece.style.setProperty("--delay", `${Math.round(Math.random() * 220)}ms`);
        piece.style.setProperty("--color", colors[index % colors.length]);
        this.elements.confetti.append(piece);
      }
    }
  }

  const controller = new ScoreController({
    overlay: document.querySelector("#score-overlay"),
    number: document.querySelector("#score-number"),
    phrase: document.querySelector("#score-phrase"),
    singer: document.querySelector("#score-singer"),
    song: document.querySelector("#score-song"),
    confetti: document.querySelector("#score-confetti"),
  });

  window.showScorePresentation.onStart((result) => controller.start(result));
  window.showScorePresentation.onStop(() => {
    controller.clearTimers();
    controller.active = false;
    controller.elements.overlay.classList.remove("is-spinning");
  });
})();
