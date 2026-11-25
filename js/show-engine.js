/* Contrato local compartido por los módulos SHOW. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ShowEngine = api;
})(typeof window === "undefined" ? null : window, () => {
  const MAX_SEEN_REQUESTS = 100;

  function createRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `show-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isPlainRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function validateShowCommand(command) {
    if (!isPlainRecord(command) || typeof command.type !== "string" || !command.type) {
      return "El comando requiere un type válido.";
    }
    for (const field of ["id_pad", "id_song", "requestId"]) {
      if (command[field] !== undefined && typeof command[field] !== "string") {
        return `${field} debe ser texto cuando esté presente.`;
      }
    }
    if (command.source !== undefined && command.source !== "pc" && command.source !== "mobile") {
      return "source debe ser pc o mobile.";
    }
    if (command.params !== undefined && !isPlainRecord(command.params)) {
      return "params debe ser un objeto.";
    }
    return null;
  }

  class LocalShowEngine {
    #handlers = new Map();
    #seenRequests = new Map();

    register(type, handler) {
      this.#handlers.set(type, handler);
    }

    async dispatch(command) {
      const validationError = validateShowCommand(command);
      if (validationError) return { accepted: false, error: validationError };
      const normalized = { ...command, requestId: command.requestId || createRequestId(), params: command.params || {} };
      if (this.#seenRequests.has(normalized.requestId)) {
        return { accepted: false, error: "Solicitud duplicada." };
      }
      this.#seenRequests.set(normalized.requestId, true);
      if (this.#seenRequests.size > MAX_SEEN_REQUESTS) {
        this.#seenRequests.delete(this.#seenRequests.keys().next().value);
      }
      const handler = this.#handlers.get(normalized.type);
      return handler
        ? handler(normalized)
        : { accepted: false, error: `No existe un módulo para ${normalized.type}.` };
    }
  }

  return { LocalShowEngine, createRequestId, validateShowCommand };
});
