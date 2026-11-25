import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import App from './App';
import {
  registrarServicioPrimerPlano, mostrarEmergencia, cancelarNotificacionEmergencia, mostrarBateriaBaja,
} from './services/notificaciones';

// Servicio en primer plano: mantiene el monitoreo con la pantalla apagada
registrarServicioPrimerPlano();

// Mensajes push (FCM) que llegan con la app cerrada o en segundo plano.
// Los envía la función en la nube (software/firebase-functions).
export const manejarMensajePush = async (data = {}) => {
  if (data.evento === 'ALERTA') {
    await mostrarEmergencia({ alertaId: data.alertaId, tipo: data.tipo, nombre: data.nombre, patientId: data.patientId, rol: 'familia' });
  } else if (data.evento === 'ALERTA_CANCELADA') {
    await cancelarNotificacionEmergencia(data.alertaId);
  } else if (data.evento === 'BATERIA') {
    await mostrarBateriaBaja({ clave: data.patientId, nombre: data.nombre, nivel: parseInt(data.nivel, 10), patientId: data.patientId, rol: 'familia' });
  }
};

try {
  setBackgroundMessageHandler(getMessaging(), async (msg) => manejarMensajePush(msg?.data));
} catch (e) {}

notifee.onBackgroundEvent(async () => {});

registerRootComponent(App);
