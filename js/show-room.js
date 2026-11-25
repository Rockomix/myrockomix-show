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
const midiDevicePicker = document.createElement('div');
const midiDeviceTrigger = document.createElement('button');
const midiDeviceMenu = document.createElement('div');
let midiDevicePickerOpen = false;

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
const MIDI_DEVICE_KEY = 'myrockomix-show-pc-midi-device';
let rememberedPcMidiId = '';
let pcBleDevice = null;
let pcBleCharacteristic = null;
let pcBleListener = null;
let pcBleDisconnectListener = null;
const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';
try { rememberedPcMidiId = localStorage.getItem(MIDI_DEVICE_KEY) || ''; } catch {}

function setPcMidiUi(active, message) {
  pcMidiEnabled = active;
  midiToggle?.classList.toggle('is-active', active);
  midiToggle?.setAttribute('aria-pressed', String(active));
  const label = midiToggle?.querySelector('strong');
  if (label) label.textContent = active ? 'DESCONECTAR' : 'INICIAR';
  if (midiHint) midiHint.textContent = message;
}

function detachPcMidiInput() {
  if (pcMidiInput) pcMidiInput.onmidimessage = null;
  pcMidiInput = null;
}

async function disconnectPcBleMidi() {
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
}

function availablePcMidiInputs() {
  return pcMidiAccess ? [...pcMidiAccess.inputs.values()].filter(input => input.state !== 'disconnected') : [];
}

function refreshPcMidiDevices(preferredId = '') {
  if (!midiDeviceSelect) return;
  const inputs = availablePcMidiInputs();
  const previous = preferredId || midiDeviceSelect.value || rememberedPcMidiId;
  midiDeviceSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = inputs.length ? 'Selecciona dispositivo MIDI' : 'Selecciona MIDI o Bluetooth';
  midiDeviceSelect.append(placeholder);
  inputs.forEach(input => {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || `Dispositivo MIDI ${input.id}`;
    midiDeviceSelect.append(option);
  });
  if (navigator.bluetooth) {
    const bleOption = document.createElement('option');
    bleOption.value = pcBleDevice ? `ble:${pcBleDevice.id}` : 'ble-connect';
    bleOption.textContent = pcBleDevice
      ? `${pcBleDevice.name || 'SMC-PAD'} · BLUETOOTH CONECTADO`
      : '＋ Conectar SMC-PAD por Bluetooth';
    midiDeviceSelect.append(bleOption);
  }
  const selectedBle = pcBleDevice && previous === `ble:${pcBleDevice.id}`;
  const selected = selectedBle ? null : (inputs.find(input => input.id === previous) || null);
  if (selectedBle) midiDeviceSelect.value = `ble:${pcBleDevice.id}`;
  else midiDeviceSelect.value = selected?.id || (previous === 'ble-connect' ? 'ble-connect' : '');
  renderMidiDevicePicker();
  if (pcMidiInput && !inputs.some(input => input.id === pcMidiInput.id)) {
    detachPcMidiInput();
    setPcMidiUi(false, 'ENGINE - DISPOSITIVO MIDI DESCONECTADO');
  }
  if (pcMidiEnabled && !selected && !selectedBle && midiHint) midiHint.textContent = 'ENGINE · ESPERANDO DISPOSITIVO MIDI';
}

function sendRawMidiToEngine(input, data, timestamp = Date.now()) {
  if (!pcMidiEnabled || !data || data.length < 3 || !window.showHost?.sendMidiInput) return;
  const status = data[0] & 0xff;
  const command = status & 0xf0;
  const velocity = Number(data[2]) || 0;
  if (command !== 0x90 || velocity <= 0) return;
  void window.showHost.sendMidiInput({
    deviceId: input.id,
    deviceName: input.name || '',
    manufacturer: input.manufacturer || '',
    status,
    note: Number(data[1]),
    velocity,
    timestamp: Number(timestamp) || Date.now(),
  }).then(result => {
    if (result?.accepted && midiHint) {
      const action = result.action === 'fx' ? 'FX' : result.action === 'score10' ? 'SCORE 10' : result.action === 'score' ? 'SCORE' : 'ENGINE';
      midiHint.textContent = `ENGINE · ${action} · PAD ${String(result.padId || '').padStart(2, '0')}`;
    } else if (result?.error && midiHint) {
      midiHint.textContent = `ENGINE · ${result.error}`;
    }
  }).catch(error => {
    console.error('SHOWROOM MIDI → ENGINE:', error);
    if (midiHint) midiHint.textContent = 'ENGINE · ERROR AL ENVIAR MIDI';
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
      name: pcBleDevice?.name || 'SMC-PAD Pocket',
      manufacturer: 'M-VAVE',
    }, new Uint8Array(data));
  }
}

async function connectPcBleMidi(preselectedDevice = null) {
  if (!navigator.bluetooth) {
    if (midiHint) midiHint.textContent = 'BLUETOOTH MIDI NO DISPONIBLE';
    return;
  }
  let device = preselectedDevice;
  try {
    if (!device && navigator.bluetooth.getDevices) {
      const authorized = await navigator.bluetooth.getDevices();
      device = authorized.find(item => rememberedPcMidiId === `ble:${item.id}` || (rememberedPcMidiId && item.name === rememberedPcMidiId)) || null;
    }
    if (!device) {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'SMC-PAD' }, { namePrefix: 'SMC PAD' }, { namePrefix: 'SMC-Mixer' }, { services: [BLE_MIDI_SERVICE] }],
        optionalServices: [BLE_MIDI_SERVICE],
      });
    }
    pcBleDevice = device;
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    pcBleCharacteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    await pcBleCharacteristic.startNotifications();
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
      refreshPcMidiDevices();
      if (midiHint) midiHint.textContent = 'ENGINE · BLUETOOTH MIDI DESCONECTADO';
    };
    device.addEventListener('gattserverdisconnected', pcBleDisconnectListener);
    rememberedPcMidiId = `ble:${device.id}`;
    try { localStorage.setItem(MIDI_DEVICE_KEY, rememberedPcMidiId); } catch {}
    detachPcMidiInput();
    refreshPcMidiDevices(rememberedPcMidiId);
    midiDeviceSelect.value = `ble:${device.id}`;
    if (midiHint) midiHint.textContent = `ENGINE · SMC-PAD BLUETOOTH CONECTADO`;
  } catch (error) {
    if (pcBleDevice === device) {
      pcBleDevice = null;
      pcBleCharacteristic = null;
      pcBleListener = null;
      pcBleDisconnectListener = null;
    }
    console.error('SHOWROOM BLE MIDI:', error);
    refreshPcMidiDevices();
    if (midiHint) midiHint.textContent = error?.name === 'NotFoundError' ? 'NO SE ENCONTRÓ SMC-PAD' : 'NO SE PUDO CONECTAR BLUETOOTH MIDI';
  }
}

function attachPcMidiInput(input) {
  detachPcMidiInput();
  if (!input) return;
  if (pcBleDevice) void disconnectPcBleMidi();
  pcMidiInput = input;
  rememberedPcMidiId = input.id;
  try { localStorage.setItem(MIDI_DEVICE_KEY, input.id); } catch {}
  input.onmidimessage = event => sendRawMidiToEngine(input, event.data, event.timeStamp);
  if (midiHint) midiHint.textContent = `ENGINE · MIDI CONECTADO · ${input.name || 'DISPOSITIVO MIDI'}`;
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
      pcMidiAccess.onstatechange = () => refreshPcMidiDevices();
    } catch (error) {
      console.warn('SHOWROOM: Web MIDI no disponible; se mantiene la opcion Bluetooth.', error);
    }
  }
  setPcMidiUi(false, 'ENGINE - SELECCIONA DISPOSITIVO MIDI');
  refreshPcMidiDevices(midiDeviceSelect?.value || '');
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
      pcMidiAccess.onstatechange = () => refreshPcMidiDevices();
    } catch (error) {
      console.warn('SHOWROOM: Web MIDI no disponible; se mantiene la opción Bluetooth.', error);
    }
  }
  refreshPcMidiDevices(midiDeviceSelect?.value || rememberedPcMidiId);
  const selectedValue = midiDeviceSelect?.value || '';
  const selectedInput = pcMidiAccess?.inputs.get(selectedValue);
  if (selectedInput && selectedInput.state !== 'disconnected') {
    setPcMidiUi(true, `ENGINE - CONECTANDO - ${selectedInput.name || 'DISPOSITIVO MIDI'}`);
    attachPcMidiInput(selectedInput);
  } else if (!pcBleDevice) {
    setPcMidiUi(false, 'ENGINE Â· SELECCIONA UN DISPOSITIVO MIDI');
  }
  if (!pcMidiAccess && !navigator.bluetooth) {
    setPcMidiUi(false, 'NO SE PUDO ACTIVAR WEB MIDI');
    return;
  }
  if (!pcMidiInput && !pcBleDevice && availablePcMidiInputs().length === 0 && midiHint) {
    midiHint.textContent = 'ENGINE · ESPERANDO DISPOSITIVO MIDI';
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

midiDeviceSelect?.addEventListener('change', () => {
  if (pcMidiEnabled) {
    detachPcMidiInput();
    void disconnectPcBleMidi();
    setPcMidiUi(false, 'ENGINE - DISPOSITIVO CAMBIADO - PULSA INICIAR');
  }
  const value = midiDeviceSelect.value;
  if (value === 'ble-connect' || value.startsWith('ble:')) {
    renderMidiDevicePicker();
    return;
  }
  const selected = pcMidiAccess?.inputs.get(value);
  if (selected) {
    rememberedPcMidiId = selected.id;
    try { localStorage.setItem(MIDI_DEVICE_KEY, selected.id); } catch {}
  }
  if (midiHint) midiHint.textContent = selected ? `SELECCIONADO - ${selected.name || 'DISPOSITIVO MIDI'} - PULSA INICIAR` : 'ENGINE - SELECCIONA DISPOSITIVO MIDI';
  renderMidiDevicePicker();
});

void initializePcMidi();

