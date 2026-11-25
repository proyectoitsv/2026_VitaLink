// Bluetooth simulado para el MODO DEMO: una pulsera VitaLink virtual (ver demo/estado.js)
import { encode as aBase64, decode as deBase64 } from 'base-64';
import { pulseraVirtual } from './estado';

const ID_PULSERA = 'D4:CA:6E:12:34:56';
const SERVICIO = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const C = {
  BPM: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
  SPO2: 'beb5483e-36e1-4688-b7f5-ea07361b26a9',
  BAT: 'beb5483e-36e1-4688-b7f5-ea07361b26aa',
  CAIDA: 'beb5483e-36e1-4688-b7f5-ea07361b26ab',
  SOS: 'beb5483e-36e1-4688-b7f5-ea07361b26ac',
  VERSION: 'beb5483e-36e1-4688-b7f5-ea07361b26ad',
  OTA_CONTROL: 'beb5483e-36e1-4688-b7f5-ea07361b26ae',
  OTA_DATOS: 'beb5483e-36e1-4688-b7f5-ea07361b26af',
  CALIB_DATOS: 'beb5483e-36e1-4688-b7f5-ea07361b26b0',
  CALIB_CONFIG: 'beb5483e-36e1-4688-b7f5-ea07361b26b1',
  MAX_DATOS: 'beb5483e-36e1-4688-b7f5-ea07361b26b2',
  MAX_CONFIG: 'beb5483e-36e1-4688-b7f5-ea07361b26b3',
};
const VERSION = '1.0.38';

const configCaidas = { libre: 0.82, impacto: 2.0, vmin: 300, ventana: 800, quieto: 0.3, prop: 0.7, conf: 3000 };
const configMax = { led: 165, prom: 4, sens: 8, smax: 50, amp: 1500, pulsera: 35000, bmin: 40, bmax: 145, sa: 104, sb: 5 };
const textoConfig = (c) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(';');

const valores = {
  [C.BPM]: '--', [C.SPO2]: '--', [C.BAT]: '82', [C.CAIDA]: '0', [C.SOS]: '0', [C.VERSION]: VERSION,
};

// ---------------------------------------------------------------- suscripciones
const subs = new Set(); // { uuid, cb }
const notificar = (uuid, valorB64) => {
  subs.forEach((s) => {
    if (s.uuid === uuid) s.cb(null, { uuid, serviceUUID: SERVICIO, deviceID: ID_PULSERA, value: valorB64 });
  });
};
const notificarTexto = (uuid, texto) => {
  valores[uuid] = texto;
  notificar(uuid, aBase64(texto));
};
const bytesABase64 = (bytes) => aBase64(String.fromCharCode(...bytes));

pulseraVirtual.emitir = (uuid, texto) => notificarTexto(uuid, texto);

// ---------------------------------------------------------------- conexión
let conectada = false;
const oyentesDesconexion = new Set();
const temporizadores = [];

const desconectar = () => {
  if (!conectada) return;
  conectada = false;
  pulseraVirtual.conectada = false;
  temporizadores.splice(0).forEach(clearInterval);
  detenerCalibraciones();
  oyentesDesconexion.forEach((cb) => { try { cb(null, dispositivo); } catch (e) {} });
};
pulseraVirtual.desconectar = desconectar;

// Pulso y oxígeno como los manda el firmware: -1 = midiendo, 0 = sin pulsera
let inicioConexion = 0;
let bpmBase = 74;
const tickSignos = () => {
  let modo = pulseraVirtual.modo;
  if (modo === 'midiendo_inicial') {
    if (Date.now() - inicioConexion > 8000) { pulseraVirtual.modo = 'medir'; modo = 'medir'; } else modo = 'midiendo';
  }
  if (modo === 'pausa') return;
  if (modo === 'sin_muneca') {
    if (valores[C.BPM] !== '0') { notificarTexto(C.BPM, '0'); notificarTexto(C.SPO2, '0'); }
    return;
  }
  if (modo === 'midiendo') { notificarTexto(C.BPM, '-1'); notificarTexto(C.SPO2, '-1'); return; }
  bpmBase = Math.max(70, Math.min(79, bpmBase + Math.round(Math.random() * 2 - 1)));
  notificarTexto(C.BPM, String(bpmBase));
  notificarTexto(C.SPO2, String(Math.random() < 0.7 ? 97 : 98));
};

const conectar = () => {
  conectada = true;
  pulseraVirtual.conectada = true;
  inicioConexion = Date.now();
  if (pulseraVirtual.modo === 'medir') pulseraVirtual.modo = 'midiendo_inicial';
  temporizadores.push(setInterval(tickSignos, 1000));
  temporizadores.push(setInterval(() => notificarTexto(C.BAT, String(pulseraVirtual.bateria)), 5000));
  setTimeout(() => notificarTexto(C.BAT, String(pulseraVirtual.bateria)), 1200);
};

// ---------------------------------------------------------------- calibración en vivo
let streamCaidas = null;
let streamMax = null;
const detenerCalibraciones = () => {
  if (streamCaidas) clearInterval(streamCaidas);
  if (streamMax) clearInterval(streamMax);
  streamCaidas = null;
  streamMax = null;
};

// Acelerómetro a 50 muestras/s: caminando suave y cada 10 s una caída completa
let tCaida = 0;
const muestraCaida = () => {
  const ciclo = tCaida % 500;
  tCaida++;
  let g = 1 + Math.sin(tCaida / 6) * 0.06 + (Math.random() - 0.5) * 0.05;
  let evento = 0;
  let valor = 0;
  if (ciclo >= 300 && ciclo < 322) {               // caída libre (~440 ms)
    g = 0.22 + (Math.random() - 0.5) * 0.06;
    if (ciclo === 302) { evento = 1; valor = Math.round(g * 1000); }
  } else if (ciclo >= 322 && ciclo < 326) {        // impacto
    g = [2.6, 3.7, 2.1, 1.4][ciclo - 322];
    if (ciclo === 323) { evento = 2; valor = 3700; }
  } else if (ciclo >= 326 && ciclo < 480) {        // quieta en el piso
    g = 1 + (Math.random() - 0.5) * 0.03;
    if (ciclo === 477) { evento = 3; valor = 94; }
  }
  return { g, evento, valor };
};
const iniciarStreamCaidas = () => {
  if (streamCaidas) return;
  streamCaidas = setInterval(() => {
    const bytes = [5];
    let ev = 0;
    let val = 0;
    for (let i = 0; i < 5; i++) {
      const m = muestraCaida();
      const mg = Math.max(0, Math.round(m.g * 1000));
      bytes.push(mg & 0xff, (mg >> 8) & 0xff);
      if (m.evento) { ev = m.evento; val = m.valor; }
    }
    bytes.push(ev, val & 0xff, (val >> 8) & 0xff);
    notificar(C.CALIB_DATOS, bytesABase64(bytes));
  }, 100);
};

// Sensor de pulso a 25 muestras/s: onda de pulso con muesca dicrótica
let tPulso = 0;
let faseAnterior = 0;
const muestraPulso = () => {
  const periodo = 60 / 74 * 25;                 // muestras por latido
  const fase = (tPulso % periodo) / periodo;
  tPulso++;
  const subida = 0.14;
  let forma;
  if (fase < subida) forma = Math.sin((fase / subida) * Math.PI / 2);
  else {
    const x = (fase - subida) / (1 - subida);
    forma = Math.exp(-3.2 * x) + 0.18 * Math.exp(-Math.pow((x - 0.32) / 0.07, 2));
  }
  const deriva = Math.sin(tPulso / 90) * 120;
  const v = Math.round(118000 - forma * 900 + deriva + (Math.random() - 0.5) * 25);
  const pico = faseAnterior < subida && fase >= subida;
  faseAnterior = fase;
  return { v, pico };
};
const iniciarStreamMax = () => {
  if (streamMax) return;
  streamMax = setInterval(() => {
    const n = 4;
    const bytes = [n];
    let mascara = 0;
    for (let k = 0; k < n; k++) {
      const m = muestraPulso();
      bytes.push(m.v & 0xff, (m.v >> 8) & 0xff, (m.v >> 16) & 0xff);
      if (m.pico) mascara |= (1 << k) | (1 << (4 + k));
    }
    const r = 1400;
    bytes.push(mascara, 74, 97, 2, r & 0xff, (r >> 8) & 0xff);
    notificar(C.MAX_DATOS, bytesABase64(bytes));
  }, 160);
};

const aplicarSet = (config, texto) => {
  texto.replace(/^SET\s+/, '').split(';').forEach((par) => {
    const [k, v] = par.split('=');
    if (k && v !== undefined && k.trim() in config) config[k.trim()] = parseFloat(v);
  });
};

const escribir = async (uuid, valorB64) => {
  if (!conectada) throw new Error('Device is not connected');
  const texto = deBase64(valorB64).trim();
  if (uuid === C.CAIDA) {
    if (texto === 'R') setTimeout(desconectar, 500);   // reiniciar pulsera
  } else if (uuid === C.CALIB_CONFIG) {
    if (texto === 'STREAM 1') iniciarStreamCaidas();
    else if (texto === 'STREAM 0') { if (streamCaidas) clearInterval(streamCaidas); streamCaidas = null; }
    else if (texto.startsWith('SET')) { aplicarSet(configCaidas, texto); notificarTexto(C.CALIB_CONFIG, textoConfig(configCaidas)); }
  } else if (uuid === C.MAX_CONFIG) {
    if (texto === 'STREAM 1') iniciarStreamMax();
    else if (texto === 'STREAM 0') { if (streamMax) clearInterval(streamMax); streamMax = null; }
    else if (texto.startsWith('SET')) { aplicarSet(configMax, texto); notificarTexto(C.MAX_CONFIG, textoConfig(configMax)); }
  }
  return { uuid, value: valorB64 };
};

const leer = async (uuid) => {
  if (!conectada) throw new Error('Device is not connected');
  await new Promise((r) => setTimeout(r, 80));
  let texto = valores[uuid];
  if (uuid === C.CALIB_CONFIG) texto = textoConfig(configCaidas);
  if (uuid === C.MAX_CONFIG) texto = textoConfig(configMax);
  return { uuid, serviceUUID: SERVICIO, deviceID: ID_PULSERA, value: aBase64(texto || '') };
};

const monitorear = (uuid, cb) => {
  const s = { uuid: (uuid || '').toLowerCase(), cb };
  subs.add(s);
  return { remove: () => subs.delete(s) };
};

// ---------------------------------------------------------------- dispositivo
const dispositivo = {
  id: ID_PULSERA,
  name: 'VitaLink',
  localName: 'VitaLink',
  mtu: 512,
  rssi: -58,
  isConnected: async () => conectada,
  discoverAllServicesAndCharacteristics: async () => dispositivo,
  requestMTU: async () => dispositivo,
  requestConnectionPriority: async () => dispositivo,
  readRSSI: async () => { if (!conectada) throw new Error('Device is not connected'); return dispositivo; },
  characteristicsForService: async () => Object.values(C).map((uuid) => ({ uuid, serviceUUID: SERVICIO })),
  readCharacteristicForService: (svc, uuid) => leer(uuid.toLowerCase()),
  writeCharacteristicWithResponseForService: (svc, uuid, v) => escribir(uuid.toLowerCase(), v),
  writeCharacteristicWithoutResponseForService: (svc, uuid, v) => escribir(uuid.toLowerCase(), v),
  monitorCharacteristicForService: (svc, uuid, cb) => monitorear(uuid, cb),
  onDisconnected: (cb) => {
    oyentesDesconexion.add(cb);
    return { remove: () => oyentesDesconexion.delete(cb) };
  },
  cancelConnection: async () => { desconectar(); return dispositivo; },
};

// ---------------------------------------------------------------- BleManager
export class BleManager {
  constructor() { this._escaneo = null; }

  async state() { return 'PoweredOn'; }
  onStateChange(cb, emitirYa) { if (emitirYa) setTimeout(() => cb('PoweredOn'), 0); return { remove: () => {} }; }
  destroy() {}

  startDeviceScan(uuids, opciones, cb) {
    this.stopDeviceScan();
    this._escaneo = setInterval(() => {
      if (pulseraVirtual.encendida) cb(null, { ...dispositivo });
    }, 1300);
  }
  stopDeviceScan() {
    if (this._escaneo) clearInterval(this._escaneo);
    this._escaneo = null;
  }

  async connectedDevices() { return []; }
  async isDeviceConnected() { return conectada; }
  async cancelDeviceConnection() { desconectar(); return dispositivo; }
  async connectToDevice() {
    await new Promise((r) => setTimeout(r, 900));
    if (!pulseraVirtual.encendida) throw new Error('Connection failed');
    if (!conectada) conectar();
    return dispositivo;
  }
  monitorCharacteristicForDevice(id, svc, uuid, cb) { return monitorear(uuid, cb); }
  readCharacteristicForDevice(id, svc, uuid) { return leer(uuid.toLowerCase()); }
  writeCharacteristicWithResponseForDevice(id, svc, uuid, v) { return escribir(uuid.toLowerCase(), v); }
}

export const State = { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff', Unknown: 'Unknown' };
export const BleError = Error;
