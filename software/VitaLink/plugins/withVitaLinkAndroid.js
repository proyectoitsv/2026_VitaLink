// Config plugin de Expo: permisos y servicio en primer plano para monitoreo continuo
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Copia la sirena a res/raw para que el canal de notificación pueda usarla como sonido
const withSonidoAlarma = (config) => withDangerousMod(config, ['android', async (cfg) => {
  const origen = path.join(cfg.modRequest.projectRoot, 'assets', 'sonidos', 'alarma.wav');
  const destinoDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
  fs.mkdirSync(destinoDir, { recursive: true });
  fs.copyFileSync(origen, path.join(destinoDir, 'alarma.wav'));
  return cfg;
}]);

const PERMISOS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.WAKE_LOCK',
  'android.permission.VIBRATE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.ACCESS_NOTIFICATION_POLICY',
  // "Mostrar sobre otras apps": permite abrir la pantalla de emergencia desde segundo plano
  'android.permission.SYSTEM_ALERT_WINDOW',
];

module.exports = function withVitaLinkAndroid(config) {
  config = withSonidoAlarma(config);
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    manifest['uses-permission'] = manifest['uses-permission'] || [];
    for (const p of PERMISOS) {
      if (!manifest['uses-permission'].some((u) => u.$['android:name'] === p)) {
        manifest['uses-permission'].push({ $: { 'android:name': p } });
      }
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== 'app.notifee.core.ForegroundService');
    app.service.push({
      $: {
        'android:name': 'app.notifee.core.ForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'connectedDevice|location|specialUse',
        'tools:replace': 'android:foregroundServiceType',
      },
      property: [{
        $: {
          'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
          'android:value': 'Monitoreo continuo de alertas de caidas de un paciente vinculado',
        },
      }],
    });

    // Permite que la pantalla de emergencia aparezca aunque el celular esté bloqueado
    const main = app.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    }
    return cfg;
  });
};
