// Sirena de emergencia dentro de la app.
// Suena por el canal de "multimedia", por eso se escucha aunque el celular esté en silencio
// (el modo silencio solo apaga el timbre y las notificaciones, no la multimedia).
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let player = null;
let sonando = false;

export const iniciarSirena = async () => {
  if (sonando) return;
  sonando = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      allowsRecording: false,
    });
  } catch (e) {}
  try {
    if (!player) player = createAudioPlayer(require('../assets/sonidos/alarma.wav'));
    player.loop = true;
    player.volume = 1.0;
    if (!sonando) return; // se detuvo mientras se preparaba
    player.seekTo(0).catch(() => {});
    player.play();
  } catch (e) {
    console.warn('No se pudo reproducir la sirena:', e);
  }
};

export const detenerSirena = () => {
  sonando = false;
  try { player?.pause(); } catch (e) {}
};
