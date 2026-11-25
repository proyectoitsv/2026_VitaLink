// Configuración de Metro (empaquetador de JavaScript)
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// MODO DEMO (solo para capturas de la presentación): compilando con VITALINK_DEMO=1,
// Firebase y el Bluetooth se reemplazan por versiones simuladas de la carpeta demo/.
// Sin esa variable la app se compila normal y la carpeta demo/ no se incluye.
if (process.env.VITALINK_DEMO === '1') {
  const reemplazos = {
    '@react-native-firebase/auth': 'demo/auth.js',
    '@react-native-firebase/firestore': 'demo/firestore.js',
    '@react-native-firebase/messaging': 'demo/messaging.js',
    'react-native-ble-plx': 'demo/ble-plx.js',
  };
  const resolverOriginal = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (reemplazos[moduleName]) {
      return { type: 'sourceFile', filePath: path.join(__dirname, reemplazos[moduleName]) };
    }
    return resolverOriginal
      ? resolverOriginal(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
  console.log('[VitaLink] Compilando en MODO DEMO (datos simulados)');
}

module.exports = config;
