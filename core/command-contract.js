"use strict";

const crypto = require("node:crypto");

const COMMAND_TYPES = Object.freeze([
  "FX_PLAY",
  "PAD_TRIGGER",
  "SCORE_SHOW",
  "MIDI_EVENT",
  "MIDI_START",
  "MIDI_STOP",
  "STATE_QUERY",
]);

const SOURCES = Object.freeze([
  "pc",
  "mobile",
  "android",
  "midi-pc",
  "midi-android",
  "showroom",
  "show-pad",
  "remote",
]);

const TARGETS = Object.freeze(["pc", "android", "local", "broadcast"]);

function createRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `show-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

/**
 * Converts the proposed payload contract to the legacy params/id_pad shape.
 * Existing commands are copied without changing their values.
 */
function normalizeCommand(command, { requestIdFactory = createRequestId } = {}) {
  if (!isPlainRecord(command)) return command;

  const payload = isPlainRecord(command.payload) ? command.payload : undefined;
  const legacyParams = isPlainRecord(command.params) ? command.params : {};
  const params = isPlainRecord(payload)
    ? { ...payload, ...legacyParams }
    : { ...legacyParams };

  const idPad = firstDefined(
    command.id_pad,
    payload?.effectId,
    payload?.padId !== undefined ? `pad-${payload.page ?? 1}-${payload.padId}` : undefined,
  );

  return {
    ...command,
    version: command.version ?? 1,
    requestId: command.requestId || requestIdFactory(),
    source: command.source ?? "pc",
    target: command.target ?? "local",
    id_pad: idPad,
    params,
  };
}

function validateCommand(command) {
  const errors = [];
  if (!isPlainRecord(command)) return { valid: false, errors: ["command must be an object"] };

  if (command.version !== 1) errors.push("version must be 1");
  if (typeof command.type !== "string" || !command.type) errors.push("type must be a non-empty string");
  else if (!COMMAND_TYPES.includes(command.type)) errors.push(`unsupported command type: ${command.type}`);

  if (typeof command.requestId !== "string" || !command.requestId.trim()) {
    errors.push("requestId must be a non-empty string");
  }
  if (typeof command.source !== "string" || !SOURCES.includes(command.source)) {
    errors.push(`source must be one of: ${SOURCES.join(", ")}`);
  }
  if (typeof command.target !== "string" || !TARGETS.includes(command.target)) {
    errors.push(`target must be one of: ${TARGETS.join(", ")}`);
  }
  if (!isPlainRecord(command.params)) errors.push("params must be an object");

  for (const field of ["id_pad", "id_song"]) {
    if (command[field] !== undefined && typeof command[field] !== "string") {
      errors.push(`${field} must be a string when present`);
    }
  }

  if (command.type === "PAD_TRIGGER") {
    const page = Number(command.params.page);
    const padId = Number(command.params.padId);
    if (!Number.isInteger(page) || page < 1) errors.push("params.page must be a positive integer");
    if (!Number.isInteger(padId) || padId < 1 || padId > 16) errors.push("params.padId must be an integer from 1 to 16");
  }

  if (command.type === "FX_PLAY" && command.id_pad === undefined && command.params.effectId === undefined) {
    errors.push("FX_PLAY requires id_pad or params.effectId");
  }

  return { valid: errors.length === 0, errors };
}

function validateAndNormalizeCommand(command, options) {
  const normalized = normalizeCommand(command, options);
  const validation = validateCommand(normalized);
  return { ...validation, command: normalized };
}

module.exports = {
  COMMAND_TYPES,
  SOURCES,
  TARGETS,
  createRequestId,
  isPlainRecord,
  normalizeCommand,
  validateCommand,
  validateAndNormalizeCommand,
};
