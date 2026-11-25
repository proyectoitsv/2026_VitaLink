// Vigila en segundo plano a todos los pacientes vinculados a este familiar
// y dispara notificaciones de emergencia y de batería baja.
import { AppState } from 'react-native';
import { getAuth, signInAnonymously, onAuthStateChanged } from '@react-native-firebase/auth';
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, limit, setDoc, deleteDoc, serverTimestamp,
} from '@react-native-firebase/firestore';
import { getMessaging, getToken, onTokenRefresh } from '@react-native-firebase/messaging';
import { ALERTA_DURACION_MAX_MS, inicioAlertaMs } from '../constants/alertas';
import {
  mostrarEmergencia, cancelarNotificacionEmergencia, mostrarBateriaBaja, crearDetectorBateria,
  actualizarModoServicio, solicitarPermisoNotificaciones,
} from './notificaciones';

let iniciado = false;
let familyUid = null;
let tokenFcm = null;
const pacientes = new Map(); // patientId -> { unsubs, nombre, alertaNotificada, detectorBateria }
let pacienteEnPantalla = null;

/** El panel del familiar avisa qué paciente está mirando para no duplicar la alarma */
export const setPacienteEnPantalla = (patientId) => { pacienteEnPantalla = patientId; };

const registrarSuscripcion = (patientId) => {
  if (!familyUid || !tokenFcm) return;
  setDoc(doc(getFirestore(), 'pacientes', patientId, 'suscriptores', familyUid), {
    fcmToken: tokenFcm,
    plataforma: 'android',
    actualizado: serverTimestamp(),
  }, { merge: true }).catch(() => {});
};

const actualizarServicio = () => {
  const n = pacientes.size;
  actualizarModoServicio('familia', n > 0
    ? { texto: n === 1 ? 'Protegiendo a 1 familiar' : `Protegiendo a ${n} familiares` }
    : null);
};

const seguirPaciente = (patientId) => {
  const db = getFirestore();
  const estado = {
    nombre: '',
    alertaNotificada: null,
    detectorBateria: crearDetectorBateria((nivel) => mostrarBateriaBaja({
      clave: patientId, nombre: estado.nombre, nivel, patientId, rol: 'familia',
    })),
    expiryTimer: null,
    unsubs: [],
  };

  estado.unsubs.push(onSnapshot(doc(db, 'pacientes', patientId), (snap) => {
    if (snap?.exists()) estado.nombre = (snap.data().nombre || '').trim().split(' ')[0];
  }, () => {}));

  estado.unsubs.push(onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (snap) => {
    if (snap?.exists()) estado.detectorBateria(snap.data().bateria);
  }, () => {}));

  const q = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
  estado.unsubs.push(onSnapshot(q, (snap) => {
    if (estado.expiryTimer) { clearTimeout(estado.expiryTimer); estado.expiryTimer = null; }
    const cerrarPrevia = () => {
      if (estado.alertaNotificada) {
        cancelarNotificacionEmergencia(estado.alertaNotificada);
        estado.alertaNotificada = null;
      }
    };
    if (!snap || snap.empty) return cerrarPrevia();

    const d = snap.docs[0];
    const al = d.data();
    const restante = ALERTA_DURACION_MAX_MS - (Date.now() - inicioAlertaMs(al));
    if (al.activa === false || restante <= 0) return cerrarPrevia();

    if (estado.alertaNotificada && estado.alertaNotificada !== d.id) cerrarPrevia();
    estado.expiryTimer = setTimeout(cerrarPrevia, restante);
    if (estado.alertaNotificada === d.id) return;

    estado.alertaNotificada = d.id;
    const mirandoAhora = AppState.currentState === 'active' && pacienteEnPantalla === patientId;
    if (!mirandoAhora) {
      mostrarEmergencia({ alertaId: d.id, tipo: al.tipo, nombre: estado.nombre, patientId, rol: 'familia' });
    }
  }, () => {}));

  pacientes.set(patientId, estado);
  registrarSuscripcion(patientId);
};

const dejarDeSeguir = (patientId) => {
  const estado = pacientes.get(patientId);
  if (!estado) return;
  estado.unsubs.forEach((u) => { try { u(); } catch (e) {} });
  if (estado.expiryTimer) clearTimeout(estado.expiryTimer);
  if (estado.alertaNotificada) cancelarNotificacionEmergencia(estado.alertaNotificada);
  pacientes.delete(patientId);
  if (familyUid) deleteDoc(doc(getFirestore(), 'pacientes', patientId, 'suscriptores', familyUid)).catch(() => {});
};

const prepararFcm = async () => {
  try {
    const messaging = getMessaging();
    tokenFcm = await getToken(messaging);
    pacientes.forEach((_, pid) => registrarSuscripcion(pid));
    onTokenRefresh(messaging, (t) => {
      tokenFcm = t;
      pacientes.forEach((_, pid) => registrarSuscripcion(pid));
    });
  } catch (e) {
    console.warn('FCM no disponible:', e?.message);
  }
};

/** Arranca una sola vez; si el familiar no tiene pacientes vinculados no muestra nada */
export const iniciarMonitorFamilia = ({ pedirPermisos = false } = {}) => {
  if (pedirPermisos) solicitarPermisoNotificaciones();
  if (iniciado) return;
  iniciado = true;

  const auth = getAuth();
  if (!auth.currentUser) signInAnonymously(auth).catch(() => {});

  let unsubLista = null;
  onAuthStateChanged(auth, (u) => {
    if (!u || unsubLista) return;
    familyUid = u.uid.substring(0, 8);
    prepararFcm();
    unsubLista = onSnapshot(collection(getFirestore(), 'familiares', familyUid, 'pacientes'), (snap) => {
      const actuales = new Set();
      snap.forEach((d) => actuales.add(d.data().patientId || d.id));
      actuales.forEach((pid) => { if (!pacientes.has(pid)) seguirPaciente(pid); });
      Array.from(pacientes.keys()).forEach((pid) => { if (!actuales.has(pid)) dejarDeSeguir(pid); });
      actualizarServicio();
    }, () => {});
  });
};
