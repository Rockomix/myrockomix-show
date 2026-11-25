"use strict";

const { resolveMidiNote } = require("./midi-profile-resolver.js");

function resolveAssignedMidiNote(payload, { devices = [], profiles = [] } = {}) {
  const deviceId = String(payload?.deviceId || "");
  const device = (Array.isArray(devices) ? devices : []).find((item) => item?.deviceId === deviceId);
  const profileId = String(payload?.profileId || device?.profileId || "");
  const profile = profiles.find((item) => item.profileId === profileId);
  const deviceName = profile?.displayName || profile?.model || payload?.deviceName;
  return resolveMidiNote({ deviceId, deviceName, note: Number(payload?.note) }, profiles);
}

function matchesScorePadAssignment(resolved, assignment) {
  return Boolean(resolved && assignment
    && resolved.profileId === assignment.profileId
    && Number(resolved.page) === Number(assignment.page)
    && Number(resolved.padId) === Number(assignment.padId));
}

module.exports = { resolveAssignedMidiNote, matchesScorePadAssignment };
