/*
 * NORMAL y MINI comparten los mismos controles. MINI oculta solo los textos
 * de identificación y también se activa al reducir manualmente la ventana.
 */
const modeToggle = document.querySelector('#mode-toggle');
const modeSizes = {
  normal: { width: 300, height: 500 },
  mini: { width: 200, height: 480 },
};
let currentMode = 'normal';
const compactWidth = 240;

function applyMode(mode, requestResize = true) {
  currentMode = mode;
  const nextMode = mode === 'normal' ? 'mini' : 'normal';

  document.documentElement.dataset.showMode = mode;
  modeToggle.textContent = nextMode.toUpperCase();
  modeToggle.setAttribute('aria-label', `Cambiar a modo ${nextMode.toUpperCase()}`);
  window.dispatchEvent(new Event('show-mode-change'));

  if (requestResize) {
    // Chromium puede ignorar resizeTo en ventanas no abiertas por script.
    // En ese caso se conserva el cambio de etiqueta sin falsear el tamano.
    try {
      window.resizeTo(modeSizes[mode].width, modeSizes[mode].height);
    } catch {
      // El navegador mantiene el tamano actual.
    }
  }
}

modeToggle.addEventListener('click', () => {
  applyMode(currentMode === 'normal' ? 'mini' : 'normal');
});

async function sendScoreCommand(score) {
  if (!window.showHost?.dispatchCommand) return;

  await window.showHost.dispatchCommand({
    type: 'SCORE_SHOW',
    id_pad: 'score',
    params: score === undefined ? {} : { score },
    source: 'pc',
    requestId: crypto.randomUUID?.() ?? `show-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
}

document.querySelector('#open-score-window')?.addEventListener('click', () => {
  void sendScoreCommand();
});

document.querySelector('#open-score-window-ten')?.addEventListener('click', () => {
  void sendScoreCommand(10);
});

async function sendFxCommand() {
  if (!window.showHost?.dispatchCommand) return;

  await window.showHost.dispatchCommand({
    type: 'FX_PLAY',
    id_pad: 'kikekaraoke-envivo',
    params: {},
    source: 'pc',
    requestId: crypto.randomUUID?.() ?? `show-fx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  });
}

document.querySelector('#play-fx')?.addEventListener('click', () => {
  void sendFxCommand();
});

const fxFileInput = document.querySelector('#fx-file-input');
const fxAssignedButton = document.querySelector('.button-fx-assigned');

fxAssignedButton?.addEventListener('click', () => {
  if (window.showHost?.openShowPad) {
    void window.showHost.openShowPad();
    return;
  }

  // Fallback para la versión web del SHOWROOM, fuera de Electron.
  fxFileInput?.click();
});

function syncModeWithViewport() {
  const isCompact = window.innerWidth <= compactWidth;
  document.documentElement.dataset.compactWidth = String(isCompact);

  // El redimensionamiento manual tiene prioridad para recuperar los textos
  // cuando vuelve a existir espacio suficiente.
  if (isCompact && currentMode !== 'mini') {
    applyMode('mini', false);
  } else if (!isCompact && currentMode !== 'normal') {
    applyMode('normal', false);
  }
}

window.addEventListener('resize', syncModeWithViewport);
syncModeWithViewport();

// ── PUENTE WEB MIDI PC: SHOWROOM recibe MIDI y entrega el mensaje crudo a ENGINE.
// SHOWROOM no traduce notas ni ejecuta FX/calificaciones; ENGINE decide la acción.
const midiToggle = document.querySelector('#midi-toggle');
const midiDeviceSelect = document.querySelector('#midi-device');
const midiHint = document.querySelector('#midi-hint');
const midiMonitor = document.querySelector('#midi-monitor');
const scorePadAssignButton = document.querySelector('#assign-score-pad');
const midiMonitorLines = [];
const midiDevicePicker = document.createElement('div');
const midiDeviceTrigger = document.createElement('button');
const midiDeviceMenu = document.createElement('div');
let midiDevicePickerOpen = false;
let scorePadAssignmentMode = false;

function isMidiActuallyConnected() {
  return Boolean(
    pcMidiEnabled
    && (Boolean(pcMidiInput) || pcBleDevice?.gatt?.connected === true),
  );
}

async function refreshScorePadAssignmentUi() {
  const active = isMidiActuallyConnected();
  if (scorePadAssignButton) scorePadAssignButton.disabled = !active;
  if (!active && scorePadAssignmentMode) {
    scorePadAssignmentMode = false;
    void window.showHost?.cancelScorePadAssignment?.();
    if (scorePadAssignButton) scorePadAssignButton.textContent = '🎹 ASIGNAR PADS';
  }
  try {
    // La asignaciÃ³n se conserva internamente; no se muestra como texto redundante.
  } catch (error) {
    console.warn('SHOWROOM: no se pudo leer la asignación de CALIFICAR.', error);
  }
}

scorePadAssignButton?.addEventListener('click', async () => {
  if (scorePadAssignmentMode) {
    scorePadAssignmentMode = false;
    await window.showHost?.cancelScorePadAssignment?.();
    scorePadAssignButton.textContent = '🎹 ASIGNAR PADS';
    return;
  }
  if (scorePadAssignButton.disabled) return;
  const result = await window.showHost?.beginScorePadAssignment?.();
  if (!result?.accepted) {
    console.warn('SHOWROOM: no se pudo iniciar la asignación MIDI.', result?.error);
    return;
  }
  scorePadAssignmentMode = true;
  scorePadAssignButton.textContent = '🎹 ASIGNAR PADS';
});

function midiEventLabel(event) {
  const type = event?.eventType || 'other';
  const channel = String(Number(event?.channel) || 1).padStart(2, '0');
  const data1 = String(Number(event?.data1 ?? event?.note) || 0).padStart(3, '0');
  const data2 = String(Number(event?.data2 ?? event?.velocity) || 0).padStart(3, '0');
  if (type === 'note-on') return `NOTE ON  CH ${channel}  NOTE ${data1}  VEL ${data2}`;
  if (type === 'note-off') return `NOTE OFF CH ${channel}  NOTE ${data1}  VEL ${data2}`;
  if (type === 'control-change') return `CC       CH ${channel}  CTRL ${data1}  VALUE ${data2}`;
  if (type === 'program-change') return `PROGRAM  CH ${channel}  PROG ${data1}`;
  if (type === 'pitch-bend') return `PITCH    CH ${channel}  VALUE ${data1}${data2}`;
  if (type === 'poly-aftertouch') return `POLY AT  CH ${channel}  NOTE ${data1}  VALUE ${data2}`;
  if (type === 'channel-aftertouch') return `CH AT    CH ${channel}  VALUE ${data1}`;
  return `MIDI     CH ${channel}  DATA ${data1}  VALUE ${data2}`;
}

function midiMonitorVisibleLines() {
  if (document.documentElement.dataset.showMode === 'mini') return 0;
  return window.innerWidth >= 600 ? 6 : 2;
}

function renderMidiMonitor() {
  if (!midiMonitor) return;
  const visibleCount = midiMonitorVisibleLines();
  midiMonitor.hidden = visibleCount === 0;
  if (visibleCount === 0) return;
  const visibleLines = midiMonitorLines.slice(-visibleCount);
  midiMonitor.style.setProperty('--midi-monitor-lines', String(visibleCount));
  midiMonitor.style.setProperty('--midi-monitor-height', visibleCount === 6 ? '6.9rem' : '2.8rem');
  midiMonitor.replaceChildren();
  for (const item of visibleLines) {
    const line = document.createElement('div');
    const kind = item.label.startsWith('NOTE ON') ? 'on' : item.label.startsWith('NOTE OFF') ? 'off' : item.label.startsWith('CC') ? 'cc' : 'other';
    line.className = `midi-monitor-line midi-monitor-${kind}`;
    line.textContent = item.identity ? `${item.label} · ${item.identity}` : item.label;
    line.title = line.textContent;
    midiMonitor.append(line);
  }
}

function appendMidiMonitorEvent(event) {
  if (!midiMonitor) return;
  const identity = [event?.profileName, event?.deviceId].filter(Boolean).join(' · ');
  midiMonitorLines.push({ label: midiEventLabel(event), identity });
  renderMidiMonitor();
  return;
  midiMonitor.replaceChildren();
  for (const item of midiMonitorLines) {
    const line = document.createElement('div');
    const kind = item.label.startsWith('NOTE ON') ? 'on' : item.label.startsWith('NOTE OFF') ? 'off' : item.label.startsWith('CC') ? 'cc' : 'other';
    line.className = `midi-monitor-line midi-monitor-${kind}`;
    line.textContent = item.identity ? `${item.label} · ${item.identity}` : item.label;
    line.title = line.textContent;
    midiMonitor.append(line);
  }
}

window.showHost?.onMidiEvent?.(appendMidiMonitorEvent);
window.addEventListener('resize', renderMidiMonitor);
window.addEventListener('show-mode-change', renderMidiMonitor);
renderMidiMonitor();

function closeMidiDevicePicker() {
  midiDevicePickerOpen = false;
  midiDeviceMenu.hidden = true;
  midiDevicePicker.classList.remove('is-open');
  midiDeviceTrigger.setAttribute('aria-expanded', 'false');
}

function positionMidiDevicePicker() {
  if (!midiDevicePickerOpen) return;
  const bounds = midiDeviceTrigger.getBoundingClientRect();
  const menuWidth = Math.min(280, Math.max(220, bounds.width));
  const margin = 10;
  const maxHeight = Math.max(150, Math.min(300, window.innerHeight - margin * 2));
  const spaceBelow = window.innerHeight - bounds.bottom - margin;
  const openAbove = spaceBelow < 190 && bounds.top - margin > spaceBelow;
  const left = Math.min(Math.max(margin, bounds.left), Math.max(margin, window.innerWidth - menuWidth - margin));
  const top = openAbove
    ? Math.max(margin, bounds.top - Math.min(maxHeight, 300))
    : Math.min(window.innerHeight - margin - Math.min(maxHeight, 300), bounds.bottom + 6);
  midiDeviceMenu.style.left = `${left}px`;
  midiDeviceMenu.style.top = `${top}px`;
  midiDeviceMenu.style.width = `${menuWidth}px`;
  midiDeviceMenu.style.maxHeight = `${maxHeight}px`;
}

function renderMidiDevicePicker() {
  if (!midiDeviceSelect) return;
  midiDeviceMenu.innerHTML = '';
  [...midiDeviceSelect.options].forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'midi-device-option';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.classList.toggle('is-selected', option.value === midiDeviceSelect.value);
    item.setAttribute('aria-selected', String(option.value === midiDeviceSelect.value));
    item.addEventListener('click', () => {
      midiDeviceSelect.value = option.value;
      midiDeviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      closeMidiDevicePicker();
      renderMidiDevicePicker();
    });
    midiDeviceMenu.append(item);
  });
  const selected = midiDeviceSelect.selectedOptions[0];
  midiDeviceTrigger.querySelector('.midi-device-value').textContent = selected?.textContent || 'Selecciona dispositivo MIDI';
  midiDeviceTrigger.disabled = midiDeviceSelect.disabled;
}

if (midiDeviceSelect) {
  midiDevicePicker.className = 'midi-device-picker';
  midiDeviceTrigger.type = 'button';
  midiDeviceTrigger.className = 'midi-device-trigger';
  midiDeviceTrigger.setAttribute('aria-haspopup', 'listbox');
  midiDeviceTrigger.setAttribute('aria-expanded', 'false');
  midiDeviceTrigger.innerHTML = '<span class="midi-device-value"></span><span class="midi-device-chevron" aria-hidden="true">⌄</span>';
  midiDeviceMenu.className = 'midi-device-menu';
  midiDeviceMenu.setAttribute('role', 'listbox');
  midiDeviceMenu.hidden = true;
  midiDevicePicker.append(midiDeviceTrigger);
  midiDeviceSelect.classList.add('midi-device-native');
  midiDeviceSelect.setAttribute('aria-hidden', 'true');
  midiDeviceSelect.tabIndex = -1;
  midiDeviceSelect.parentElement.insertBefore(midiDevicePicker, midiDeviceSelect);
  midiDeviceSelect.parentElement.querySelector('label[for="midi-device"]')?.setAttribute('for', 'midi-device-trigger');
  document.body.append(midiDeviceMenu);
  midiDeviceTrigger.addEventListener('click', () => {
    midiDevicePickerOpen = !midiDevicePickerOpen;
    midiDeviceMenu.hidden = !midiDevicePickerOpen;
    midiDevicePicker.classList.toggle('is-open', midiDevicePickerOpen);
    midiDeviceTrigger.setAttribute('aria-expanded', String(midiDevicePickerOpen));
    if (midiDevicePickerOpen) {
      renderMidiDevicePicker();
      positionMidiDevicePicker();
    }
  });
  document.addEventListener('click', event => {
    if (midiDevicePickerOpen && !midiDevicePicker.contains(event.target) && !midiDeviceMenu.contains(event.target)) closeMidiDevicePicker();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMidiDevicePicker();
  });
  window.addEventListener('resize', positionMidiDevicePicker);
  window.addEventListener('scroll', positionMidiDevicePicker, true);
  renderMidiDevicePicker();
}
let pcMidiAccess = null;
let pcMidiInput = null;
let pcMidiEnabled = false;
let pcMidiInitialized = false;
let physicalMidiInventory = [];
let physicalMidiInventoryReady = false;
const MIDI_DEVICE_KEY = 'myrockomix-show-pc-midi-device';
const BLE_POCKET_NAME = 'SMC-PAD Pocket-Bt';
const BLE_POCKET_PROFILE_ID = 'm-vave-smc-pad-pocket';
const BLE_POCKET_PROFILE_NAME = 'SMC-PAD POCKET';
const BLE_MIXER_NAME = 'SMC-Mixer-Bt';
const BLE_MIXER_PROFILE_ID = 'm-vave-smc-mixer';
const BLE_MIXER_PROFILE_NAME = 'SMC-Mixer';
const BLE_DEVICE_DEFINITIONS = [
  { name: BLE_POCKET_NAME, profileId: BLE_POCKET_PROFILE_ID, profileName: BLE_POCKET_PROFILE_NAME, pattern: /^smc[\s-]*pad[\s-]*pocket(?:[\s-]*bt)?$/i },
  { name: BLE_MIXER_NAME, profileId: BLE_MIXER_PROFILE_ID, profileName: BLE_MIXER_PROFILE_NAME, pattern: /^smc[\s-]*mixer(?:[\s-]*bt)?$/i },
];
let rememberedPcMidiId = '';
let pcBleDevice = null;
let pcBleAuthorizedDevices = [];
let pcBleCharacteristic = null;
let pcBleListener = null;
let pcBleDisconnectListener = null;
let pcBleConnectPromise = null;
let pcBleReconnectTimer = null;
let pcBleReconnectAttempt = 0;
let pcBleManualDisconnect = false;
const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';
try { rememberedPcMidiId = localStorage.getItem(MIDI_DEVICE_KEY) || ''; } catch {}

function setPcMidiUi(active, message) {
  pcMidiEnabled = active;
  midiToggle?.classList.toggle('is-active', active);
  midiToggle?.setAttribute('aria-pressed', String(active));
  const label = midiToggle?.querySelector('strong');
  if (label) label.textContent = active ? 'DESCONECTAR' : 'INICIAR';
  setMidiConnectionLabel(active);
}

function setMidiConnectionLabel(connected) {
  if (midiHint) midiHint.textContent = connected ? 'CONECTADO' : 'DESCONECTADO';
}

function detachPcMidiInput() {
  const detachedInput = pcMidiInput;
  if (detachedInput) detachedInput.onmidimessage = null;
  pcMidiInput = null;
  if (detachedInput) {
    void window.showHost?.reportMidiConnection?.({
      deviceId: detachedInput.id,
      connected: false,
      error: 'MIDI DESACTIVADO',
    });
  }
  void refreshScorePadAssignmentUi();
}

async function disconnectPcBleMidi() {
  const disconnectedDeviceId = pcBleDevice ? `ble:${pcBleDevice.id}` : '';
  pcBleManualDisconnect = true;
  if (pcBleReconnectTimer) {
    clearTimeout(pcBleReconnectTimer);
    pcBleReconnectTimer = null;
  }
  if (pcBleCharacteristic && pcBleListener) {
    try { pcBleCharacteristic.removeEventListener('characteristicvaluechanged', pcBleListener); } catch {}
    try { await pcBleCharacteristic.stopNotifications(); } catch {}
  }
  if (pcBleDevice && pcBleDisconnectListener) {
    try { pcBleDevice.removeEventListener('gattserverdisconnected', pcBleDisconnectListener); } catch {}
  }
  if (pcBleDevice?.gatt?.connected) pcBleDevice.gatt.disconnect();
  pcBleDevice = null;
  pcBleCharacteristic = null;
  pcBleListener = null;
  pcBleDisconnectListener = null;
  if (disconnectedDeviceId) {
    window.showHost?.reportMidiConnection?.({
      deviceId: disconnectedDeviceId,
      connected: false,
    });
  }
  void refreshScorePadAssignmentUi();
}

function normalizeMidiDeviceName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isPocketConnectorInput(input) {
  return /^smc[\s-]*pad[\s-]*pocket(?:[\s-]*bt)?(?:\s*\(.*\))?$/i.test(String(input?.name || '').trim())
    || /^bomes*midi.*smc[\s-]*pad[\s-]*pocket/i.test(String(input?.name || '').trim());
}

function availablePcMidiInputs() {
  if (!pcMidiAccess || !physicalMidiInventoryReady) return [];
  const physicalNames = new Set(physicalMidiInventory.map(device => normalizeMidiDeviceName(device.deviceName)));
  return [...pcMidiAccess.inputs.values()]
    .filter(input => input.state !== 'disconnected')
    .filter(input => physicalNames.has(normalizeMidiDeviceName(input.name)) || isPocketConnectorInput(input));
}

async function refreshPhysicalMidiInventory() {
  const inventory = await window.showHost?.getPhysicalMidiInventory?.();
  physicalMidiInventory = Array.isArray(inventory) ? inventory : [];
  physicalMidiInventoryReady = true;
  console.info('SHOWROOM physical MIDI inventory:', physicalMidiInventory);
  return physicalMidiInventory;
}

function getBleDefinition(device) {
  return BLE_DEVICE_DEFINITIONS.find(definition => definition.pattern.test(String(device?.name || '').trim())) || null;
}

async function refreshAuthorizedBleDevices({ request = false } = {}) {
  if (!navigator.bluetooth) return [];
  try {
    let devices = [];
    if (request) {
      console.info('SHOWROOM BLE: iniciando descubrimiento de Pocket/Mixer.');
      const discovered = await navigator.bluetooth.requestDevice({
        filters: [
          { name: BLE_POCKET_NAME },
          { namePrefix: 'SMC-PAD Pocket' },
          { namePrefix: 'SMC-PADPocket' },
          { name: BLE_MIXER_NAME },
          { namePrefix: 'SMC-Mixer' },
        ],
        optionalServices: [BLE_MIDI_SERVICE],
      });
      console.info('SHOWROOM BLE: dispositivo descubierto:', {
        id: discovered?.id,
        name: discovered?.name,
      });
      devices = [discovered];
    }
    pcBleAuthorizedDevices = [...new Map(
      devices.filter(device => getBleDefinition(device)).map(device => [device.id, device]),
    ).values()];
  } catch (error) {
    if (error?.name !== 'NotFoundError') console.warn('SHOWROOM: no se pudieron consultar dispositivos BLE autorizados.', error);
  }
  refreshPcMidiDevices(midiDeviceSelect?.value || '');
  reportCurrentMidiDevices();
  return pcBleAuthorizedDevices;
}

function refreshPcMidiDevicesLegacy(preferredId = '') {
  if (!midiDeviceSelect) return;
  const inputs = availablePcMidiInputs();
  console.info('SHOWROOM Web MIDI endpoints:', pcMidiAccess
    ? [...pcMidiAccess.inputs.values()].map(input => ({
      id: input.id,
      name: input.name,
      manufacturer: input.manufacturer,
      state: input.state,
      connection: input.connection,
      accepted: inputs.includes(input),
    }))
    : []);
  console.info('SHOWROOM MIDI endpoints descartados por falta de asociacion PnP:', pcMidiAccess
    ? [...pcMidiAccess.inputs.values()].filter(input => !inputs.includes(input))
    : []);
  const previous = preferredId || midiDeviceSelect.value || '';
  midiDeviceSelect.innerHTML = '';
  const scanOption = document.createElement('option');
  scanOption.value = 'midi-scan';
  scanOption.textContent = 'ESCANEAR DISPOSITIVOS';
  midiDeviceSelect.append(scanOption);
  inputs.forEach(input => {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || `Dispositivo MIDI ${input.id}`;
    const definition = { name: input.name || 'DISPOSITIVO MIDI' };
    const device = { id: input.id };
    option.textContent = `${definition.name} · ${device.id === pcBleDevice?.id ? 'CONECTADO' : 'DISPONIBLE'}`;
    midiDeviceSelect.append(option);
  });
  if (false && pcBleDevice && !pcBleAuthorizedDevices.some(device => device.id === pcBleDevice.id)) {
    const bleOption = document.createElement('option');
    bleOption.value = pcBleDevice ? `ble:${pcBleDevice.id}` : 'ble-connect';
    bleOption.textContent = pcBleDevice
      ? `${pcBleDevice.name || 'SMC-PAD'} · BLUETOOTH CONECTADO`
      : '';
    midiDeviceSelect.append(bleOption);
  }
  for (const device of pcBleAuthorizedDevices) {
    const option = document.createElement('option');
    option.value = `ble:${device.id}`;
    option.textContent = `${BLE_POCKET_NAME} · ${device.id === pcBleDevice?.id ? 'CONECTADO' : 'DISPONIBLE'}`;
    midiDeviceSelect.append(option);
  }
  const bleOption = [...midiDeviceSelect.options].find(option => option.value === 'ble-connect' || option.value.startsWith('ble:'));
  if (false && bleOption) {
    bleOption.textContent = pcBleDevice
      ? `${BLE_POCKET_NAME} · BLUETOOTH CONECTADO`
      : `＋ Conectar ${BLE_POCKET_NAME}`;
  }
  const selectedBle = pcBleDevice && previous === `ble:${pcBleDevice.id}`;
  const selectedInput = selectedBle ? null : (inputs.find(input => input.id === previous) || null);
  const selectedAuthorizedBle = pcBleAuthorizedDevices.some(device => `ble:${device.id}` === previous);
  const selected = selectedBle || selectedInput || selectedAuthorizedBle;
  if (selectedBle) midiDeviceSelect.value = `ble:${pcBleDevice.id}`;
  else if (selectedInput) midiDeviceSelect.value = selectedInput.id;
  else if (selectedAuthorizedBle) midiDeviceSelect.value = previous;
  else midiDeviceSelect.value = 'midi-scan';
  renderMidiDevicePicker();
  if (pcMidiInput && !inputs.some(input => input.id === pcMidiInput.id)) {
    detachPcMidiInput();
    setPcMidiUi(false, 'ENGINE - DISPOSITIVO MIDI DESCONECTADO');
  }
  if (pcMidiEnabled && !selected && !selectedBle) setMidiConnectionLabel(false);
}

function refreshPcMidiDevices(preferredId = '') {
  if (!midiDeviceSelect) return;
  const inputs = availablePcMidiInputs();
  const previous = preferredId || midiDeviceSelect.value || '';
  midiDeviceSelect.innerHTML = '';
  const scanOption = document.createElement('option');
  scanOption.value = 'midi-scan';
  scanOption.textContent = 'ESCANEAR DISPOSITIVOS';
  midiDeviceSelect.append(scanOption);
  for (const input of inputs) {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || `Dispositivo MIDI ${input.id}`;
    midiDeviceSelect.append(option);
  }
  for (const device of pcBleAuthorizedDevices) {
    const definition = getBleDefinition(device);
    if (!definition) continue;
    const option = document.createElement('option');
    option.value = `ble:${device.id}`;
    option.textContent = `${definition.name} - ${device.id === pcBleDevice?.id ? 'CONECTADO' : 'DISPONIBLE'}`;
    midiDeviceSelect.append(option);
  }
  const selectedBle = pcBleDevice && previous === `ble:${pcBleDevice.id}`;
  const selectedInput = selectedBle ? null : (inputs.find(input => input.id === previous) || null);
  const selectedAuthorizedBle = pcBleAuthorizedDevices.some(device => `ble:${device.id}` === previous);
  if (selectedBle) midiDeviceSelect.value = `ble:${pcBleDevice.id}`;
  else if (selectedInput) midiDeviceSelect.value = selectedInput.id;
  else if (selectedAuthorizedBle) midiDeviceSelect.value = previous;
  else midiDeviceSelect.value = 'midi-scan';
  renderMidiDevicePicker();
  if (pcMidiInput && !inputs.some(input => input.id === pcMidiInput.id)) {
    detachPcMidiInput();
    setPcMidiUi(false, 'ENGINE - DISPOSITIVO MIDI DESCONECTADO');
  }
  if (pcMidiEnabled && !selectedBle && !selectedInput && !selectedAuthorizedBle && midiHint) {
    setMidiConnectionLabel(false);
  }
}

function reportCurrentMidiDevicesLegacy() {
  window.showHost?.reportMidiDevices?.([
    ...availablePcMidiInputs().map(input => ({
      deviceId: input.id,
      deviceName: input.name || '',
      manufacturer: input.manufacturer || '',
      connected: pcMidiInput?.id === input.id,
      state: pcMidiInput?.id === input.id ? 'connected' : input.state,
    })),
    ...pcBleAuthorizedDevices.map(device => ({
      definition: getBleDefinition(device),
      deviceId: `ble:${device.id}`,
      deviceName: getBleDefinition(device)?.name || device.name || '',
      deviceNameOriginal: device.name || getBleDefinition(device)?.name || '',
      manufacturer: 'M-VAVE',
      profileId: getBleDefinition(device)?.profileId,
      profileName: getBleDefinition(device)?.profileName,
      transport: 'ble-midi',
      connected: pcBleDevice?.id === device.id,
      state: pcBleDevice?.id === device.id ? 'connected' : 'available',
    })),
  ]);
}

function reportCurrentMidiDevices() {
  window.showHost?.reportMidiDevices?.([
    ...availablePcMidiInputs().map(input => ({
      deviceId: input.id,
      deviceName: input.name || '',
      manufacturer: input.manufacturer || '',
      connected: pcMidiInput?.id === input.id,
      state: pcMidiInput?.id === input.id ? 'connected' : input.state,
    })),
    ...pcBleAuthorizedDevices.map(device => {
      const definition = getBleDefinition(device);
      if (!definition) return null;
      return {
        deviceId: `ble:${device.id}`,
        deviceName: definition.name,
        deviceNameOriginal: device.name || definition.name,
        manufacturer: 'M-VAVE',
        profileId: definition.profileId,
        profileName: definition.profileName,
        transport: 'ble-midi',
        connected: pcBleDevice?.id === device.id,
        state: pcBleDevice?.id === device.id ? 'connected' : 'available',
      };
    }).filter(Boolean),
  ]);
}

function sendRawMidiToEngine(input, data, timestamp = Date.now()) {
  console.info('[MIDI TRACE] showroom.raw-input', {
    input: { id: input?.id, name: input?.name, profileId: input?.profileId, profileName: input?.profileName, transport: input?.transport },
    data: Array.from(data || []),
    timestamp,
    enabled: pcMidiEnabled,
  });
  if (!pcMidiEnabled || !data || data.length < 2 || !window.showHost?.sendMidiInput) return;
  const status = data[0] & 0xff;
  const velocity = Number(data[2]) || 0;
  const payload = {
    deviceId: input.id,
    deviceName: input.name || '',
    deviceNameOriginal: input.deviceNameOriginal || input.name || '',
    manufacturer: input.manufacturer || '',
    transport: input.id.startsWith('ble:') ? 'ble-midi' : 'midi',
    profileId: input.profileId || (input.id.startsWith('ble:') ? BLE_POCKET_PROFILE_ID : undefined),
    profileName: input.profileName || (input.id.startsWith('ble:') ? BLE_POCKET_PROFILE_NAME : undefined),
    status,
    note: Number(data[1]),
    velocity,
    data1: Number(data[1]),
    data2: Number(data[2]) || 0,
    timestamp: Number(timestamp) || Date.now(),
  };
  console.info('[MIDI TRACE] showroom.send-midi-input', payload);
  void window.showHost.sendMidiInput(payload).then(result => {
    if (result?.assignment) {
      scorePadAssignmentMode = false;
      if (scorePadAssignButton) scorePadAssignButton.textContent = '🎹 ASIGNAR PADS';
      void refreshScorePadAssignmentUi();
    } else if (result?.accepted) {
      setMidiConnectionLabel(true);
    } else if (result?.error && midiHint) {
      console.warn('SHOWROOM MIDI:', result.error);
    }
  }).catch(error => {
    console.error('SHOWROOM MIDI → ENGINE:', error);
  });
}

function parsePcBleMidiPacket(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 3 || (bytes[0] & 0x80) === 0) return;
  let i = 1;
  let runningStatus = null;
  while (i < bytes.length) {
    if ((bytes[i] & 0x80) !== 0) { i++; if (i >= bytes.length) break; }
    let statusByte = bytes[i];
    if (statusByte & 0x80) {
      statusByte = bytes[i++];
      if (statusByte < 0xf0) runningStatus = statusByte;
    } else if (runningStatus !== null) statusByte = runningStatus;
    else break;
    const command = statusByte & 0xf0;
    if (command === 0xf0) break;
    const length = command === 0xc0 || command === 0xd0 ? 1 : 2;
    if (i + length > bytes.length) break;
    const data = [statusByte];
    for (let n = 0; n < length; n++) data.push(bytes[i++]);
    sendRawMidiToEngine({
      id: `ble:${pcBleDevice?.id || 'smc-pad'}`,
      name: getBleDefinition(pcBleDevice)?.name || pcBleDevice?.name || '',
      deviceNameOriginal: pcBleDevice?.name || getBleDefinition(pcBleDevice)?.name || '',
      manufacturer: 'M-VAVE',
      profileId: getBleDefinition(pcBleDevice)?.profileId,
      profileName: getBleDefinition(pcBleDevice)?.profileName,
    }, new Uint8Array(data));
  }
}

async function connectPcBleMidi(preselectedDevice = null) {
  if (pcBleConnectPromise) return pcBleConnectPromise;
  pcBleConnectPromise = connectPcBleMidiInternal(preselectedDevice);
  try {
    return await pcBleConnectPromise;
  } finally {
    pcBleConnectPromise = null;
  }
}

async function connectPcBleMidiInternal(preselectedDevice = null) {
  if (!navigator.bluetooth) {
    setPcMidiUi(false);
    return;
  }
  let device = preselectedDevice;
  try {
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { name: BLE_POCKET_NAME },
          { namePrefix: 'SMC-PAD Pocket' },
          { namePrefix: 'SMC-PADPocket' },
          { name: BLE_MIXER_NAME },
          { namePrefix: 'SMC-Mixer' },
        ],
        optionalServices: [BLE_MIDI_SERVICE],
      });
    }
    const definition = getBleDefinition(device);
    if (!definition) throw new Error('El dispositivo Bluetooth seleccionado no es compatible.');
    pcBleAuthorizedDevices = [...new Map(
      [...pcBleAuthorizedDevices, device].filter(item => getBleDefinition(item)).map(item => [item.id, item]),
    ).values()];
    pcBleManualDisconnect = false;
    pcBleDevice = device;
      console.info('SHOWROOM BLE: conectando GATT:', {
        id: device.id,
        name: device.name,
        profileId: definition.profileId,
        service: BLE_MIDI_SERVICE,
        characteristic: BLE_MIDI_CHARACTERISTIC,
      });
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    pcBleCharacteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    await pcBleCharacteristic.startNotifications();
      console.info('SHOWROOM BLE: notificaciones MIDI activas:', device.id);
    pcBleListener = event => {
      const value = event.target.value;
      parsePcBleMidiPacket(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    };
    pcBleCharacteristic.addEventListener('characteristicvaluechanged', pcBleListener);
    pcBleDisconnectListener = () => {
      try { device.removeEventListener('gattserverdisconnected', pcBleDisconnectListener); } catch {}
      if (pcBleCharacteristic && pcBleListener) {
        try { pcBleCharacteristic.removeEventListener('characteristicvaluechanged', pcBleListener); } catch {}
      }
      pcBleDevice = null;
      pcBleCharacteristic = null;
      pcBleListener = null;
      pcBleDisconnectListener = null;
      if (pcMidiEnabled && !pcBleManualDisconnect) {
        pcBleReconnectAttempt = Math.min(pcBleReconnectAttempt + 1, 6);
        const delay = Math.min(1000 * (2 ** (pcBleReconnectAttempt - 1)), 30_000);
        pcBleReconnectTimer = setTimeout(() => {
          pcBleReconnectTimer = null;
          void reconnectRememberedPcBleMidi();
        }, delay);
      }
      window.showHost?.reportMidiConnection?.({ deviceId: `ble:${device.id}`, connected: false, error: 'BLUETOOTH MIDI DESCONECTADO' });
      reportCurrentMidiDevices();
      refreshPcMidiDevices();
      void refreshScorePadAssignmentUi();
      setMidiConnectionLabel(false);
    };
    device.addEventListener('gattserverdisconnected', pcBleDisconnectListener);
    rememberedPcMidiId = `ble:${device.id}`;
    try { localStorage.setItem(MIDI_DEVICE_KEY, rememberedPcMidiId); } catch {}
    detachPcMidiInput();
    refreshPcMidiDevices(rememberedPcMidiId);
    midiDeviceSelect.value = `ble:${device.id}`;
    reportCurrentMidiDevices();
    setMidiConnectionLabel(true);
    window.showHost?.reportMidiConnection?.({ deviceId: `ble:${device.id}`, connected: true });
    pcBleReconnectAttempt = 0;
    void refreshScorePadAssignmentUi();
  } catch (error) {
    if (pcBleDevice === device) {
      pcBleDevice = null;
      pcBleCharacteristic = null;
      pcBleListener = null;
      pcBleDisconnectListener = null;
    }
    console.error('SHOWROOM BLE MIDI:', error);
    refreshPcMidiDevices();
    setPcMidiUi(false);
  }
}

async function reconnectRememberedPcBleMidi() {
  if (!navigator.bluetooth?.getDevices || !rememberedPcMidiId.startsWith('ble:') || pcBleDevice) return false;
  try {
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find(item => `ble:${item.id}` === rememberedPcMidiId);
    if (!device) return false;
    await connectPcBleMidi(device);
    void refreshScorePadAssignmentUi();
    return true;
  } catch (error) {
    console.warn('SHOWROOM: no se pudo reconectar el dispositivo BLE preferido.', error);
    return false;
  }
}

async function attachPcMidiInput(input) {
  detachPcMidiInput();
  if (!input) return;
  if (pcBleDevice) await disconnectPcBleMidi();
  try {
    if (typeof input.open === 'function') await input.open();
    input.onmidimessage = event => sendRawMidiToEngine(input, event.data, event.timeStamp);
    pcMidiInput = input;
    reportCurrentMidiDevices();
    const result = await window.showHost?.reportMidiConnection?.({ deviceId: input.id, connected: true });
    if (!result?.accepted) throw new Error(result?.error || 'MIDI device was not accepted as active.');
    rememberedPcMidiId = input.id;
    try { localStorage.setItem(MIDI_DEVICE_KEY, input.id); } catch {}
    void refreshScorePadAssignmentUi();
  setMidiConnectionLabel(true);
    return true;
  } catch (error) {
    input.onmidimessage = null;
    if (pcMidiInput === input) {
      pcMidiInput = null;
      reportCurrentMidiDevices();
    }
    try { if (typeof input.close === 'function') await input.close(); } catch {}
    console.warn('SHOWROOM: no se pudo activar el puerto MIDI.', error);
    setMidiConnectionLabel(false);
    return false;
  }
}

async function initializePcMidi() {
  if (pcMidiInitialized) return;
  pcMidiInitialized = true;
  if (!navigator.requestMIDIAccess && !navigator.bluetooth) {
    setPcMidiUi(false, 'MIDI / BLUETOOTH NO DISPONIBLE EN ESTE EQUIPO');
    return;
  }
  if (navigator.requestMIDIAccess && !pcMidiAccess) {
    try {
      pcMidiAccess = await navigator.requestMIDIAccess({ sysex: false });
       pcMidiAccess.onstatechange = () => {
         void refreshPhysicalMidiInventory().then(() => refreshPcMidiDevices());
       };
    } catch (error) {
      console.warn('SHOWROOM: Web MIDI no disponible; se mantiene la opcion Bluetooth.', error);
    }
  }
  await refreshPhysicalMidiInventory();
  await refreshAuthorizedBleDevices();
  setPcMidiUi(false, 'ENGINE · SIN DISPOSITIVO CONECTADO');
  refreshPcMidiDevices(midiDeviceSelect?.value || '');
  reportCurrentMidiDevices();
}

async function enablePcMidi() {
  await initializePcMidi();
  if (!navigator.requestMIDIAccess && !navigator.bluetooth) {
    setPcMidiUi(false, 'MIDI / BLUETOOTH NO DISPONIBLE EN ESTE EQUIPO');
    return;
  }
  setPcMidiUi(true, 'ENGINE · BUSCANDO DISPOSITIVOS MIDI');
  if (navigator.requestMIDIAccess && !pcMidiAccess) {
    try {
      pcMidiAccess = await navigator.requestMIDIAccess({ sysex: false });
       pcMidiAccess.onstatechange = () => {
         void refreshPhysicalMidiInventory().then(() => refreshPcMidiDevices());
       };
    } catch (error) {
      console.warn('SHOWROOM: Web MIDI no disponible; se mantiene la opción Bluetooth.', error);
    }
  }
  refreshPcMidiDevices(midiDeviceSelect?.value || '');
  reportCurrentMidiDevices();
  const selectedValue = midiDeviceSelect?.value || '';
  if (selectedValue === 'ble-connect') {
    await connectPcBleMidi();
    return;
  }
  if (selectedValue.startsWith('ble:') && !pcBleDevice) {
    await reconnectRememberedPcBleMidi();
    if (!pcBleDevice) await connectPcBleMidi();
    return;
  }
  const selectedInput = pcMidiAccess?.inputs.get(selectedValue);
  if (selectedInput && selectedInput.state !== 'disconnected') {
    setPcMidiUi(true, `ENGINE - CONECTANDO - ${selectedInput.name || 'DISPOSITIVO MIDI'}`);
    await attachPcMidiInput(selectedInput);
  } else if (!pcBleDevice) {
    setPcMidiUi(false, 'ENGINE Â· SELECCIONA UN DISPOSITIVO MIDI');
  }
  if (!pcMidiInput && !pcBleDevice) setPcMidiUi(true, 'ENGINE · SIN DISPOSITIVO CONECTADO');
  if (!pcMidiAccess && !navigator.bluetooth) {
    setPcMidiUi(false, 'NO SE PUDO ACTIVAR WEB MIDI');
    return;
  }
  if (!pcMidiInput && !pcBleDevice && availablePcMidiInputs().length === 0 && midiHint) {
    setMidiConnectionLabel(false);
  }
}

midiToggle?.addEventListener('click', () => {
  if (pcMidiEnabled) {
    detachPcMidiInput();
    void disconnectPcBleMidi().then(() => refreshPcMidiDevices());
    setPcMidiUi(false, 'ENGINE · MIDI DESACTIVADO');
    return;
  }
  void enablePcMidi();
});

midiDeviceSelect?.addEventListener('change', async () => {
  const value = midiDeviceSelect.value;
  if (value === 'midi-scan') {
    await refreshPhysicalMidiInventory();
    await refreshAuthorizedBleDevices({ request: true });
    if (!pcMidiInput && !pcBleDevice) setMidiConnectionLabel(false);
    renderMidiDevicePicker();
    return;
  }
  if (value.startsWith('ble:')) {
    const device = pcBleAuthorizedDevices.find(item => `ble:${item.id}` === value);
    if (!device) {
      await refreshAuthorizedBleDevices();
      return;
    }
    detachPcMidiInput();
    await disconnectPcBleMidi();
    setPcMidiUi(true, `CONECTANDO · ${BLE_POCKET_NAME}`);
    await connectPcBleMidi(device);
    if (!pcBleDevice) setPcMidiUi(false, 'SIN DISPOSITIVO CONECTADO');
    renderMidiDevicePicker();
    return;
  }
  const selectedInput = pcMidiAccess?.inputs.get(value);
  if (selectedInput && selectedInput.state !== 'disconnected') {
    detachPcMidiInput();
    await disconnectPcBleMidi();
    setPcMidiUi(true, `CONECTANDO · ${selectedInput.name || 'DISPOSITIVO MIDI'}`);
    await attachPcMidiInput(selectedInput);
    renderMidiDevicePicker();
    return;
  }
  setMidiConnectionLabel(false);
  renderMidiDevicePicker();
  return;

  {
  let disconnectPromise = Promise.resolve();
  if (pcMidiEnabled) {
    detachPcMidiInput();
    disconnectPromise = disconnectPcBleMidi();
    setPcMidiUi(false, 'ENGINE - DISPOSITIVO CAMBIADO - PULSA INICIAR');
  }
  const value = midiDeviceSelect.value;
  if (value === 'ble-connect' || value.startsWith('ble:')) {
    if (value.startsWith('ble:')) {
      rememberedPcMidiId = value;
      try { localStorage.setItem(MIDI_DEVICE_KEY, value); } catch {}
    }
    if (pcMidiEnabled) {
      setPcMidiUi(true, `ENGINE · CONECTANDO · ${BLE_POCKET_NAME}`);
      void disconnectPromise.then(() => value === 'ble-connect' ? connectPcBleMidi() : reconnectRememberedPcBleMidi().then((connected) => {
        if (!connected && !pcBleDevice) return connectPcBleMidi();
        return undefined;
      }));
    }
    renderMidiDevicePicker();
    return;
  }
  const selected = pcMidiAccess?.inputs.get(value);
  if (selected) {
    rememberedPcMidiId = selected.id;
    try { localStorage.setItem(MIDI_DEVICE_KEY, selected.id); } catch {}
    window.showHost?.reportMidiSelection?.(selected.id);
  }
  setMidiConnectionLabel(false);
  renderMidiDevicePicker();
  }
});

void initializePcMidi();

