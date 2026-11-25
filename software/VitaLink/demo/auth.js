// Firebase Auth simulado para el MODO DEMO: siempre hay un usuario anónimo
import { UID_DEMO } from './estado';

const usuario = { uid: UID_DEMO, isAnonymous: true };
const oyentes = new Set();

const auth = {
  currentUser: usuario,
  onAuthStateChanged: (cb) => {
    oyentes.add(cb);
    setTimeout(() => cb(auth.currentUser), 0);
    return () => oyentes.delete(cb);
  },
};

export const getAuth = () => auth;
export default () => auth;
export const onAuthStateChanged = (a, cb) => auth.onAuthStateChanged(cb);
export const signInAnonymously = async () => ({ user: usuario });
// En la demo nunca se cierra la sesión (se sigue mostrando la misma cuenta de ejemplo)
export const signOut = async () => {};
