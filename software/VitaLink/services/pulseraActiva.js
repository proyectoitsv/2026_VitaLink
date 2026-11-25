// Referencia compartida a la pulsera conectada, para que otras pantallas
// (por ejemplo, la calibración) puedan usar la misma conexión Bluetooth.
let dispositivo = null;
const escuchas = new Set();

export const setPulseraActiva = (d) => {
  dispositivo = d;
  escuchas.forEach((fn) => { try { fn(d); } catch (e) {} });
};

export const getPulseraActiva = () => dispositivo;

export const escucharPulseraActiva = (fn) => {
  escuchas.add(fn);
  return () => escuchas.delete(fn);
};
