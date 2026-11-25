// Firestore simulado para el MODO DEMO (ver demo/estado.js)
import {
  Timestamp, SENTINELA_HORA, leerDoc, docsDeColeccion, escribirDoc, borrarDoc, agregarOyente, nuevoId, clonar,
} from './estado';

export { Timestamp };

const DB = { __db: true };
export const getFirestore = () => DB;
export default () => DB;

const unir = (base, segmentos) => [base, ...segmentos].filter(Boolean).join('/');

const crearDocRef = (ruta) => {
  const partes = ruta.split('/');
  return {
    tipo: 'doc', path: ruta, id: partes[partes.length - 1],
    get parent() { return crearColRef(partes.slice(0, -1).join('/')); },
  };
};
const crearColRef = (ruta) => {
  const partes = ruta.split('/');
  return { tipo: 'col', path: ruta, id: partes[partes.length - 1] };
};

export const collection = (padre, ...segmentos) => crearColRef(unir(padre && padre.path, segmentos));

export const doc = (padre, ...segmentos) => {
  if (padre && padre.tipo === 'col' && segmentos.length === 0) return crearDocRef(`${padre.path}/${nuevoId()}`);
  return crearDocRef(unir(padre && padre.path, segmentos));
};

export const orderBy = (campo, dir = 'asc') => ({ tipo: 'orden', campo, dir });
export const limit = (n) => ({ tipo: 'limite', n });
export const where = (campo, op, valor) => ({ tipo: 'filtro', campo, op, valor });
export const query = (col, ...restricciones) => ({ tipo: 'query', col, restricciones });

export const serverTimestamp = () => SENTINELA_HORA;

const valorOrden = (v) => (v && v.toMillis ? v.toMillis() : v);

const snapshotDoc = (ref) => {
  const datos = leerDoc(ref.path);
  return {
    id: ref.id,
    ref,
    exists: () => datos !== null,
    data: () => (datos === null ? undefined : clonar(datos)),
    get: (campo) => (datos ? datos[campo] : undefined),
  };
};

const snapshotQuery = (q) => {
  const col = q.tipo === 'query' ? q.col : q;
  const restricciones = q.tipo === 'query' ? q.restricciones : [];
  let lista = docsDeColeccion(col.path).map(({ ruta }) => snapshotDoc(crearDocRef(ruta)));
  restricciones.forEach((r) => {
    if (r.tipo === 'filtro') {
      lista = lista.filter((s) => {
        const v = s.get(r.campo);
        if (r.op === '==') return v === r.valor;
        if (r.op === '!=') return v !== r.valor;
        return true;
      });
    }
    if (r.tipo === 'orden') {
      lista.sort((a, b) => {
        const va = valorOrden(a.get(r.campo));
        const vb = valorOrden(b.get(r.campo));
        if (va === vb) return 0;
        const cmp = va > vb ? 1 : -1;
        return r.dir === 'desc' ? -cmp : cmp;
      });
    }
    if (r.tipo === 'limite') lista = lista.slice(0, r.n);
  });
  return { docs: lista, empty: lista.length === 0, size: lista.length, forEach: (fn) => lista.forEach(fn) };
};

export const onSnapshot = (objetivo, siguiente, alError) => {
  const cb = typeof siguiente === 'function' ? siguiente : (siguiente && siguiente.next);
  if (!cb) return () => {};
  if (objetivo.tipo === 'doc') {
    return agregarOyente({ tipo: 'doc', ruta: objetivo.path, emitir: () => cb(snapshotDoc(objetivo)) });
  }
  const col = objetivo.tipo === 'query' ? objetivo.col : objetivo;
  return agregarOyente({ tipo: 'col', ruta: col.path, emitir: () => cb(snapshotQuery(objetivo)) });
};

const esperar = () => new Promise((r) => setTimeout(r, 60));

export const getDoc = async (ref) => { await esperar(); return snapshotDoc(ref); };
export const getDocs = async (q) => { await esperar(); return snapshotQuery(q); };
export const setDoc = async (ref, datos, opciones) => { escribirDoc(ref.path, datos, opciones || {}); };
export const updateDoc = async (ref, datos) => { escribirDoc(ref.path, datos, { merge: true }); };
export const addDoc = async (col, datos) => {
  const ref = crearDocRef(`${col.path}/${nuevoId()}`);
  escribirDoc(ref.path, datos);
  return ref;
};
export const deleteDoc = async (ref) => { borrarDoc(ref.path); };
