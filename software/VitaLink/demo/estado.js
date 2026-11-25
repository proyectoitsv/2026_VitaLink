// =============================================================================
// MODO DEMO (solo para capturas de la presentación)
// -----------------------------------------------------------------------------
// Esta carpeta SOLO entra en la app cuando se compila con VITALINK_DEMO=1
// (ver metro.config.js). En ese caso Firebase y el Bluetooth se reemplazan por
// estas versiones simuladas: una base de datos en memoria con pacientes de
// ejemplo y una pulsera virtual que manda pulso, oxígeno, batería y alertas.
//
// La demo se controla con enlaces (desde la PC, con adb):
//   adb shell am start -a android.intent.action.VIEW -d "vitalink://demo/caida"
// Comandos: caida, sos, visto, cancelar, medir, midiendo, pausa, sin_muneca,
//           apagar_pulsera, prender_pulsera, bateria_baja, bateria_ok,
//           ir/<Pantalla>, familia_on, familia_off, reset
// =============================================================================
import { Linking } from 'react-native';

global.__VITALINK_DEMO__ = true;

export const UID_DEMO = 'rosa0001demo';
export const PACIENTE_PROPIO = 'rosa0001';   // el celular del paciente es el de Rosa
export const UBICACION = { latitude: -31.4135, longitude: -64.1811 }; // Córdoba

// ---------------------------------------------------------------- Timestamps
export class Timestamp {
  constructor(ms) {
    this._ms = ms;
    this.seconds = Math.floor(ms / 1000);
    this.nanoseconds = (ms % 1000) * 1e6;
  }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  static now() { return new Timestamp(Date.now()); }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  static fromMillis(ms) { return new Timestamp(ms); }
}
export const SENTINELA_HORA = { __horaServidor: true };

const esObjetoPlano = (v) => v && typeof v === 'object' && !Array.isArray(v)
  && !(v instanceof Timestamp) && !(v instanceof Date);

export const clonar = (v) => {
  if (v === SENTINELA_HORA || (v && v.__horaServidor)) return Timestamp.now();
  if (v instanceof Date) return Timestamp.fromDate(v);
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clonar);
  if (esObjetoPlano(v)) {
    const o = {};
    Object.keys(v).forEach((k) => { if (v[k] !== undefined) o[k] = clonar(v[k]); });
    return o;
  }
  return v;
};

const fusionar = (base, extra) => {
  const out = esObjetoPlano(base) ? { ...base } : {};
  Object.keys(extra).forEach((k) => {
    const v = extra[k];
    if (v === undefined) return;
    out[k] = esObjetoPlano(v) && !v.__horaServidor && esObjetoPlano(out[k]) ? fusionar(out[k], v) : clonar(v);
  });
  return out;
};

// ------------------------------------------------------- Base de datos en memoria
const documentos = new Map();  // 'pacientes/rosa0001' -> datos
const oyentes = new Set();     // { tipo: 'doc'|'col', ruta, emitir }

export const leerDoc = (ruta) => (documentos.has(ruta) ? documentos.get(ruta) : null);

export const docsDeColeccion = (rutaCol) => {
  const prof = rutaCol.split('/').length + 1;
  const lista = [];
  documentos.forEach((datos, ruta) => {
    if (ruta.startsWith(rutaCol + '/') && ruta.split('/').length === prof) lista.push({ ruta, datos });
  });
  return lista;
};

const avisar = (ruta) => {
  const col = ruta.substring(0, ruta.lastIndexOf('/'));
  oyentes.forEach((o) => {
    if ((o.tipo === 'doc' && o.ruta === ruta) || (o.tipo === 'col' && o.ruta === col)) {
      setTimeout(() => { if (oyentes.has(o)) o.emitir(); }, 0);
    }
  });
};

export const escribirDoc = (ruta, datos, { merge = false } = {}) => {
  const previo = documentos.get(ruta);
  documentos.set(ruta, merge && previo ? fusionar(previo, datos) : fusionar({}, datos));
  avisar(ruta);
};

export const borrarDoc = (ruta) => {
  documentos.delete(ruta);
  avisar(ruta);
};

export const agregarOyente = (o) => {
  oyentes.add(o);
  setTimeout(() => { if (oyentes.has(o)) o.emitir(); }, 0);
  return () => oyentes.delete(o);
};

let contadorIds = 0;
export const nuevoId = () => {
  contadorIds += 1;
  return `demo${Date.now().toString(36)}${contadorIds}`;
};

// ---------------------------------------------------------------- Datos de ejemplo
const PACIENTES = {
  rosa0001: {
    nombre: 'Rosa', apellido: 'Fernández', edad: '78', avatar: 'face-woman-shimmer',
    tipoSangre: 'A+', condiciones: 'Hipertensión arterial', alergias: 'Penicilina',
    telefonoEmergencia: '351 555-1234', perfilCompletado: true, pantallaCompletaConfigurada: true,
    pulseraBleId: 'D4:CA:6E:12:34:56', pulseraNombre: 'VitaLink', activo: true,
  },
  carl0002: {
    nombre: 'Carlos', apellido: 'Gómez', edad: '82', avatar: 'face-man-shimmer',
    tipoSangre: '0+', condiciones: 'Diabetes tipo 2', alergias: 'Ninguna',
    telefonoEmergencia: '351 555-9876', perfilCompletado: true, pantallaCompletaConfigurada: true,
    activo: true,
  },
};
const SIGNOS_INICIALES = {
  rosa0001: { bpm: '74', spo2: '97', bateria: '82', estadoSensor: 'midiendo', ubicacion: UBICACION },
  carl0002: { bpm: '68', spo2: '96', bateria: '64', estadoSensor: 'midiendo',
    ubicacion: { latitude: -31.4290, longitude: -64.1950 } },
};
const familiaVinculada = { rosa0001: { vinculo: 'Hijo/a' }, carl0002: { vinculo: 'Hijo/a' } };

const vincularFamilia = (si) => {
  Object.keys(familiaVinculada).forEach((pid) => {
    const ruta = `familiares/${PACIENTE_PROPIO}/pacientes/${pid}`;
    if (si) {
      escribirDoc(ruta, {
        patientId: pid, nombre: `${PACIENTES[pid].nombre} ${PACIENTES[pid].apellido}`,
        vinculo: familiaVinculada[pid].vinculo, vinculadoEn: SENTINELA_HORA,
      });
    } else {
      borrarDoc(ruta);
    }
  });
};

export const sembrar = () => {
  Object.keys(PACIENTES).forEach((pid) => {
    escribirDoc(`pacientes/${pid}`, { ...PACIENTES[pid], creado: SENTINELA_HORA });
    escribirDoc(`pacientes/${pid}/signos_actuales/live`, { ...SIGNOS_INICIALES[pid], timestamp: SENTINELA_HORA });
  });
  escribirDoc(`familiares/${PACIENTE_PROPIO}`, { nombre: 'Lucía' });
  escribirDoc('configuracion/firmware_actual', { version: '1.0.38', url: '', notas: 'Ahorro de batería' });
  vincularFamilia(true);
};
sembrar();

// Signos que cambian solos (para el panel del familiar)
const varia = (v, min, max, paso) => {
  const n = Math.round(Number(v) + (Math.random() * 2 - 1) * paso);
  return String(Math.max(min, Math.min(max, n)));
};
setInterval(() => {
  Object.keys(PACIENTES).forEach((pid) => {
    // Rosa la actualiza su propio celular mientras la pantalla del paciente está abierta
    if (pid === PACIENTE_PROPIO && pulseraVirtual.conectada) return;
    const ruta = `pacientes/${pid}/signos_actuales/live`;
    const s = leerDoc(ruta) || SIGNOS_INICIALES[pid];
    escribirDoc(ruta, {
      ...s,
      bpm: varia(s.bpm, 64, 84, 2),
      spo2: varia(s.spo2, 95, 99, 1),
      timestamp: SENTINELA_HORA,
    });
  });
}, 4000);

// ---------------------------------------------------------------- Pulsera virtual
// La implementación del Bluetooth simulado (demo/ble-plx.js) se registra acá
export const pulseraVirtual = {
  conectada: false,
  encendida: true,
  modo: 'midiendo_inicial',   // 'midiendo_inicial' | 'medir' | 'midiendo' | 'pausa' | 'sin_muneca'
  bateria: 82,
  emitir: null,               // (uuidCaracteristica, texto) => void
  desconectar: null,          // () => void
};

// Alerta creada directamente en la base (cuando la pantalla del paciente no está abierta)
const alertaDirecta = (tipo, pid = PACIENTE_PROPIO) => {
  const id = nuevoId();
  escribirDoc(`pacientes/${pid}/alertas_criticas/${id}`, {
    tipo, activa: true, origen: 'pulsera', timestamp: SENTINELA_HORA, creadaEnMs: Date.now(),
    ubicacion: (leerDoc(`pacientes/${pid}/signos_actuales/live`) || {}).ubicacion || UBICACION,
  });
};

const ultimaAlerta = (pid) => {
  const lista = docsDeColeccion(`pacientes/${pid}/alertas_criticas`)
    .sort((a, b) => (b.datos.timestamp?.toMillis?.() || 0) - (a.datos.timestamp?.toMillis?.() || 0));
  return lista[0] || null;
};

const CARACT_CAIDA = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const CARACT_SOS = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';

const ejecutar = (comando, arg) => {
  const pid = arg && arg.length === 8 ? arg : PACIENTE_PROPIO;
  switch (comando) {
    case 'caida':
    case 'sos': {
      const tipo = comando === 'caida' ? 'CAIDA' : 'SOS';
      if (pid === PACIENTE_PROPIO && pulseraVirtual.conectada && pulseraVirtual.emitir) {
        pulseraVirtual.emitir(tipo === 'CAIDA' ? CARACT_CAIDA : CARACT_SOS, '1');
        setTimeout(() => pulseraVirtual.emitir && pulseraVirtual.emitir(tipo === 'CAIDA' ? CARACT_CAIDA : CARACT_SOS, '0'), 2500);
      } else {
        alertaDirecta(tipo, pid);
      }
      break;
    }
    case 'visto': {
      const al = ultimaAlerta(pid);
      if (al) {
        escribirDoc(al.ruta, { vistas: { lucia001: { nombre: 'Lucía', vinculo: 'Hijo/a', vistoEn: SENTINELA_HORA, vistoEnMs: Date.now() } } }, { merge: true });
      }
      break;
    }
    case 'cancelar': {
      const al = ultimaAlerta(pid);
      if (al) escribirDoc(al.ruta, { activa: false, canceladaPor: 'familiar', canceladaEn: SENTINELA_HORA }, { merge: true });
      break;
    }
    case 'medir': case 'midiendo': case 'pausa': case 'sin_muneca':
      pulseraVirtual.modo = comando;
      break;
    case 'apagar_pulsera':
      pulseraVirtual.encendida = false;
      if (pulseraVirtual.desconectar) pulseraVirtual.desconectar();
      break;
    case 'prender_pulsera':
      pulseraVirtual.encendida = true;
      break;
    case 'bateria_baja': pulseraVirtual.bateria = 12; break;
    case 'bateria_ok': pulseraVirtual.bateria = 82; break;
    case 'familia_on': vincularFamilia(true); break;
    case 'familia_off': vincularFamilia(false); break;
    case 'ir': {
      const nav = global.__demoNav;
      if (nav && nav.isReady()) {
        if (arg === 'FamilyDashboard') nav.navigate('FamilyDashboard', { patientId: PACIENTE_PROPIO });
        else if (arg && arg.startsWith('FamilyDashboard-')) nav.navigate('FamilyDashboard', { patientId: arg.split('-')[1] });
        else if (arg === 'atras') nav.goBack();
        else if (arg) nav.navigate(arg);
      }
      break;
    }
    case 'reset':
      documentos.clear();
      sembrar();
      pulseraVirtual.modo = 'medir';
      pulseraVirtual.bateria = 82;
      break;
    default:
      console.log('[Demo] Comando desconocido:', comando);
  }
};

const manejarEnlace = (url) => {
  if (!url) return;
  const m = url.match(/^vitalink:\/\/demo\/([^/?#]+)(?:\/([^?#]+))?/);
  if (!m) return;
  console.log('[Demo] Comando:', m[1], m[2] || '');
  ejecutar(m[1], m[2]);
};
Linking.addEventListener('url', ({ url }) => manejarEnlace(url));
Linking.getInitialURL().then(manejarEnlace).catch(() => {});
