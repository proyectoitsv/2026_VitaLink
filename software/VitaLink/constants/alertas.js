import { useEffect, useRef, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, setDoc, serverTimestamp } from '@react-native-firebase/firestore';

// La alerta queda activa hasta que el familiar (o el paciente) la cancela,
// pero nunca más de este tiempo para que no quede sonando para siempre.
export const ALERTA_DURACION_MAX_MS = 30 * 60 * 1000; // 30 minutos

export const TIPOS_ALERTA = {
  CAIDA: { titulo: 'CAÍDA DETECTADA', tituloLargo: 'Caída detectada', corto: 'CAÍDA', icono: 'human-handsdown' },
  SOS: { titulo: 'SOS ACTIVADO', tituloLargo: 'Pedido de ayuda', corto: 'SOS', icono: 'alarm-light' },
};

export const infoTipoAlerta = (tipo) => TIPOS_ALERTA[tipo] || TIPOS_ALERTA.CAIDA;

export const inicioAlertaMs = (al) => {
  if (al?.timestamp?.toMillis) return al.timestamp.toMillis();
  if (typeof al?.creadaEnMs === 'number') return al.creadaEnMs;
  return Date.now();
};

export const formatearDuracion = (ms) => {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/**
 * Escucha la última alerta crítica de un paciente y devuelve la que esté activa.
 * Una alerta deja de estar activa cuando alguien la cancela (activa=false)
 * o cuando supera ALERTA_DURACION_MAX_MS.
 */
export function useAlertaActiva(db, patientId) {
  const [alerta, setAlerta] = useState(null);
  const alertaRef = useRef(null);

  useEffect(() => {
    if (!patientId) return undefined;
    let expiryTimer = null;
    const limpiar = () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = null;
    };
    const publicar = (val) => {
      alertaRef.current = val;
      setAlerta(val);
    };

    const q = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
    const unsub = onSnapshot(q, (snap) => {
      limpiar();
      if (!snap || snap.empty) return publicar(null);
      const docSnap = snap.docs[0];
      const data = docSnap.data();
      if (data.activa === false) return publicar(null);

      const inicio = inicioAlertaMs(data);
      const restante = ALERTA_DURACION_MAX_MS - (Date.now() - inicio);
      if (restante <= 0) return publicar(null);

      publicar({ ...data, id: docSnap.id, ref: docSnap.ref, inicioMs: inicio });
      expiryTimer = setTimeout(() => publicar(null), restante);
    }, () => {});

    return () => {
      limpiar();
      unsub();
    };
  }, [patientId]);

  return [alerta, alertaRef];
}

// ---------------------------------------------------------------------------
// "Visto por": cada familiar que abre la alerta queda registrado en el documento
// (campo vistas.{familiarUid}) y el paciente lo ve en tiempo real.
// ---------------------------------------------------------------------------

const VINCULO_DESDE_PACIENTE = {
  'Papá': 'tu papá',
  'Mamá': 'tu mamá',
  'Abuelo/a': 'tu abuelo/a',
  'Hijo/a': 'tu hijo/a',
  'Pareja': 'tu pareja',
  'Hermano/a': 'tu hermano/a',
};

/** Cómo se presenta un familiar al paciente: { titulo: 'Juan', detalle: 'tu papá' } */
export const describirFamiliar = (v) => {
  const vinculo = VINCULO_DESDE_PACIENTE[v?.vinculo] || null;
  const nombre = (v?.nombre || '').trim();
  if (nombre) return { titulo: nombre, detalle: vinculo };
  if (vinculo) return { titulo: vinculo.charAt(0).toUpperCase() + vinculo.slice(1), detalle: null };
  return { titulo: 'Un familiar', detalle: null };
};

export const inicialesFamiliar = (v) => {
  const nombre = (v?.nombre || '').trim();
  if (nombre) return nombre.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return null;
};

/** Lista ordenada (el primero que la vio, primero) */
export const listaVistas = (alerta) => {
  const vistas = alerta?.vistas || {};
  return Object.entries(vistas)
    .map(([uid, v]) => ({ uid, ...v, ms: v?.vistoEn?.toMillis ? v.vistoEn.toMillis() : (v?.vistoEnMs || Date.now()) }))
    .sort((a, b) => a.ms - b.ms);
};

export const marcarAlertaVista = (alerta, { uid, nombre, vinculo }) => {
  if (!alerta?.ref || !uid) return Promise.resolve();
  return setDoc(alerta.ref, {
    vistas: {
      [uid]: {
        nombre: nombre || '',
        vinculo: vinculo || '',
        vistoEn: serverTimestamp(),
        vistoEnMs: Date.now(),
      },
    },
  }, { merge: true });
};

export const cancelarAlerta = (alerta, canceladaPor) => {
  if (!alerta?.ref) return Promise.resolve();
  return setDoc(alerta.ref, {
    activa: false,
    canceladaPor,
    canceladaEn: serverTimestamp(),
  }, { merge: true });
};
