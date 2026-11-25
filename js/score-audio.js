(() => {
  const AUDIO_ROOT = "assets/audio/fx_califica";
  const REVEAL_SOUNDS = {
    6: [`${AUDIO_ROOT}/6_dun_dun_dun.mp3`, `${AUDIO_ROOT}/6_grillos.mp3`],
    7: [`${AUDIO_ROOT}/7_aww.mp3`, `${AUDIO_ROOT}/7_sad_music.mp3`, `${AUDIO_ROOT}/7_titanic_flauta.mp3`],
    8: [`${AUDIO_ROOT}/8_chiquillos.mp3`, `${AUDIO_ROOT}/8_risa_kid.mp3`],
    9: [`${AUDIO_ROOT}/9_ultrainstinto.mp3`, `${AUDIO_ROOT}/9_wow.mp3`],
    10: [`${AUDIO_ROOT}/10_aplusos.mp3`],
  };
  let spinAudio = null;
  let fxAudio = null;
  const activeRevealAudio = new Set();
  let scoreFadeFrame = null;
  let scoreFadeToken = 0;
  let scoreRevealCancelled = false;

  function play(path, onEnded, onMetadata) {
    const audio = new Audio(path);
    audio.addEventListener("ended", onEnded, { once: true });
    if (onMetadata) audio.addEventListener("loadedmetadata", () => onMetadata(audio), { once: true });
    audio.play().catch(() => {});
    return audio;
  }

  function cancelScoreFade() {
    scoreFadeToken += 1;
    if (scoreFadeFrame !== null) window.clearTimeout(scoreFadeFrame);
    scoreFadeFrame = null;
  }

  function stopScoreAudio() {
    cancelScoreFade();
    spinAudio?.pause();
    spinAudio = null;
    for (const audio of activeRevealAudio) {
      audio.pause();
      audio.volume = 0;
    }
    activeRevealAudio.clear();
  }

  function stopRevealAudio() {
    scoreRevealCancelled = true;
    for (const audio of activeRevealAudio) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0;
    }
    activeRevealAudio.clear();
  }

  function fadeOutSpinAudio(durationMs) {
    cancelScoreFade();
    const audios = spinAudio ? [spinAudio] : [];
    if (audios.length === 0) {
      window.showScoreAudio.reportScoreFadeComplete();
      return;
    }
    const token = scoreFadeToken;
    const initialVolumes = new Map(audios.map((audio) => [audio, audio.volume]));
    const startedAt = performance.now();
    const step = (now) => {
      if (token !== scoreFadeToken) return;
      const progress = Math.min(1, (now - startedAt) / durationMs);
      for (const audio of audios) audio.volume = initialVolumes.get(audio) * (1 - progress);
      if (progress < 1) {
        scoreFadeFrame = window.setTimeout(() => step(performance.now()), 16);
        return;
      }
      for (const audio of audios) {
        audio.pause();
        audio.volume = 0;
      }
      spinAudio = null;
      activeRevealAudio.clear();
      scoreFadeFrame = null;
      window.showScoreAudio.reportScoreFadeComplete();
    };
    scoreFadeFrame = window.setTimeout(() => step(performance.now()), 0);
  }

  window.showScoreAudio.onPlay(({ type, score, src, durationMs }) => {
    if (type === "fx") {
      fxAudio?.pause();
      fxAudio = play(src, () => { fxAudio = null; });
      return;
    }
    if (type === "spin") {
      stopScoreAudio();
      scoreRevealCancelled = false;
      spinAudio = play(`${AUDIO_ROOT}/ding_ding_ding_mezcla.mp3`, () => { spinAudio = null; });
      return;
    }
    if (type === "score-fade-out") {
      stopRevealAudio();
      fadeOutSpinAudio(Number.isFinite(durationMs) ? durationMs : 1_000);
      return;
    }
    if (type === "reveal" && REVEAL_SOUNDS[score]) {
      if (scoreRevealCancelled) return;
      spinAudio?.pause();
      spinAudio = null;
      const paths = REVEAL_SOUNDS[score];
      const audio = play(paths[Math.floor(Math.random() * paths.length)],
        () => activeRevealAudio.delete(audio),
        (selectedAudio) => {
          if (Number.isFinite(selectedAudio.duration)) {
            window.showScoreAudio.reportRevealDuration(score, Math.round(selectedAudio.duration * 1000));
          }
        });
      activeRevealAudio.add(audio);
    }
  });
})();
