"use strict";

const {
  createRequestId,
  validateAndNormalizeCommand,
} = require("./command-contract.js");

class EngineCore {
  constructor({ maxSeenRequests = 100, requestIdFactory = createRequestId } = {}) {
    this.maxSeenRequests = maxSeenRequests;
    this.requestIdFactory = requestIdFactory;
    this.handlers = new Map();
    this.seenRequests = new Map();
  }

  register(type, handler) {
    if (typeof type !== "string" || !type) throw new TypeError("type must be a non-empty string");
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.handlers.set(type, handler);
    return this;
  }

  clearSeenRequests() {
    this.seenRequests.clear();
  }

  hasSeenRequest(requestId) {
    return this.seenRequests.has(requestId);
  }

  rememberRequest(requestId) {
    this.seenRequests.set(requestId, true);
    while (this.seenRequests.size > this.maxSeenRequests) {
      this.seenRequests.delete(this.seenRequests.keys().next().value);
    }
  }

  async dispatch(command) {
    const result = validateAndNormalizeCommand(command, { requestIdFactory: this.requestIdFactory });
    if (!result.valid) {
      return { accepted: false, error: "Invalid command.", details: result.errors, command: result.command };
    }

    const normalized = result.command;
    if (this.hasSeenRequest(normalized.requestId)) {
      return { accepted: false, error: "Duplicate request.", requestId: normalized.requestId };
    }
    this.rememberRequest(normalized.requestId);

    const handler = this.handlers.get(normalized.type);
    if (!handler) {
      return { accepted: false, error: `No handler registered for ${normalized.type}.`, requestId: normalized.requestId };
    }

    try {
      const handlerResult = await handler(normalized);
      return handlerResult === undefined
        ? { accepted: true, requestId: normalized.requestId }
        : handlerResult;
    } catch (error) {
      return {
        accepted: false,
        error: "Handler execution failed.",
        requestId: normalized.requestId,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

module.exports = { EngineCore };
