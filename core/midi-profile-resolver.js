"use strict";

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  // Keep the Electron loader's special Pocket matcher: the broad JSON matcher
  // must not make a plain "SMC-PAD" port look like the Pocket profile.
  const pattern = profile.profileId === "m-vave-smc-pad-pocket"
    ? "smc[\\s-]*pad[\\s-]*pocket"
    : String(profile.match?.nameRegex || "").replace(/^\(\?i\)/, "");
  return {
    ...profile,
    _namePattern: pattern ? new RegExp(pattern, "i") : null,
  };
}

function normalizeProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .map(normalizeProfile)
    .filter(Boolean)
    .sort((a, b) => Number(/pocket/i.test(b.profileId)) - Number(/pocket/i.test(a.profileId)));
}

function profileDisplayName(profile) {
  if (profile?.profileId === "m-vave-smc-pad-pocket") return "SMC-PAD POCKET";
  return String(profile?.displayName || profile?.model || profile?.profileId || "");
}

function findMidiProfile({ deviceName = "", deviceId = "" } = {}, profiles) {
  const normalized = normalizeProfiles(profiles);
  const matches = normalized.filter((profile) => profile._namePattern?.test(String(deviceName)));
  return matches.length === 1 ? matches[0] : null;
}

function identifyMidiDevice({ deviceId = "", deviceName = "", manufacturer = "" } = {}, profiles) {
  const profile = findMidiProfile({ deviceId, deviceName }, profiles);
  if (!profile) return null;
  return {
    deviceId: String(deviceId),
    deviceName: String(deviceName),
    manufacturer: String(manufacturer),
    profileId: profile.profileId,
    profileName: profileDisplayName(profile),
  };
}

function resolveMidiNote({ deviceName = "", deviceId = "", note } = {}, profiles) {
  const profile = findMidiProfile({ deviceName, deviceId }, profiles);
  const numericNote = Number(note);
  if (!profile || !Number.isInteger(numericNote)) return null;

  const mapping = profile.padMapping;
  if (!mapping) return null;

  if (mapping.strategy === "banked-note-range") {
    const firstNote = Number(mapping.firstBankFirstNote);
    const padsPerBank = Number(mapping.padsPerBank);
    const bankCount = Number(mapping.bankCount);
    const offset = Number(mapping.notesPerBankOffset || padsPerBank);
    const delta = numericNote - firstNote;
    if (!Number.isInteger(delta) || delta < 0 || delta >= bankCount * offset || padsPerBank < 1) return null;
    const bank = Math.floor(delta / offset);
    const padId = (delta % offset) + 1;
    return { profileId: profile.profileId, profileName: profileDisplayName(profile), page: bank + 1, padId, bank: bank + 1 };
  }

  if (mapping.strategy === "profile-defined-midi-map") {
    const notes = mapping.firstBank?.pad01ToPad16Notes || [];
    const index = notes.indexOf(numericNote);
    if (index < 0) return null;
    return { profileId: profile.profileId, profileName: profileDisplayName(profile), page: 1, padId: index + 1, bank: 1 };
  }

  return null;
}

module.exports = {
  normalizeProfile,
  normalizeProfiles,
  profileDisplayName,
  findMidiProfile,
  identifyMidiDevice,
  resolveMidiNote,
};
