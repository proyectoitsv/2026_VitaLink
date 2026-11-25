import { Platform, PermissionsAndroid, Linking } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidCategory,
  AndroidVisibility,
  AndroidForegroundServiceType,
  AndroidColor,
  AndroidStyle,
} from '@notifee/react-native';
import { infoTipoAlerta } from '../constants/alertas';

export const CANAL_EMERGENCIAS = 'vitalink_emergencias';
// Canal de alarma para el familiar: sirena propia en bucle y puede sonar en "No molestar"
// (Android no deja cambiar el sonido de un canal ya creado, por eso es un canal nuevo)
export const CANAL_ALARMA_FAMILIA = 'vitalink_alarma_familia';
export const CANAL_BATERIA = 'vitalink_bateria';
export const CANAL_MONITOREO = 'vitalink_monitoreo';

const ID_SERVICIO = 'vitalink_servicio';

let canalesListos = null;
export const asegurarCanales = () => {
  if (!canalesListos) {
    canalesListos = Promise.all([
      notifee.createChannel({
        id: CANAL_EMERGENCIAS,
        name: 'Emergencias (caídas y SOS)',
        description: 'Avisos críticos cuando la pulsera detecta una emergencia',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'default',
        vibration: true,
        vibrationPattern: [300, 700, 400, 700, 400, 700],
        lights: true,
        lightColor: AndroidColor.RED,
      }),
      notifee.createChannel({
        id: CANAL_ALARMA_FAMILIA,
        name: 'Alarma de emergencia',
        description: 'Suena como alarma cuando un familiar tiene una caída o pide ayuda',
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: 'alarma',
        bypassDnd: true,
        vibration: true,
        vibrationPattern: [200, 800, 300, 800, 300, 800],
        lights: true,
        lightColor: AndroidColor.RED,
      }),
      notifee.createChannel({
        id: CANAL_BATERIA,
        name: 'Batería de la pulsera',
        importance: AndroidImportance.DEFAULT,
        sound: 'default',
      }),
      notifee.createChannel({
        id: CANAL_MONITOREO,
        name: 'Monitoreo en segundo plano',
        description: 'Notificación fija mientras VitaLink vigila la pulsera o a tus familiares',
        importance: AndroidImportance.LOW,
      }),
    ]).catch((e) => { canalesListos = null; throw e; });
  }
  return canalesListos;
};

export const solicitarPermisoNotificaciones = async () => {
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    await notifee.requestPermission();
  } catch (e) {}
};

// ---------------------------------------------------------------------------
// Notificaciones de emergencia y batería
// ---------------------------------------------------------------------------

/** Muestra la alarma de emergencia. rol: 'familia' | 'paciente' */
export const mostrarEmergencia = async ({ alertaId, tipo, nombre, patientId, rol }) => {
  try {
    await asegurarCanales();
    const info = infoTipoAlerta(tipo);
    const titulo = rol === 'familia' ? `🚨 ${info.titulo}: ${nombre || 'Paciente'}` : `🚨 ${info.titulo}`;
    const cuerpo = rol === 'familia'
      ? `${nombre || 'Tu familiar'} necesita ayuda. Tocá para ver su ubicación y signos vitales.`
      : 'Tu familia fue notificada. Tocá para abrir VitaLink o cancelar si estás bien.';
    await notifee.displayNotification({
      id: `alerta_${alertaId}`,
      title: titulo,
      body: cuerpo,
      data: { rol, patientId: patientId || '', alertaId: alertaId || '' },
      android: {
        channelId: rol === 'familia' ? CANAL_ALARMA_FAMILIA : CANAL_EMERGENCIAS,
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        color: '#C81E24',
        colorized: true,
        ongoing: true,
        autoCancel: false,
        loopSound: rol === 'familia',
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default', launchActivity: 'default' },
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        style: { type: AndroidStyle.BIGTEXT, text: cuerpo },
      },
    });
  } catch (e) {
    console.warn('No se pudo mostrar la notificación de emergencia:', e);
  }
};

export const cancelarNotificacionEmergencia = (alertaId) =>
  notifee.cancelNotification(`alerta_${alertaId}`).catch(() => {});

export const mostrarBateriaBaja = async ({ clave, nombre, nivel, patientId, rol }) => {
  try {
    await asegurarCanales();
    const critica = nivel <= 10;
    await notifee.displayNotification({
      id: `bateria_${clave}`,
      title: critica ? '🪫 Batería crítica de la pulsera' : '🔋 Batería baja de la pulsera',
      body: rol === 'familia'
        ? `La pulsera de ${nombre || 'tu familiar'} tiene ${nivel}% de batería. Recordale cargarla.`
        : `Tu pulsera tiene ${nivel}% de batería. Cargala pronto para no perder el monitoreo.`,
      data: { rol, patientId: patientId || '' },
      android: {
        channelId: CANAL_BATERIA,
        smallIcon: 'ic_launcher',
        color: critica ? '#E04644' : '#E8B04B',
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });
  } catch (e) {}
};

/**
 * Lleva el estado "batería baja" con histéresis para avisar una sola vez:
 * avisa al bajar a 20% y de nuevo a 10%, y se rearma al superar 30%.
 */
export const crearDetectorBateria = (onAviso) => {
  let ultimoUmbral = null; // null | 20 | 10
  return (valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n) || n <= 0) return;
    if (n >= 30) { ultimoUmbral = null; return; }
    if (n <= 10 && ultimoUmbral !== 10) { ultimoUmbral = 10; onAviso(n); return; }
    if (n <= 20 && ultimoUmbral === null) { ultimoUmbral = 20; onAviso(n); }
  };
};

// ---------------------------------------------------------------------------
// Servicio en primer plano (mantiene viva la app con la pantalla apagada)
// ---------------------------------------------------------------------------

let finalizarServicio = null;
let servicioActivo = false;
const modos = { paciente: null, familia: null };

/** Se registra una sola vez en index.js, antes de montar la app */
export const registrarServicioPrimerPlano = () => {
  notifee.registerForegroundService(() => new Promise((resolve) => {
    finalizarServicio = resolve;
  }));
};

const sincronizarServicio = async () => {
  const activos = [modos.paciente, modos.familia].filter(Boolean);
  if (activos.length === 0) {
    if (servicioActivo) {
      servicioActivo = false;
      try { await notifee.stopForegroundService(); } catch (e) {}
      if (finalizarServicio) { finalizarServicio(); finalizarServicio = null; }
    }
    return;
  }

  const tipos = [];
  if (modos.paciente) {
    tipos.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
    if (modos.paciente.conUbicacion) tipos.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION);
  }
  if (modos.familia) tipos.push(AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);

  const titulo = modos.paciente && modos.familia
    ? 'VitaLink activo'
    : modos.paciente ? 'VitaLink · Pulsera' : 'VitaLink · Familia';
  const cuerpo = activos.map((m) => m.texto).join(' · ');

  try {
    await asegurarCanales();
    await notifee.displayNotification({
      id: ID_SERVICIO,
      title: titulo,
      body: cuerpo,
      android: {
        channelId: CANAL_MONITOREO,
        asForegroundService: true,
        foregroundServiceTypes: tipos,
        ongoing: true,
        onlyAlertOnce: true,
        smallIcon: 'ic_launcher',
        color: '#F0524F',
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });
    servicioActivo = true;
  } catch (e) {
    console.warn('No se pudo iniciar el servicio en primer plano:', e);
  }
};

/** modo: 'paciente' | 'familia'; estado: null para apagar, o { texto, conUbicacion } */
export const actualizarModoServicio = (modo, estado) => {
  const previo = modos[modo];
  if (!previo && !estado) return Promise.resolve();
  if (previo && estado && previo.texto === estado.texto && previo.conUbicacion === estado.conUbicacion) return Promise.resolve();
  modos[modo] = estado;
  return sincronizarServicio();
};

// Abre el permiso "Mostrar sobre otras apps". Con él, Android deja que VitaLink se abra sola
// a pantalla completa cuando hay una emergencia aunque esté en segundo plano.
export const abrirPermisoPantallaCompleta = async () => {
  try {
    await Linking.sendIntent('android.settings.action.MANAGE_OVERLAY_PERMISSION');
  } catch (e) {
    try { await Linking.openSettings(); } catch (e2) {}
  }
};

/**
 * Trae VitaLink al frente para mostrar la emergencia a pantalla completa.
 * - Con la pantalla bloqueada: la notificación de pantalla completa ya enciende la pantalla y abre la app.
 * - Con el celular en uso: Android solo permite abrir la app desde segundo plano si el usuario
 *   dio el permiso "Mostrar sobre otras apps"; si no lo dio, queda la notificación como respaldo.
 */
export const traerAppAlFrente = () => Linking.openURL('vitalink://emergencia').catch(() => {});

// Abre el permiso "Acceso a No molestar" para que la alarma suene aunque esté activado
export const abrirAccesoNoMolestar = async () => {
  try {
    await Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
  } catch (e) {
    try { await notifee.openNotificationSettings(CANAL_ALARMA_FAMILIA); } catch (e2) {}
  }
};

export const abrirAjustesBateria = async () => {
  try {
    const restringida = await notifee.isBatteryOptimizationEnabled();
    if (restringida) await notifee.openBatteryOptimizationSettings();
    else await notifee.openPowerManagerSettings();
    return restringida;
  } catch (e) {
    return false;
  }
};
