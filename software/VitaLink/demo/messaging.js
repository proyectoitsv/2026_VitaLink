// Firebase Messaging simulado para el MODO DEMO (sin notificaciones push reales)
const mensajeria = {};
export const getMessaging = () => mensajeria;
export default () => mensajeria;
export const getToken = async () => 'token-demo';
export const onTokenRefresh = () => () => {};
export const onMessage = () => () => {};
export const setBackgroundMessageHandler = () => {};
export const requestPermission = async () => 1;
