/* Lógica SCORE original de Party reutilizable por el ENGINE local. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShowScoreCore = api;
})(typeof window === "undefined" ? null : window, () => {
  const RATING_PHRASES = Object.freeze({
    6: ["¡La intención estuvo en tono!", "¡El sentimiento estuvo; la afinación anda de vacaciones!", "¡Eso fue valiente y con mucho corazón!"],
    7: ["¡Una más y te fichamos!", "¡Ya se empieza a escuchar el contrato!", "¡Eso va tomando forma de estrella!"],
    8: ["¡Ya casi le quitas el puesto al original!", "¡Eso ya suena a edición de lujo!", "¡La estrella está calentando motores!"],
    9: ["¡Eso ya son palabras mayores!", "¡El original acaba de ponerse nervioso!", "¡Aquí hay nivel, aplausos!"],
    10: ["¡Woooow! ¡Ya te está buscando Universal Music!", "¡Señoras y señores, tenemos estrella!", "¡Ese diez viene con ovación incluida!"],
  });

  function randomUint32() {
    if (!globalThis.crypto?.getRandomValues) throw new Error("crypto.getRandomValues no está disponible.");
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }

  function randomBelow(limit) {
    const range = 0x1_0000_0000;
    const threshold = range - (range % limit);
    let value = randomUint32();
    while (value >= threshold) value = randomUint32();
    return value % limit;
  }

  function generateRatingScore() {
    const bucket = randomBelow(10_000);
    if (bucket < 500) return 6;
    if (bucket < 2_000) return 7;
    if (bucket < 4_000) return 8;
    if (bucket < 6_500) return 9;
    return 10;
  }

  function isRatingScore(value) {
    return Number.isInteger(value) && value >= 6 && value <= 10;
  }

  function chooseRatingPhrase(score) {
    return RATING_PHRASES[score][randomBelow(RATING_PHRASES[score].length)];
  }

  return { RATING_PHRASES, randomBelow, generateRatingScore, isRatingScore, chooseRatingPhrase };
});
