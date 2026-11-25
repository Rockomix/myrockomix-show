"use strict";

const { createRequestId } = require("./core/command-contract.js");
const { identifyMidiDevice, resolveMidiNote } = require("./core/midi-profile-resolver.js");

const MIDI_DIAGNOSTICS = true;

function midiTrace(stage, details) {
  if (MIDI_DIAGNOSTICS) console.info(`[MIDI TRACE] ${stage}`, details);
}

class PcMidiManager {
  constructor({ profiles = [], dispatch, preferredDeviceId = "", savePreferredDevice, onEvent } = {}) {
    if (typeof dispatch !== "function") throw new TypeError("dispatch must be a function");
    this.profiles = profiles;
    this.dispatch = dispatch;
    this.preferredDeviceId = String(preferredDeviceId || "");
    this.savePreferredDevice = typeof savePreferredDevice === "function" ? savePreferredDevice : () => {};
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.devices = new Map();
    this.selectedDeviceId = "";
    this.connectedDeviceId = "";
    this.state = "disabled";
    this.lastError = "";
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  getState() {
    return {
      enabled: this.state !== "disabled",
      state: this.state,
      preferredDeviceId: this.preferredDeviceId,
      selectedDeviceId: this.selectedDeviceId,
      connectedDeviceId: this.connectedDeviceId,
      lastError: this.lastError || undefined,
      devices: [...this.devices.values()],
    };
  }

  setEnabled(enabled) {
    this.state = enabled ? "ready" : "disabled";
    if (!enabled) {
      this.selectedDeviceId = "";
      this.connectedDeviceId = "";
    }
    this.emit();
  }

  updateDevices(deviceList = []) {
    midiTrace("manager.updateDevices", { deviceList });
    this.devices.clear();
    for (const input of Array.isArray(deviceList) ? deviceList : []) {
      const deviceId = String(input?.deviceId ?? input?.id ?? "");
      if (!deviceId) continue;
      const deviceName = String(input?.deviceName ?? input?.name ?? "");
      const manufacturer = String(input?.manufacturer ?? "");
      const identity = identifyMidiDevice({ deviceId, deviceName, manufacturer }, this.profiles);
      this.devices.set(deviceId, {
        deviceId,
        deviceName,
        deviceNameOriginal: String(input?.deviceNameOriginal ?? deviceName),
        manufacturer,
        transport: String(input?.transport || "midi"),
        profileId: identity?.profileId,
        profileName: identity?.profileName,
        identified: Boolean(identity),
        connected: input?.connected === true,
        state: input?.state || "connected",
      });
    }

    if (this.connectedDeviceId && !this.devices.has(this.connectedDeviceId)) {
      this.connectedDeviceId = "";
      this.state = this.state === "disabled" ? "disabled" : "disconnected";
    }
    this.emit();
    return this.getPreferredDevice();
  }

  getPreferredDevice() {
    if (!this.preferredDeviceId) return null;
    return this.devices.get(this.preferredDeviceId) || null;
  }

  chooseDevice(deviceId, { persist = true } = {}) {
    const id = String(deviceId || "");
    const device = this.devices.get(id);
    if (!device) return { accepted: false, error: "MIDI device is not available.", deviceId: id };
    if (!device.identified) return { accepted: false, error: "MIDI device has no compatible profile.", deviceId: id };
    this.selectedDeviceId = id;
    if (persist) {
      this.preferredDeviceId = id;
      this.savePreferredDevice(id);
    }
    this.lastError = "";
    this.emit();
    return { accepted: true, device: { ...device } };
  }

  markConnected(deviceId) {
    const id = String(deviceId || "");
    const device = this.devices.get(id);
    if (!device) {
      midiTrace("manager.markConnected.discard", { deviceId: id, reason: "device-not-listed" });
      return { accepted: false, error: "MIDI device is not available.", deviceId: id };
    }
    if (!device.identified) {
      midiTrace("manager.markConnected.discard", { deviceId: id, device, reason: "profile-not-identified" });
      return { accepted: false, error: "MIDI device has no compatible profile.", deviceId: id };
    }
    if (this.connectedDeviceId && this.connectedDeviceId !== id) {
      return { accepted: false, error: "Another MIDI device is already connected.", deviceId: this.connectedDeviceId };
    }
    this.selectedDeviceId = id;
    this.connectedDeviceId = id;
    this.state = "connected";
    this.lastError = "";
    this.emit();
    midiTrace("manager.markConnected.accept", { deviceId: id, device, state: this.getState() });
    return { accepted: true, device: { ...device } };
  }

  markDisconnected(deviceId, error = "") {
    const id = String(deviceId || this.connectedDeviceId || "");
    if (this.connectedDeviceId === id) this.connectedDeviceId = "";
    this.state = this.state === "disabled" ? "disabled" : "disconnected";
    this.lastError = String(error || "");
    this.emit();
    midiTrace("manager.markDisconnected", { deviceId: id, error, state: this.getState() });
    return { accepted: true, connected: false, deviceId: id };
  }

  async handleMidiMessage(payload = {}, { skipPadDispatch = false } = {}) {
    const deviceId = String(payload.deviceId || "");
    midiTrace("manager.receive", {
      payload,
      skipPadDispatch,
      activeDeviceId: this.connectedDeviceId,
      activeDevice: this.devices.get(this.connectedDeviceId),
    });
    if (!deviceId || !this.connectedDeviceId || this.connectedDeviceId !== deviceId) {
      midiTrace("manager.discard", { reason: "deviceId-not-active", payloadDeviceId: deviceId, activeDeviceId: this.connectedDeviceId });
      return { accepted: false, ignored: true, error: "MIDI device is not the active device." };
    }

    const status = Number(payload.status) & 0xff;
    const command = status & 0xf0;
    const velocity = Number(payload.velocity) || 0;
    const channel = (status & 0x0f) + 1;
    const eventType = command === 0x80 || (command === 0x90 && velocity <= 0)
      ? "note-off"
      : command === 0x90
        ? "note-on"
        : command === 0xb0
          ? "control-change"
          : command === 0xa0
            ? "poly-aftertouch"
            : command === 0xc0
              ? "program-change"
              : command === 0xd0
                ? "channel-aftertouch"
                : command === 0xe0
                  ? "pitch-bend"
                  : "other";
    const identity = identifyMidiDevice({
      deviceId,
      deviceName: payload.deviceName,
      manufacturer: payload.manufacturer,
    }, this.profiles);
    midiTrace("manager.identity", { deviceId, deviceName: payload.deviceName, profileId: identity?.profileId, profileName: identity?.profileName, status, command, velocity, note: payload.note, data1: payload.data1, data2: payload.data2 });
    this.onEvent({
      ...payload,
      status,
      channel,
      eventType,
      profileId: identity?.profileId,
      profileName: identity?.profileName,
      data1: Number(payload.data1 ?? payload.note ?? 0),
      data2: Number(payload.data2 ?? payload.velocity ?? 0),
    });
    if (skipPadDispatch || command !== 0x90 || velocity <= 0) {
      midiTrace("manager.discard", { reason: skipPadDispatch ? "skip-pad-dispatch" : command !== 0x90 ? "not-note-on" : "velocity-not-positive", eventType, note: payload.note, velocity });
      return { accepted: false, ignored: true };
    }

    const resolved = resolveMidiNote({
      deviceId,
      deviceName: payload.deviceName,
      note: Number(payload.note),
    }, this.profiles);
    if (!resolved) {
      midiTrace("manager.discard", { reason: "note-unmapped", deviceId, deviceName: payload.deviceName, profileId: identity?.profileId, note: payload.note });
      return { accepted: false, error: "MIDI note has no compatible profile mapping." };
    }
    midiTrace("manager.pad-resolved", { deviceId, profileId: resolved.profileId, page: resolved.page, padId: resolved.padId, note: payload.note });

    const result = await this.dispatch({
      type: "PAD_TRIGGER",
      id_pad: `pad-${resolved.page}-${resolved.padId}`,
      source: "midi-pc",
      target: "pc",
      params: {
        ...resolved,
        channel: (status & 0x0f) + 1,
        note: Number(payload.note),
        velocity,
        deviceId,
        deviceName: String(payload.deviceName || ""),
        manufacturer: String(payload.manufacturer || ""),
        origin: "midi",
      },
      requestId: payload.requestId || createRequestId(),
    });
    midiTrace("manager.pad-dispatch-result", { result, page: resolved.page, padId: resolved.padId });
    return result;
  }
}

module.exports = { PcMidiManager };
