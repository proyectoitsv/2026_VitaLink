// Funciones en la nube de VitaLink: envían notificaciones push (FCM) a los familiares
// aunque tengan la app cerrada.
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const db = getFirestore();

const nombrePaciente = async (patientId) => {
  const snap = await db.doc(`pacientes/${patientId}`).get();
  const nombre = snap.exists ? (snap.get('nombre') || '') : '';
  return nombre.trim().split(' ')[0] || 'Tu familiar';
};

// Envía un mensaje "solo datos" de alta prioridad a todos los familiares suscritos.
// La app lo muestra con su propio canal de alarma (ver index.js de la app).
const enviarAFamiliares = async (patientId, data) => {
  const subs = await db.collection(`pacientes/${patientId}/suscriptores`).get();
  const tokens = subs.docs.map((d) => d.get('fcmToken')).filter(Boolean);
  if (tokens.length === 0) return;

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: Object.fromEntries(Object.entries({ ...data, patientId }).map(([k, v]) => [k, String(v ?? '')])),
    android: { priority: 'high', ttl: 30 * 60 * 1000 },
  });

  // Borrar tokens que ya no existen (app desinstalada)
  const invalidos = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
      invalidos.push(subs.docs.find((d) => d.get('fcmToken') === tokens[i])?.ref);
    }
  });
  await Promise.all(invalidos.filter(Boolean).map((ref) => ref.delete()));
};

// Nueva emergencia (caída o SOS)
exports.avisarEmergencia = onDocumentCreated('pacientes/{patientId}/alertas_criticas/{alertaId}', async (event) => {
  const alerta = event.data?.data();
  if (!alerta || alerta.activa === false) return;
  const { patientId, alertaId } = event.params;
  await enviarAFamiliares(patientId, {
    evento: 'ALERTA',
    alertaId,
    tipo: alerta.tipo || 'CAIDA',
    nombre: await nombrePaciente(patientId),
  });
});

// Emergencia cancelada: se quita la alarma de los celulares de los familiares
exports.avisarAlertaCancelada = onDocumentUpdated('pacientes/{patientId}/alertas_criticas/{alertaId}', async (event) => {
  const antes = event.data?.before.data();
  const despues = event.data?.after.data();
  if (!antes || !despues || antes.activa === false || despues.activa !== false) return;
  const { patientId, alertaId } = event.params;
  await enviarAFamiliares(patientId, { evento: 'ALERTA_CANCELADA', alertaId });
});

// Batería baja: avisa al cruzar 20% y 10%
exports.avisarBateriaBaja = onDocumentWritten('pacientes/{patientId}/signos_actuales/live', async (event) => {
  const antes = parseInt(event.data?.before?.data()?.bateria, 10);
  const ahora = parseInt(event.data?.after?.data()?.bateria, 10);
  if (isNaN(ahora) || ahora <= 0) return;
  const cruzo = (umbral) => ahora <= umbral && (isNaN(antes) || antes > umbral);
  if (!cruzo(20) && !cruzo(10)) return;
  const { patientId } = event.params;
  await enviarAFamiliares(patientId, { evento: 'BATERIA', nivel: ahora, nombre: await nombrePaciente(patientId) });
});
