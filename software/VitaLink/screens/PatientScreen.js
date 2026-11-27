import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PermissionsAndroid, Platform, ActivityIndicator, StatusBar, Image, Vibration, AppState, Modal, Linking, Alert, ScrollView } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, setDoc, getDoc, updateDoc, doc, serverTimestamp, onSnapshot } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { colors } from '../constants/theme';
import { useAlertaActiva, cancelarAlerta, listaVistas } from '../constants/alertas';
import VistoPorFamilia from '../components/VistoPorFamilia';
import { setPulseraActiva } from '../services/pulseraActiva';
import VitalsPanel, { mostrarValor } from '../components/VitalsPanel';
import { EmergencyBackdrop, EmergencyHero, EmergencyStatusPill, EmergencyVitals, HoldToConfirm } from '../components/EmergencyVisuals';
import {
  actualizarModoServicio, mostrarEmergencia, cancelarNotificacionEmergencia, mostrarBateriaBaja,
  crearDetectorBateria, solicitarPermisoNotificaciones, abrirAjustesBateria,
  traerAppAlFrente, abrirPermisoPantallaCompleta,
} from '../services/notificaciones';

// Si no llega un valor de pulso/oxígeno en este tiempo, la pulsera terminó su ciclo de medición
const TIEMPO_SIN_DATOS_PAUSA_MS = 3500;

const bleManager = new BleManager();
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID         = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID        = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BAT_CHAR_UUID         = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const CAIDA_CHAR_UUID       = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const SOS_CHAR_UUID         = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';
const OTA_VERSION_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ad';
const OTA_CONTROL_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ae';
const OTA_DATA_CHAR_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26af';

export default function PatientScreen({ navigation }) {
  const [isScanning, setIsScanning] = useState(false);
  const [device, setDevice] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [disconnectNotice, setDisconnectNotice] = useState(false);

  // Signos vitales
  const [bpm, setBpm] = useState('--');
  const [spo2, setSpo2] = useState('--');
  const [bateria, setBateria] = useState('--');
  const [cargando, setCargando] = useState(false);
  const [alertaCaida, setAlertaCaida] = useState('0');
  const [alertaSOS, setAlertaSOS] = useState('0');

  // Estados OTA y Ajustes
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState('--');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showOtaModal, setShowOtaModal] = useState(false);
  const [otaStatus, setOtaStatus] = useState('idle'); // 'idle' | 'checking' | 'up_to_date' | 'available' | 'downloading' | 'transferring' | 'completed' | 'error'
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaMessage, setOtaMessage] = useState('');

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ nombre: '', apellido: '', avatar: 'account-circle', foto: null, telefonoEmergencia: '' });
  const [location, setLocation] = useState(null);
  const [estadoSensor, setEstadoSensor] = useState('esperando'); // 'calibrando' | 'midiendo' | 'pausa' | 'sin_muneca' | 'esperando'
  const [calibInicioMs, setCalibInicioMs] = useState(null);
  const db = getFirestore();
  const patientUid = user ? user.uid.substring(0, 8) : null;
  const [alertaActiva, alertaActivaRef] = useAlertaActiva(db, patientUid);
  const creandoAlertaRef = useRef(false);
  const estadoSensorRef = useRef('esperando');
  const ultimoVitalRef = useRef(0);
  const userRef = useRef(null);
  const locationRef = useRef(null);
  // Ubicación: problema a mostrar ('permiso' | 'gps' | null) y estado interno
  const [ubicacionProblema, setUbicacionProblema] = useState(null);
  const locationSubRef = useRef(null);
  const puedePreguntarUbicacionRef = useRef(true);
  const iniciarUbicacionRef = useRef(null);
  const ultimaUbicacionSubidaRef = useRef({ lat: null, lng: null, ms: 0 });
  const datosRef = useRef({ bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' });
  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const deviceRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const lastKnownDeviceIdRef = useRef(null);
  const lastDataTimestampRef = useRef(Date.now());
  const scanTimeoutRef = useRef(null);
  const autoReconnectTimerRef = useRef(null);
  const subscriptionsRef = useRef([]);
  const userExplicitlyDisconnectedRef = useRef(false);
  const isUpdatingOtaRef = useRef(false);
  // Control de conexión: cada intento tiene un número de "generación". Los eventos de
  // desconexión de conexiones viejas se ignoran para no entrar en bucles de reconexión.
  const mountedRef = useRef(true);
  const connGenRef = useRef(0);
  const disconnectSubRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const ubicacionPermitidaRef = useRef(false);
  const alertaNotificadaRef = useRef(null);
  const detectorBateriaRef = useRef(crearDetectorBateria((nivel) =>
    mostrarBateriaBaja({ clave: 'propia', nivel, rol: 'paciente' })));
  const otaControlSubRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const actualizarEstadoSensor = (nuevo) => {
    if (estadoSensorRef.current !== nuevo) {
      // Al empezar una medición nueva se arranca la cuenta de los 15 s de estabilización
      if (nuevo === 'calibrando' && estadoSensorRef.current !== 'midiendo') {
        setCalibInicioMs(Date.now());
      }
      estadoSensorRef.current = nuevo;
      setEstadoSensor(nuevo);
    }
  };

  // Procesa cada lectura de pulso u oxígeno para saber si la pulsera está midiendo.
  // La pulsera manda -1 mientras descarta los primeros 15 s (estabilización) o no tiene valor válido.
  const registrarLecturaVital = (val) => {
    const v = String(val).trim();
    if (v === '0') {
      actualizarEstadoSensor('sin_muneca');
      return;
    }
    ultimoVitalRef.current = Date.now();
    const bpmValido = parseInt(datosRef.current.bpm, 10) > 0;
    actualizarEstadoSensor(bpmValido ? 'midiendo' : 'calibrando');
  };

  // Cuando la pulsera deja de mandar valores, pasó al descanso entre mediciones
  useEffect(() => {
    if (!connected) {
      actualizarEstadoSensor('esperando');
      return undefined;
    }
    const t = setInterval(() => {
      const midiendo = estadoSensorRef.current === 'midiendo' || estadoSensorRef.current === 'calibrando';
      if (midiendo && Date.now() - ultimoVitalRef.current > TIEMPO_SIN_DATOS_PAUSA_MS) {
        actualizarEstadoSensor('pausa');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [connected]);

  // Vibración continua mientras la emergencia esté activa
  useEffect(() => {
    if (!alertaActiva) {
      Vibration.cancel();
      if (alertaNotificadaRef.current) {
        cancelarNotificacionEmergencia(alertaNotificadaRef.current);
        alertaNotificadaRef.current = null;
      }
      return undefined;
    }
    try { Vibration.vibrate([0, 600, 400, 600, 1200], true); } catch (e) {}
    return () => Vibration.cancel();
  }, [alertaActiva?.id]);

  // Avisarle a la pulsera para que deje de vibrar:
  //   "V" cuando un familiar ya vio la alerta, "X" cuando la alerta se cancela.
  const avisoPulseraRef = useRef({ alertaId: null, vistaEnviada: false });
  const escribirEnPulsera = (comando) => {
    const dev = deviceRef.current;
    if (!dev || !isConnectedRef.current) return;
    dev.writeCharacteristicWithResponseForService(VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, encodeBase64(comando))
      .catch((e) => console.log('No se pudo avisar a la pulsera:', e?.message));
  };
  const cantidadVistas = alertaActiva ? listaVistas(alertaActiva).length : 0;
  useEffect(() => {
    const aviso = avisoPulseraRef.current;
    if (alertaActiva) {
      if (aviso.alertaId !== alertaActiva.id) {
        aviso.alertaId = alertaActiva.id;
        aviso.vistaEnviada = false;
      }
      if (cantidadVistas > 0 && !aviso.vistaEnviada) {
        aviso.vistaEnviada = true;
        escribirEnPulsera('V');
      }
    } else if (aviso.alertaId) {
      aviso.alertaId = null;
      aviso.vistaEnviada = false;
      escribirEnPulsera('X');
    }
  }, [alertaActiva?.id, cantidadVistas]);

  // Guía para el permiso "Mostrar sobre otras apps" (alerta a pantalla completa con la app cerrada)
  const configurarPantallaCompleta = () => {
    Alert.alert(
      'Alerta a pantalla completa',
      'Para que la emergencia ocupe toda la pantalla aunque la app esté cerrada o estés usando otra app:\n\n1. Buscá VitaLink en la lista.\n2. Activá "Permitir mostrar sobre otras apps".\n3. Volvé a VitaLink.',
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Abrir ajustes',
          onPress: () => {
            abrirPermisoPantallaCompleta();
            const u = userRef.current;
            if (u) {
              setDoc(doc(db, 'pacientes', u.uid.substring(0, 8)), { pantallaCompletaConfigurada: true }, { merge: true }).catch(() => {});
            }
          },
        },
      ]
    );
  };

  // Servicio en primer plano: mantiene la conexión con la pulsera con la pantalla apagada
  useEffect(() => {
    if (connected) {
      actualizarModoServicio('paciente', { texto: 'Pulsera conectada · vigilando caídas', conUbicacion: ubicacionPermitidaRef.current });
    } else if (!userExplicitlyDisconnectedRef.current && lastKnownDeviceIdRef.current && (isScanning || isConnecting)) {
      actualizarModoServicio('paciente', { texto: 'Buscando la pulsera...', conUbicacion: ubicacionPermitidaRef.current });
    } else if (userExplicitlyDisconnectedRef.current) {
      actualizarModoServicio('paciente', null);
    }
  }, [connected, isScanning, isConnecting]);

  // Crea la alerta en Firestore; queda activa hasta que se cancele o venza
  const crearAlertaCritica = (tipo) => {
    const u = userRef.current;
    if (!u || alertaActivaRef.current || creandoAlertaRef.current) return;
    creandoAlertaRef.current = true;

    // El ID se genera en el celular: la pantalla de emergencia aparece al instante
    // aunque no haya internet (Firestore la sube en cuanto vuelva la conexión)
    const ref = doc(collection(db, 'pacientes', u.uid.substring(0, 8), 'alertas_criticas'));

    if (AppState.currentState !== 'active') {
      // App en segundo plano: abrirla a pantalla completa y dejar la notificación de respaldo
      alertaNotificadaRef.current = ref.id;
      mostrarEmergencia({ alertaId: ref.id, tipo, rol: 'paciente' });
      traerAppAlFrente();
    }

    setDoc(ref, {
      tipo,
      activa: true,
      timestamp: serverTimestamp(),
      creadaEnMs: Date.now(),
      ubicacion: locationRef.current ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude } : null,
    })
      .catch((err) => console.warn('No se pudo registrar la alerta:', err))
      .finally(() => {
        setTimeout(() => { creandoAlertaRef.current = false; }, 1500);
      });

    // Sin ubicación todavía: se pide una al GPS y se agrega a la alerta apenas llega
    if (!locationRef.current) {
      const tiempoMax = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
      Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), tiempoMax])
        .then((pos) => {
          if (!pos || !pos.coords) return;
          setLocation(pos.coords);
          return updateDoc(ref, { ubicacion: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } });
        })
        .catch((err) => console.warn('No se pudo agregar la ubicación a la alerta:', err));
    }
  };


  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth);
    let unsubProfile = () => {};

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const uid = u.uid.substring(0, 8);
        await setDoc(doc(db, 'pacientes', uid), {
          creado: serverTimestamp(),
          activo: true
        }, { merge: true });

        unsubProfile = onSnapshot(doc(db, 'pacientes', uid), (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (!data.perfilCompletado && !data.nombre) {
              navigation.replace('PatientOnboarding');
              return;
            }
            if (data.pulseraBleId) {
              lastKnownDeviceIdRef.current = data.pulseraBleId;
              if (!isConnectedRef.current && !isConnectingRef.current && !userExplicitlyDisconnectedRef.current) {
                checkAndAutoConnect();
              }
            }
            setProfile({
              nombre: data.nombre || '',
              apellido: data.apellido || '',
              avatar: data.avatar || 'account-circle',
              foto: data.foto || null,
              telefonoEmergencia: data.telefonoEmergencia || '',
              pantallaCompletaConfigurada: !!data.pantallaCompletaConfigurada
            });
          } else {
            navigation.replace('PatientOnboarding');
          }
        });
      }
    });

    // Ubicación del celular: permiso, GPS encendido, primer dato rápido y seguimiento
    const iniciarUbicacion = async () => {
      try {
        const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
        puedePreguntarUbicacionRef.current = canAskAgain !== false;
        if (status !== 'granted') { setUbicacionProblema('permiso'); return; }
        ubicacionPermitidaRef.current = true;
        if (!(await Location.hasServicesEnabledAsync())) { setUbicacionProblema('gps'); return; }
        setUbicacionProblema(null);
        // Primero la última conocida (instantánea), después una nueva y el seguimiento continuo
        const ultima = await Location.getLastKnownPositionAsync();
        if (ultima && ultima.coords && !locationRef.current) setLocation(ultima.coords);
        if (!locationSubRef.current) {
          locationSubRef.current = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
            (loc) => { setLocation(loc.coords); }
          );
        }
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then((pos) => { if (pos && pos.coords) setLocation(pos.coords); })
          .catch(() => {});
      } catch (e) {
        console.warn('Ubicación:', e);
      }
    };
    iniciarUbicacionRef.current = iniciarUbicacion;
    iniciarUbicacion();

    const interval = setInterval(() => {
      const currentUser = userRef.current;
      const currentLocation = locationRef.current;

      if (currentUser && datosRef.current.bpm !== '--') {
        let pushData = {
          bpm: datosRef.current.bpm,
          spo2: datosRef.current.spo2,
          bateria: datosRef.current.bateria,
          cargando: !!datosRef.current.cargando,
          estadoSensor: estadoSensorRef.current,
          timestamp: serverTimestamp()
        };
        if (currentLocation) {
          pushData.ubicacion = { latitude: currentLocation.latitude, longitude: currentLocation.longitude };
          pushData.ubicacionTs = serverTimestamp();
          ultimaUbicacionSubidaRef.current = { lat: currentLocation.latitude, lng: currentLocation.longitude, ms: Date.now() };
        }
        setDoc(doc(db, 'pacientes', currentUser.uid.substring(0, 8), 'signos_actuales', 'live'), pushData)
          .catch((err) => console.error('Error Firestore:', err));
      } else if (currentUser && currentLocation) {
        // Sin datos de la pulsera igual se comparte la ubicación (sin tocar los signos vitales).
        // Solo si cambió o pasó un minuto, para no gastar escrituras.
        const prev = ultimaUbicacionSubidaRef.current;
        const cambio = prev.lat !== currentLocation.latitude || prev.lng !== currentLocation.longitude;
        if (cambio || Date.now() - prev.ms > 60000) {
          ultimaUbicacionSubidaRef.current = { lat: currentLocation.latitude, lng: currentLocation.longitude, ms: Date.now() };
          setDoc(doc(db, 'pacientes', currentUser.uid.substring(0, 8), 'signos_actuales', 'live'), {
            ubicacion: { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
            ubicacionTs: serverTimestamp(),
          }, { merge: true }).catch((err) => console.error('Error Firestore:', err));
        }
      }
    }, 5000);

    // Intento inicial de auto-conexión
    checkAndAutoConnect();

    // Escuchar cuando la app pasa de segundo plano a primer plano
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      // Al volver (por ejemplo de los ajustes), revisar otra vez el permiso y el GPS
      if (nextState === 'active' && iniciarUbicacionRef.current) iniciarUbicacionRef.current();
      if (nextState === 'active' && !isConnectedRef.current && !userExplicitlyDisconnectedRef.current) {
        console.log('📱 App activa: verificando conexión con pulsera...');
        checkAndAutoConnect();
      }
    });

    solicitarPermisoNotificaciones();

    return () => {
      mountedRef.current = false;
      connGenRef.current++;
      if (disconnectSubRef.current) { try { disconnectSubRef.current.remove(); } catch (e) {} disconnectSubRef.current = null; }
      subscriptionsRef.current.forEach((s) => { try { s.remove(); } catch (e) {} });
      subscriptionsRef.current = [];
      if (deviceRef.current) { deviceRef.current.cancelConnection().catch(() => {}); deviceRef.current = null; }
      isConnectedRef.current = false;
      isConnectingRef.current = false;
      Vibration.cancel();
      setPulseraActiva(null);
      actualizarModoServicio('paciente', null);
      appStateSub.remove();
      unsubAuth();
      unsubProfile();
      clearInterval(interval);
      if (locationSubRef.current) { try { locationSubRef.current.remove(); } catch (e) {} locationSubRef.current = null; }
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (autoReconnectTimerRef.current) clearTimeout(autoReconnectTimerRef.current);
      try { bleManager.stopDeviceScan(); } catch (e) {}
    };
  }, []);

  // Tarjeta "Activá la ubicación": abre el pedido de GPS o los ajustes de la app
  const arreglarUbicacion = async () => {
    if (ubicacionProblema === 'gps') {
      try { await Location.enableNetworkProviderAsync(); } catch (e) {}
    } else if (!puedePreguntarUbicacionRef.current) {
      Linking.openSettings();
      return;
    }
    if (iniciarUbicacionRef.current) iniciarUbicacionRef.current();
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
    }
  };

  const handleDisconnection = (allowAutoReconnect = false) => {
    if (!isConnectedRef.current && !isConnectingRef.current && !deviceRef.current) return;
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    connGenRef.current++; // invalida eventos pendientes de la conexión anterior
    setPulseraActiva(null);
    if (disconnectSubRef.current) {
      try { disconnectSubRef.current.remove(); } catch (e) {}
      disconnectSubRef.current = null;
    }
    if (!mountedRef.current) return;

    // 1. Limpiar suscripciones activas
    if (subscriptionsRef.current) {
      subscriptionsRef.current.forEach(s => {
        try { s.remove(); } catch (e) {}
      });
      subscriptionsRef.current = [];
    }
    if (otaControlSubRef.current) {
      try { otaControlSubRef.current.remove(); } catch (e) {}
      otaControlSubRef.current = null;
    }

    // 2. Liberar dispositivo nativo
    if (deviceRef.current) {
      try {
        deviceRef.current.cancelConnection().catch(() => {});
      } catch (e) {}
      deviceRef.current = null;
    }

    // 3. Vibración de aviso
    try {
      Vibration.vibrate([0, 250, 100, 250]);
    } catch (e) {}

    // 4. Actualizar estado
    setConnected(false);
    setDevice(null);
    setIsConnecting(false);
    setIsScanning(false);
    setBpm('--');
    setSpo2('--');
    setBateria('--');
    setCargando(false);
    setFirmwareVersion('--');
    datosRef.current = { bpm: '--', spo2: '--', bateria: '--', cargando: false, alertaCaida: '0', alertaSOS: '0' };
    if (!isUpdatingOtaRef.current) {
      setDisconnectNotice(true);
    }

    // 5. Auto-reconexión si corresponde
    if (allowAutoReconnect && !userExplicitlyDisconnectedRef.current) {
      if (autoReconnectTimerRef.current) clearTimeout(autoReconnectTimerRef.current);
      // Espera creciente (3s, 6s, 12s... hasta 30s) para no saturar a la pulsera con intentos
      const espera = Math.min(30000, 3000 * Math.pow(2, reconnectAttemptsRef.current));
      reconnectAttemptsRef.current = Math.min(reconnectAttemptsRef.current + 1, 4);
      autoReconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !isConnectedRef.current && !userExplicitlyDisconnectedRef.current) {
          console.log('🔄 Reintentando auto-conexión con pulsera...');
          checkAndAutoConnect();
        }
      }, espera);
    }
  };

  // Watchdog inteligente: No satura BLE y evita desconexiones falsas
  useEffect(() => {
    if (!connected || !device) return;

    let pingFailures = 0;
    const interval = setInterval(async () => {
      if (!isConnectedRef.current || !deviceRef.current) {
        clearInterval(interval);
        return;
      }

      // Pausar watchdog mientras se realiza una actualización OTA por BLE
      if (isUpdatingOtaRef.current) {
        pingFailures = 0;
        lastDataTimestampRef.current = Date.now();
        return;
      }

      // Si llegaron datos de los sensores en los últimos 10 segundos, la pulsera está 100% activa
      const elapsed = Date.now() - lastDataTimestampRef.current;
      if (elapsed < 15000) {
        pingFailures = 0;
        return;
      }

      // Si Android confirma que el enlace cayó, reconectar; si sigue activo no se corta por un ping lento
      const linkId = deviceRef.current?.id;
      const enlazado = linkId ? await bleManager.isDeviceConnected(linkId).catch(() => true) : false;
      if (!enlazado) {
        clearInterval(interval);
        if (isConnectedRef.current) handleDisconnection(true);
        return;
      }

      // Si pasaron más de 15s sin datos de la pulsera, hacer un ping suave
      try {
        const pingPromise = deviceRef.current.readRSSI();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 3000)
        );
        await Promise.race([pingPromise, timeoutPromise]);
        pingFailures = 0;
        lastDataTimestampRef.current = Date.now();
      } catch (err) {
        pingFailures++;
        console.log(`⚠️ Alerta ping BLE (${pingFailures}/3):`, err.message);
        if (pingFailures >= 3) {
          clearInterval(interval);
          if (isConnectedRef.current) {
            console.log('⚡ Pulsera sin respuesta tras 2 pings');
            handleDisconnection(true);
          }
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [connected, device]);

  const checkAndAutoConnect = async () => {
    if (isConnectedRef.current || isConnectingRef.current) return;
    try {
      await requestPermissions();
      // Buscar siempre señal real en el aire para evitar sesiones GATT fantasmas de Android
      startScan(false);
    } catch (err) {
      console.warn('Error en auto-reconexión BLE:', err);
    }
  };

  const startScan = async (isUserInitiated = false) => {
    if (isConnectedRef.current) return;
    if (isConnectingRef.current && !isUserInitiated) return;
    if (isUserInitiated && isConnectingRef.current) {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
    await requestPermissions();
    if (isUserInitiated) {
      userExplicitlyDisconnectedRef.current = false;
      setDisconnectNotice(false);
      setIsScanning(true);
    }

    // Detener cualquier escaneo anterior
    try {
      bleManager.stopDeviceScan();
    } catch (e) {}

    // Limpiar posibles conexiones GATT fantasma en caché de Android antes de escanear
    try {
      const staleList = await bleManager.connectedDevices([VITALINK_SERVICE_UUID]);
      if (staleList && staleList.length > 0) {
        for (const staleDev of staleList) {
          await bleManager.cancelDeviceConnection(staleDev.id).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (e) {}

    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      try { bleManager.stopDeviceScan(); } catch (e) {}
      setIsScanning(false);
      if (!isUserInitiated && !isConnectedRef.current && !isConnectingRef.current && !userExplicitlyDisconnectedRef.current && lastKnownDeviceIdRef.current) {
        autoReconnectTimerRef.current = setTimeout(() => {
          if (!isConnectedRef.current && !isConnectingRef.current) checkAndAutoConnect();
        }, 6000);
      }
    }, isUserInitiated ? 15000 : 8000);

    // allowDuplicates: true y scanMode: 2 (LowLatency) para no perder el paquete SCAN_RSP con el nombre 'VitaLink'
    bleManager.startDeviceScan(null, { allowDuplicates: true, scanMode: 2 }, (error, scannedDevice) => {
      if (error) {
        console.warn('Error escaneo BLE:', error);
        setIsScanning(false);
        return;
      }
      if (!scannedDevice || isConnectedRef.current || isConnectingRef.current) return;

      const name = (scannedDevice.name || scannedDevice.localName || '').trim();
      const lowerName = name.toLowerCase();
      const isVitaLinkName = lowerName.includes('vitalink');
      const isForeignName = lowerName.length > 0 && !isVitaLinkName;
      const isSavedMac = lastKnownDeviceIdRef.current && scannedDevice.id === lastKnownDeviceIdRef.current;

      if (isVitaLinkName || (isSavedMac && !isForeignName)) {
        console.log('🎯 Pulsera VitaLink detectada en escaneo:', scannedDevice.id, name || '(MAC guardada)');
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        try { bleManager.stopDeviceScan(); } catch (e) {}
        setIsScanning(false);
        connectToDevice(scannedDevice);
      }
    });
  };

  const scanAndConnect = () => {
    userExplicitlyDisconnectedRef.current = false;
    startScan(true);
  };

  // Redescubrir todas las características BLE sin cortar el enlace físico innecesariamente
  const refreshDeviceGattCache = async (targetDevice, forceReconnect = false) => {
    const devId = targetDevice?.id || lastKnownDeviceIdRef.current;
    if (!devId) return targetDevice;
    try {
      let activeDev = targetDevice;
      if (forceReconnect) {
        await bleManager.cancelDeviceConnection(devId).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 600));
        activeDev = await bleManager.connectToDevice(devId, { refreshGatt: 'OnConnected' });
        setDevice(activeDev);
        deviceRef.current = activeDev;
        const gen = ++connGenRef.current;
        if (disconnectSubRef.current) { try { disconnectSubRef.current.remove(); } catch (e) {} }
        disconnectSubRef.current = activeDev.onDisconnected(() => {
          if (gen !== connGenRef.current || isUpdatingOtaRef.current) return;
          console.log('⚡ Pulsera desconectada físicamente');
          handleDisconnection(true);
        });
      }
      await new Promise(resolve => setTimeout(resolve, 600));
      await activeDev.discoverAllServicesAndCharacteristics();
      try {
        await activeDev.requestMTU(512);
      } catch (e) {}
      return activeDev;
    } catch (err) {
      console.warn('Error al refrescar caché GATT:', err.message);
      return targetDevice;
    }
  };

  // Ante un error de notificación, confirmar con Android si el enlace realmente se cayó
  const verificarEnlace = async (gen) => {
    const id = deviceRef.current?.id;
    if (!id || gen !== connGenRef.current) return;
    const ok = await bleManager.isDeviceConnected(id).catch(() => false);
    if (!ok && gen === connGenRef.current && isConnectedRef.current) handleDisconnection(true);
  };

  const connectToDevice = async (scannedDevice) => {
    if (isConnectingRef.current || isConnectedRef.current) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    const gen = ++connGenRef.current;
    if (disconnectSubRef.current) {
      try { disconnectSubRef.current.remove(); } catch (e) {}
      disconnectSubRef.current = null;
    }
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    try {
      let activeDevice = null;
      let lastConnectErr = null;

      // Reintento automático ante errores transitorios GATT 133 de Android
      for (let connAttempt = 0; connAttempt < 2; connAttempt++) {
        try {
          const alreadyConn = await bleManager.isDeviceConnected(scannedDevice.id).catch(() => false);
          if (alreadyConn || connAttempt > 0) {
            await bleManager.cancelDeviceConnection(scannedDevice.id).catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 450));
          }
          activeDevice = await bleManager.connectToDevice(scannedDevice.id, {
            refreshGatt: 'OnConnected',
            timeout: 8000
          });
          if (activeDevice) break;
        } catch (connErr) {
          lastConnectErr = connErr;
          console.log(`Intento ${connAttempt + 1} de conexión BLE falló:`, connErr.message);
        }
      }

      if (!activeDevice) {
        throw lastConnectErr || new Error('No se pudo establecer enlace BLE con la pulsera');
      }

      setDevice(activeDevice);
      deviceRef.current = activeDevice;

      if (gen !== connGenRef.current || !mountedRef.current) {
        bleManager.cancelDeviceConnection(activeDevice.id).catch(() => {});
        return;
      }

      // Listener para detectar desconexión si la pulsera se apaga (solo de ESTA conexión)
      disconnectSubRef.current = activeDevice.onDisconnected(() => {
        if (gen !== connGenRef.current) return;
        console.log('⚡ Pulsera desconectada físicamente');
        handleDisconnection(true);
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      await activeDevice.discoverAllServicesAndCharacteristics();

      // Negociar MTU máximo para permitir bloques grandes en OTA
      try {
        const mtuDev = await activeDevice.requestMTU(512);
        if (mtuDev) activeDevice = mtuDev;
      } catch (mtuErr) {
        console.warn('No se pudo negociar MTU 512:', mtuErr);
      }

      // Leer la versión actual del firmware con reintentos suaves sin desconectar el dispositivo
      const tryReadFirmwareVersion = async (dev) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              await new Promise(resolve => setTimeout(resolve, 400));
              await dev.discoverAllServicesAndCharacteristics();
            }
            const versionChar = await dev.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID);
            if (versionChar?.value) {
              const decodedVer = decodeBase64(versionChar.value).trim();
              if (decodedVer && decodedVer !== '--') {
                setFirmwareVersion(decodedVer);
                return true;
              }
            }
          } catch (readErr) {
            console.log(`Intento ${attempt + 1} de lectura de versión OTA:`, readErr.message);
          }
        }
        return false;
      };

      const versionOk = await tryReadFirmwareVersion(activeDevice);
      if (!versionOk) {
        // Verificar mediante RSSI en vivo que la conexión sea real y no caché fantasma
        const rssiDev = await Promise.race([
          activeDevice.readRSSI(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('RSSI_TIMEOUT')), 2500))
        ]);
        if (!rssiDev) {
          throw new Error('Sin respuesta real de la pulsera VitaLink');
        }
      }

      if (gen !== connGenRef.current || !mountedRef.current) return;
      reconnectAttemptsRef.current = 0;
      lastKnownDeviceIdRef.current = activeDevice.id;

      // Guardar el ID de la pulsera en Firestore para que el paciente la recuerde siempre
      if (userRef.current) {
        setDoc(doc(db, 'pacientes', userRef.current.uid.substring(0, 8)), {
          pulseraBleId: activeDevice.id,
          pulseraNombre: activeDevice.name || 'VitaLink'
        }, { merge: true }).catch(() => {});
      }

      isConnectedRef.current = true;
      isConnectingRef.current = false;
      deviceRef.current = activeDevice;
      setPulseraActiva(activeDevice);
      setConnected(true);
      setIsConnecting(false);
      setDisconnectNotice(false);
      lastDataTimestampRef.current = Date.now();
      if (isUpdatingOtaRef.current) {
        isUpdatingOtaRef.current = false;
        setShowOtaModal(false);
        setOtaStatus('idle');
      }

      try {
        Vibration.vibrate([0, 70, 50, 70]); // Vibración sutil de éxito
      } catch (e) {}

      // Limpiar suscripciones anteriores si las hubiera
      if (subscriptionsRef.current) {
        subscriptionsRef.current.forEach(s => {
          try { s.remove(); } catch (e) {}
        });
        subscriptionsRef.current = [];
      }

      const subVer = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const val = decodeBase64(characteristic.value).trim();
          if (val && val !== '--') {
            setFirmwareVersion(val);
          }
        }
      });
      subscriptionsRef.current.push(subVer);

      const subBpm = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
        if (error) {
          if (error.errorCode === 201 || error.message?.toLowerCase().includes('disconnect')) {
            verificarEnlace(gen);
          }
          return;
        }
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value).trim();
          setBpm(val);
          datosRef.current.bpm = val;
          registrarLecturaVital(val);
        }
      });
      subscriptionsRef.current.push(subBpm);

      const subSpo2 = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, SPO2_CHAR_UUID, (error, characteristic) => {
        if (error) {
          if (error.errorCode === 201 || error.message?.toLowerCase().includes('disconnect')) {
            verificarEnlace(gen);
          }
          return;
        }
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value).trim();
          setSpo2(val);
          datosRef.current.spo2 = val;
          registrarLecturaVital(val);
        }
      });
      subscriptionsRef.current.push(subSpo2);

      const subBat = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, BAT_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          // La pulsera manda "porcentaje;cargando" (por ejemplo "85;1")
          const [pct, carga] = decodeBase64(characteristic.value).split(';');
          const enCarga = carga === '1';
          setBateria(pct);
          setCargando(enCarga);
          if (!enCarga) detectorBateriaRef.current(pct);
          datosRef.current.bateria = pct;
          datosRef.current.cargando = enCarga;
        }
      });
      subscriptionsRef.current.push(subBat);

      // La pulsera manda '1' al detectar la emergencia y '0' cuando su alarma interna se reinicia.
      // El '0' se ignora: la alerta sigue activa hasta que el familiar o el paciente la cancelen (o venza).
      const subCaida = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value).trim();
          setAlertaCaida(val);
          datosRef.current.alertaCaida = val;
          if (val === '1') crearAlertaCritica('CAIDA');
          // 'C' = el paciente tocó el botón Cancelar de la pulsera
          if (val === 'C' && alertaActivaRef.current) {
            cancelarAlerta(alertaActivaRef.current, 'paciente').catch(() => {});
          }
        }
      });
      subscriptionsRef.current.push(subCaida);

      const subSos = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, SOS_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value).trim();
          setAlertaSOS(val);
          datosRef.current.alertaSOS = val;
          if (val === '1') crearAlertaCritica('SOS');
        }
      });
      subscriptionsRef.current.push(subSos);

    } catch (e) {
      console.warn('Error connectToDevice:', e);
      if (gen !== connGenRef.current || !mountedRef.current) return;
      if (scannedDevice?.id) {
        bleManager.cancelDeviceConnection(scannedDevice.id).catch(() => {});
      }
      isConnectingRef.current = false;
      setIsConnecting(false);
      handleDisconnection(true);
    }
  };

  // Comparar si la versión remota de Firestore es mayor/distinta a la actual de la pulsera
  const isRemoteVersionNewer = (remoteVer, currentVer) => {
    if (!remoteVer) return false;
    if (!currentVer || currentVer === '--') return true;
    const cleanRemote = String(remoteVer).replace(/^v/i, '').trim();
    const cleanCurrent = String(currentVer).replace(/^v/i, '').trim();
    if (cleanRemote === cleanCurrent) return false;
    const rParts = cleanRemote.split('.').map(n => parseInt(n, 10) || 0);
    const cParts = cleanCurrent.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
      const r = rParts[i] || 0;
      const c = cParts[i] || 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return cleanRemote !== cleanCurrent;
  };

  const checkFirmwareUpdate = async () => {
    setShowSettingsModal(false);
    setOtaStatus('checking');
    setOtaMessage('Buscando actualizaciones en la nube...');
    setShowOtaModal(true);

    if (!connected || !deviceRef.current) {
      setOtaStatus('error');
      setOtaMessage('Conectá tu pulsera VitaLink primero para buscar e instalar actualizaciones.');
      return;
    }

    try {
      // Refrescar lectura de versión por BLE antes de comparar
      let currentVer = firmwareVersion;
      try {
        const versionChar = await deviceRef.current.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID);
        if (versionChar?.value) {
          const decoded = decodeBase64(versionChar.value).trim();
          if (decoded) {
            currentVer = decoded;
            setFirmwareVersion(decoded);
          }
        }
      } catch (e) {
        const refreshed = await refreshDeviceGattCache(deviceRef.current);
        try {
          const retryChar = await refreshed.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID);
          if (retryChar?.value) {
            const decoded = decodeBase64(retryChar.value).trim();
            if (decoded) {
              currentVer = decoded;
              setFirmwareVersion(decoded);
            }
          }
        } catch (err2) {}
      }

      const snap = await getDoc(doc(db, 'configuracion', 'firmware_actual'));
      if (!snap.exists()) {
        setOtaStatus('up_to_date');
        setOtaMessage('No hay actualizaciones publicadas en el servidor.');
        return;
      }

      const data = snap.data();
      if (data && data.version && data.url && isRemoteVersionNewer(data.version, currentVer)) {
        setUpdateInfo({
          version: data.version,
          url: data.url,
          notas: data.notas || 'Mejoras de rendimiento y estabilidad para tu pulsera VitaLink.'
        });
        setOtaStatus('available');
        setOtaMessage('');
      } else {
        setUpdateInfo(null);
        setOtaStatus('up_to_date');
        setOtaMessage(`Tu pulsera ya cuenta con la última versión disponible (v${currentVer !== '--' ? currentVer : data?.version || '1.0.0'}).`);
      }
    } catch (err) {
      console.error('Error consultando firmware_actual:', err);
      setOtaStatus('error');
      setOtaMessage('No se pudo verificar la actualización. Comprobá tu conexión a internet.');
    }
  };

  const startOtaUpdate = async () => {
    if (!deviceRef.current || !updateInfo?.url) return;
    let activeDevice = deviceRef.current;

    isUpdatingOtaRef.current = true;
    setOtaStatus('downloading');
    setOtaProgress(0);
    setOtaMessage('Descargando firmware desde la nube...');

    let readyResolve = null;
    let readyReject = null;
    let okResolve = null;
    let okReject = null;

    try {
      // 1. Descargar el archivo .bin como ArrayBuffer / Uint8Array
      const response = await fetch(updateInfo.url);
      if (!response.ok) {
        throw new Error(`Error al descargar el binario (HTTP ${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const firmwareBytes = new Uint8Array(arrayBuffer);
      const totalBytes = firmwareBytes.byteLength;

      if (totalBytes === 0) {
        throw new Error('El archivo de firmware descargado está vacío.');
      }

      // 2. Verificar que las características OTA estén descubiertas (o refrescar caché GATT si Android tenía la tabla vieja)
      await activeDevice.discoverAllServicesAndCharacteristics();
      try {
        await activeDevice.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID);
      } catch (gattErr) {
        activeDevice = await refreshDeviceGattCache(activeDevice);
      }

      let negotiatedMtu = activeDevice.mtu || 256;
      try {
        const mtuDev = await activeDevice.requestMTU(512);
        if (mtuDev?.mtu) {
          negotiatedMtu = mtuDev.mtu;
        }
      } catch (e) {}

      // Solicitar prioridad de conexión BLE alta (intervalo 7.5ms - 11.25ms) para máxima velocidad OTA
      try {
        await activeDevice.requestConnectionPriority(1);
      } catch (e) {}

      // 3. Suscribirse a OTA_CONTROL_CHAR_UUID para escuchar READY, PROG, OK y errores
      if (otaControlSubRef.current) {
        try { otaControlSubRef.current.remove(); } catch (e) {}
        otaControlSubRef.current = null;
      }

      const readyPromise = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      const okPromise = new Promise((resolve, reject) => {
        okResolve = resolve;
        okReject = reject;
      });

      otaControlSubRef.current = bleManager.monitorCharacteristicForDevice(
        activeDevice.id,
        VITALINK_SERVICE_UUID,
        OTA_CONTROL_CHAR_UUID,
        (error, characteristic) => {
          if (error) return;
          if (characteristic?.value) {
            lastDataTimestampRef.current = Date.now();
            const msg = decodeBase64(characteristic.value).trim();
            console.log('📡 Notificación OTA Control:', msg);

            if (msg === 'READY') {
              if (readyResolve) readyResolve(true);
            } else if (msg.startsWith('PROG:')) {
              const progVal = parseInt(msg.split(':')[1], 10);
              if (!isNaN(progVal)) {
                setOtaProgress(progVal);
              }
            } else if (msg === 'OK') {
              if (okResolve) okResolve(true);
            } else if (msg === 'ERR_BEGIN' || msg === 'ERR_WRITE' || msg === 'ERR_END') {
              const errObj = new Error(`La pulsera reportó un fallo de actualización (${msg})`);
              if (readyReject) readyReject(errObj);
              if (okReject) okReject(errObj);
            }
          }
        }
      );

      // Pequeña pausa para que Android termine de habilitar el descriptor 0x2902 antes de enviar OPEN
      await new Promise(resolve => setTimeout(resolve, 350));

      // 4. Enviar comando OPEN:<tamaño> en Base64
      setOtaMessage('Preparando memoria Flash de la pulsera...');
      const openCmd = encodeBase64(`OPEN:${totalBytes}`);
      await activeDevice.writeCharacteristicWithResponseForService(
        VITALINK_SERVICE_UUID,
        OTA_CONTROL_CHAR_UUID,
        openCmd
      );

      // Fallback de lectura directa si la notificación READY ocurrió mientras se cerraba la escritura BLE
      const pollReadyTimer = setTimeout(async () => {
        try {
          const ctrlChar = await activeDevice.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_CONTROL_CHAR_UUID);
          if (ctrlChar?.value) {
            const val = decodeBase64(ctrlChar.value).trim();
            if (val === 'READY' && readyResolve) readyResolve(true);
          }
        } catch (e) {}
      }, 500);

      // 5. Esperar confirmación READY de la pulsera (máx 10s)
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado esperando READY de la pulsera')), 10000))
      ]);
      clearTimeout(pollReadyTimer);

      // 6. Enviar bloques grandes usando ráfagas WriteWithoutResponse + sincronización periódica WithResponse
      setOtaStatus('transferring');
      setOtaMessage('Transfiriendo actualización rápida por Bluetooth...');

      const CHUNK_SIZE = Math.min(490, Math.max(20, negotiatedMtu - 7));
      const BURST_SYNC_EVERY = 24;
      let chunkIndex = 0;
      let lastReportedPct = -1;

      for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
        if (!isConnectedRef.current) {
          throw new Error('Se interrumpió la conexión Bluetooth durante la transferencia.');
        }

        const end = Math.min(offset + CHUNK_SIZE, totalBytes);
        const chunk = firmwareBytes.subarray(offset, end);

        let binaryStr = '';
        for (let i = 0; i < chunk.length; i++) {
          binaryStr += String.fromCharCode(chunk[i]);
        }
        const base64Block = encodeBase64(binaryStr);

        chunkIndex++;
        const isLastChunk = end >= totalBytes;
        const shouldSyncWithResponse = isLastChunk || (chunkIndex % BURST_SYNC_EVERY === 0);

        if (shouldSyncWithResponse) {
          await activeDevice.writeCharacteristicWithResponseForService(
            VITALINK_SERVICE_UUID,
            OTA_DATA_CHAR_UUID,
            base64Block
          );
        } else {
          await activeDevice.writeCharacteristicWithoutResponseForService(
            VITALINK_SERVICE_UUID,
            OTA_DATA_CHAR_UUID,
            base64Block
          );
        }

        lastDataTimestampRef.current = Date.now();
        const localPct = Math.min(100, Math.round((end / totalBytes) * 100));
        if (localPct !== lastReportedPct) {
          lastReportedPct = localPct;
          setOtaProgress(localPct);
        }
      }

      // 7. Enviar comando DONE a OTA_CONTROL_CHAR_UUID y esperar OK
      setOtaMessage('Verificando integridad del firmware...');
      const doneCmd = encodeBase64('DONE');
      await activeDevice.writeCharacteristicWithResponseForService(
        VITALINK_SERVICE_UUID,
        OTA_CONTROL_CHAR_UUID,
        doneCmd
      );

      await Promise.race([
        okPromise,
        new Promise((resolve) => setTimeout(() => resolve(true), 5000))
      ]);

      // 8. Éxito: mostrar mensaje de reinicio
      setOtaProgress(100);
      setOtaStatus('completed');
      setOtaMessage('Actualización completada, reiniciando pulsera...');
      setFirmwareVersion(updateInfo.version);

      try {
        Vibration.vibrate([0, 100, 80, 150]);
      } catch (e) {}

      if (otaControlSubRef.current) {
        try { otaControlSubRef.current.remove(); } catch (e) {}
        otaControlSubRef.current = null;
      }

      setTimeout(() => {
        isUpdatingOtaRef.current = false;
        setShowOtaModal(false);
        setOtaStatus('idle');
      }, 4500);

    } catch (err) {
      console.error('Error en transferencia OTA:', err);
      try {
        const abortCmd = encodeBase64('ABORT');
        await activeDevice.writeCharacteristicWithResponseForService(
          VITALINK_SERVICE_UUID,
          OTA_CONTROL_CHAR_UUID,
          abortCmd
        ).catch(() => {});
      } catch (e) {}

      if (otaControlSubRef.current) {
        try { otaControlSubRef.current.remove(); } catch (e) {}
        otaControlSubRef.current = null;
      }

      isUpdatingOtaRef.current = false;
      setOtaStatus('error');
      setOtaMessage(err.message || 'Ocurrió un error durante la actualización de la pulsera.');
    }
  };

  const disconnectDevice = async () => {
    userExplicitlyDisconnectedRef.current = true;
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    if (deviceRef.current) {
      try {
        await deviceRef.current.cancelConnection();
      } catch (e) {}
    }
    handleDisconnection(false);
  };

  const getStatusColor = () => {
    if (connected) return '#43C667';
    if (isConnecting || isScanning) return '#D4A359';
    return '#E04644';
  };

  const heartbeatAnim = {
    0: { transform: [{ scale: 1 }] },
    0.15: { transform: [{ scale: 1.18 }] },
    0.3: { transform: [{ scale: 1 }] },
    0.45: { transform: [{ scale: 1.1 }] },
    1: { transform: [{ scale: 1 }] }
  };

  const breatheAnim = {
    0: { transform: [{ scale: 1 }], opacity: 0.85 },
    0.5: { transform: [{ scale: 1.08 }], opacity: 1 },
    1: { transform: [{ scale: 1 }], opacity: 0.85 }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 13) return { text: 'Buen día', icon: 'weather-sunny' };
    if (hour >= 13 && hour < 20) return { text: 'Buenas tardes', icon: 'weather-sunset' };
    return { text: 'Buenas noches', icon: 'weather-night' };
  };
  const greeting = getGreeting();

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      <EmergencyBackdrop visible={!!alertaActiva} />
      {alertaActiva ? (
        <View key="emergencia" style={styles.emergencyContainer}>
          <Animatable.View animation="fadeInDown" delay={420} duration={450}>
            <EmergencyStatusPill inicioMs={alertaActiva.inicioMs} />
          </Animatable.View>

          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Animatable.View animation="zoomIn" delay={250} duration={550} easing="ease-out-back">
              <EmergencyHero compact tipo={alertaActiva.tipo} subtitulo="Quedate tranquilo, ya le avisamos a tu familia con tu ubicación." />
            </Animatable.View>
            <Animatable.View animation="fadeInUp" delay={560} duration={450} style={{ marginTop: 18 }}>
              <EmergencyVitals items={[
                { icon: 'cards-heart', value: mostrarValor(bpm), unit: 'LPM', label: 'Pulso' },
                { icon: 'water', value: mostrarValor(spo2), unit: '%', label: 'Oxígeno' },
              ]} />
            </Animatable.View>
            <Animatable.View animation="fadeInUp" delay={680} duration={450} style={{ marginTop: 14 }}>
              <VistoPorFamilia vistas={listaVistas(alertaActiva)} />
            </Animatable.View>
          </View>

          <Animatable.View animation="fadeInUp" delay={800} duration={450}>
            <HoldToConfirm
              label="Mantené presionado si estás bien"
              holdingLabel="Cancelando alerta..."
              icon="hand-back-right-outline"
              onConfirm={() => cancelarAlerta(alertaActivaRef.current, 'paciente').catch(() => {})}
            />
            <View style={styles.emergencyNotice}>
              <MaterialCommunityIcons name="gesture-tap-hold" size={15} color="rgba(255,255,255,0.7)" style={{ marginRight: 6 }} />
              <Text style={styles.emergencyNoticeText}>O tocá el botón Cancelar de la pulsera</Text>
            </View>
          </Animatable.View>
        </View>
      ) : (
      <Animatable.View key="normal" animation="fadeIn" duration={400} style={{ flex: 1 }}>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity
            style={styles.backCircleBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.8}
          >
            {profile.foto ? (
              <Image source={{ uri: profile.foto }} style={styles.avatarImg} />
            ) : (
              <MaterialCommunityIcons name={profile.avatar || 'account'} size={32} color="#374151" />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.headerSubtitle}>{greeting.text.toUpperCase()}</Text>
            <View style={styles.nameRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {profile.nombre ? profile.nombre.trim().split(' ')[0] : `Paciente`}
              </Text>
              <Animatable.View
                animation={isScanning || isConnecting ? 'flash' : undefined}
                iterationCount="infinite"
                style={[styles.statusDot, { backgroundColor: getStatusColor() }]}
              />
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={() => setShowSettingsModal(true)} activeOpacity={0.7}>
          <MaterialCommunityIcons name="cog-outline" size={24} color="#D1D5DB" />
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.content}>

        {/* Notificación de desconexión flotante */}
        {disconnectNotice && !connected && (
          <Animatable.View animation="bounceInDown" duration={500} style={styles.disconnectToast}>
            <View style={styles.disconnectToastLeft}>
              <MaterialCommunityIcons name="bluetooth-off" size={20} color="#E04644" />
              <Text style={styles.disconnectToastText}>Pulsera desconectada o fuera de alcance</Text>
            </View>
            <TouchableOpacity onPress={() => setDisconnectNotice(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </Animatable.View>
        )}

        {/* VISTA 1: CUANDO LA PULSERA NO ESTÁ CONECTADA */}
        {!connected ? (
          <Animatable.View animation="fadeIn" duration={600} style={styles.notConnectedWrapper}>

            {/* Radar / Animación central */}
            <View style={styles.radarContainer}>
              <Animatable.View
                animation="pulse"
                iterationCount="infinite"
                duration={2600}
                style={styles.radarRingOuter}
              />
              <Animatable.View
                animation="pulse"
                iterationCount="infinite"
                duration={1800}
                style={styles.radarRingInner}
              />
              <Animatable.View
                animation={isScanning ? "rotate" : undefined}
                iterationCount={isScanning ? "infinite" : undefined}
                duration={3000}
                style={[styles.radarCore, isScanning && styles.radarCoreScanning]}
              >
                <MaterialCommunityIcons
                  name={isScanning ? "radar" : isConnecting ? "bluetooth-transfer" : "watch-variant"}
                  size={54}
                  color="#E04644"
                />
              </Animatable.View>
            </View>

            {/* Textos descriptivos */}
            <Text style={styles.notConnectedTitle}>
              {isConnecting ? 'Sincronizando con VitaLink...' : isScanning ? 'Buscando tu Pulsera...' : 'Pulsera Desconectada'}
            </Text>
            <Text style={styles.notConnectedSubtitle}>
              {isConnecting || isScanning
                ? 'Mantené la pulsera cerca de tu teléfono.'
                : 'Conectá tu pulsera VitaLink para visualizar tus signos vitales y mantener informada a tu familia.'}
            </Text>

            {/* Botón principal de conexión */}
            <Animatable.View animation="pulse" iterationCount={isScanning || isConnecting ? undefined : "infinite"} duration={3000} style={{ width: '100%', marginTop: 24 }}>
              <TouchableOpacity
                style={[styles.bigConnectBtn, (isScanning || isConnecting) && styles.bigConnectBtnActive]}
                onPress={scanAndConnect}
                disabled={isScanning || isConnecting}
                activeOpacity={0.8}
              >
                {isScanning || isConnecting ? (
                  <ActivityIndicator color="#FFF" size="small" style={{ marginRight: 10 }} />
                ) : (
                  <MaterialCommunityIcons name="bluetooth-connect" size={22} color="#FFF" style={{ marginRight: 10 }} />
                )}
                <Text style={styles.bigConnectBtnText}>
                  {isScanning ? 'BUSCANDO PULSERA...' : isConnecting ? 'SINCRONIZANDO...' : 'CONECTAR PULSERA'}
                </Text>
              </TouchableOpacity>
            </Animatable.View>

            {/* Consejo útil */}
            <View style={styles.hintCard}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
              <Text style={styles.hintText}>
                Verificá que la pulsera tenga batería y que el Bluetooth de tu celular esté activo.
              </Text>
            </View>

          </Animatable.View>
        ) : (
          /* VISTA 2: PULSERA CONECTADA */
          <Animatable.View animation="fadeInUp" duration={500} style={{ flex: 1 }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
              <View style={styles.connectedStatusBar}>
                <View style={styles.connectedBadge}>
                  <Animatable.View animation="pulse" iterationCount="infinite" duration={1400} style={styles.greenPulseDot} />
                  <Text style={styles.connectedBadgeText}>PULSERA EN LÍNEA</Text>
                </View>
                <TouchableOpacity style={styles.disconnectIconBtn} onPress={disconnectDevice} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="bluetooth-off" size={16} color={colors.textSoft} style={{ marginRight: 6 }} />
                  <Text style={styles.disconnectIconText}>Desconectar</Text>
                </TouchableOpacity>
              </View>

              <VitalsPanel bpm={bpm} spo2={spo2} bateria={bateria} cargando={cargando} estado={estadoSensor} calibInicioMs={calibInicioMs} />

              {ubicacionProblema && (
                <Animatable.View animation="fadeInUp" duration={450}>
                  <TouchableOpacity style={styles.fullscreenCard} onPress={arreglarUbicacion} activeOpacity={0.85}>
                    <View style={styles.fullscreenIcon}>
                      <MaterialCommunityIcons name="map-marker-off" size={20} color={colors.danger} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fullscreenTitle}>
                        {ubicacionProblema === 'gps' ? 'Activá la ubicación del celular' : 'Permití el acceso a la ubicación'}
                      </Text>
                      <Text style={styles.fullscreenText}>Sin ubicación, tu familia no va a poder ver dónde estás si te caés.</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </Animatable.View>
              )}

              {!profile.pantallaCompletaConfigurada && (
                <Animatable.View animation="fadeInUp" duration={450}>
                  <TouchableOpacity style={styles.fullscreenCard} onPress={configurarPantallaCompleta} activeOpacity={0.85}>
                    <View style={styles.fullscreenIcon}>
                      <MaterialCommunityIcons name="cellphone-screenshot" size={20} color={colors.danger} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fullscreenTitle}>Activá la alerta a pantalla completa</Text>
                      <Text style={styles.fullscreenText}>Para que una caída se vea en toda la pantalla aunque la app esté cerrada.</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </Animatable.View>
              )}

              <View style={styles.familyInfoCard}>
                <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.ok} style={{ marginRight: 10 }} />
                <Text style={styles.familyInfoText}>Tu familia recibe tus signos vitales y será avisada al instante si la pulsera detecta una caída.</Text>
              </View>
            </ScrollView>
          </Animatable.View>
        )}

      </View>

      </Animatable.View>
      )}

      {/* Modal de Ajustes (contiene versión y actualización de pulsera + acceso al perfil) */}
      <Modal statusBarTranslucent={true} navigationBarTranslucent={true}
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <View style={styles.otaModalOverlay}>
          <Animatable.View animation="zoomIn" duration={300} style={styles.otaModalCard}>
            <View style={styles.otaModalHeader}>
              <View style={styles.otaModalIconCircle}>
                <MaterialCommunityIcons name="cog-outline" size={26} color="#E04644" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.otaModalTitle}>Ajustes</Text>
                <Text style={styles.otaModalSubtitle}>
                  {connected ? `Pulsera conectada • v${firmwareVersion}` : 'Pulsera desconectada'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowSettingsModal(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Tarjeta de Firmware y Actualización OTA dentro de Ajustes */}
            <View style={[styles.otaSectionCard, { marginBottom: 14, marginTop: 0 }]}>
              <View style={styles.otaVersionRow}>
                <View style={styles.otaVersionBadge}>
                  <MaterialCommunityIcons name="chip" size={18} color="#E04644" style={{ marginRight: 8 }} />
                  <Text style={styles.otaVersionText}>
                    Versión de pulsera: <Text style={styles.otaVersionHighlight}>v{firmwareVersion}</Text>
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.otaCheckBtn}
                onPress={checkFirmwareUpdate}
                disabled={otaStatus === 'checking' || otaStatus === 'downloading' || otaStatus === 'transferring'}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="cloud-download-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.otaCheckBtnText}>Buscar actualización de pulsera</Text>
              </TouchableOpacity>
            </View>

            {/* Alerta a pantalla completa con la app cerrada */}
            <TouchableOpacity
              style={[styles.settingsProfileBtn, { marginBottom: 10 }]}
              onPress={() => { setShowSettingsModal(false); configurarPantallaCompleta(); }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialCommunityIcons name="cellphone-screenshot" size={20} color={colors.danger} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otaCheckBtnText}>Alerta a pantalla completa</Text>
                  <Text style={styles.settingsHint}>Mostrar la emergencia aunque la app esté cerrada</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Permitir que Android no cierre la app en segundo plano */}
            <TouchableOpacity
              style={[styles.settingsProfileBtn, { marginBottom: 10 }]}
              onPress={async () => {
                const restringida = await abrirAjustesBateria();
                if (!restringida) {
                  Alert.alert('Listo', 'VitaLink ya puede funcionar en segundo plano. Si tu celular tiene un "ahorro de batería" propio, agregá VitaLink como excepción.');
                }
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialCommunityIcons name="battery-heart-variant" size={20} color={colors.ok} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otaCheckBtnText}>Monitoreo en segundo plano</Text>
                  <Text style={styles.settingsHint}>Evita que Android cierre VitaLink con la pantalla apagada</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Calibración del detector de caídas (gráfico en vivo y umbrales) */}
            <TouchableOpacity
              style={[styles.settingsProfileBtn, { marginBottom: 10 }]}
              onPress={() => {
                if (!connected) {
                  Alert.alert('Pulsera desconectada', 'Conectá la pulsera para calibrar la detección de caídas.');
                  return;
                }
                setShowSettingsModal(false);
                navigation.navigate('CalibracionCaidas');
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={20} color={colors.oxygen} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otaCheckBtnText}>Calibrar detección de caídas</Text>
                  <Text style={styles.settingsHint}>Gráfico en vivo del acelerómetro y ajuste de umbrales</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Calibración del sensor de pulso (onda en vivo y parámetros) */}
            <TouchableOpacity
              style={[styles.settingsProfileBtn, { marginBottom: 10 }]}
              onPress={() => {
                if (!connected) {
                  Alert.alert('Pulsera desconectada', 'Conectá la pulsera para calibrar el sensor de pulso.');
                  return;
                }
                setShowSettingsModal(false);
                navigation.navigate('CalibracionPulso');
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialCommunityIcons name="heart-pulse" size={20} color={colors.heart} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otaCheckBtnText}>Calibrar sensor de pulso</Text>
                  <Text style={styles.settingsHint}>Onda del pulso en vivo y ajuste del sensor</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Reiniciar la pulsera (por si queda trabada) */}
            <TouchableOpacity
              style={[styles.settingsProfileBtn, { marginBottom: 10 }]}
              onPress={() => {
                if (!connected) {
                  Alert.alert(
                    'Pulsera desconectada',
                    'Para reiniciarla sin el celular, mantené apretados los dos botones de la pulsera durante 5 segundos hasta que vibre.'
                  );
                  return;
                }
                Alert.alert(
                  'Reiniciar pulsera',
                  'La pulsera se va a apagar y prender. Va a estar desconectada unos segundos y después se vuelve a conectar sola.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Reiniciar',
                      style: 'destructive',
                      onPress: () => {
                        setShowSettingsModal(false);
                        escribirEnPulsera('R');
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialCommunityIcons name="restart" size={20} color="#F59E0B" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.otaCheckBtnText}>Reiniciar pulsera</Text>
                  <Text style={styles.settingsHint}>Si se traba o no mide bien</Text>
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {/* Botón para ir a Editar Perfil / Ficha Médica */}
            <TouchableOpacity
              style={styles.settingsProfileBtn}
              onPress={() => {
                setShowSettingsModal(false);
                navigation.navigate('Profile');
              }}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name="account-edit-outline" size={20} color="#FFFFFF" style={{ marginRight: 10 }} />
                <Text style={styles.otaCheckBtnText}>Mi Perfil y Ficha Médica</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </Animatable.View>
        </View>
      </Modal>

      {/* Modal Animado de Actualización OTA */}
      <Modal statusBarTranslucent={true} navigationBarTranslucent={true}
        visible={showOtaModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (otaStatus !== 'downloading' && otaStatus !== 'transferring') {
            setShowOtaModal(false);
          }
        }}
      >
        <View style={styles.otaModalOverlay}>
          <Animatable.View animation="zoomIn" duration={350} style={styles.otaModalCard}>

            {/* Encabezado del Modal */}
            <View style={styles.otaModalHeader}>
              <View style={styles.otaModalIconCircle}>
                <MaterialCommunityIcons
                  name={
                    otaStatus === 'completed' ? 'check-decagram' :
                    otaStatus === 'error' ? 'alert-circle-outline' :
                    otaStatus === 'up_to_date' ? 'shield-check' :
                    'cellphone-arrow-down'
                  }
                  size={28}
                  color={
                    otaStatus === 'completed' || otaStatus === 'up_to_date' ? '#43C667' :
                    otaStatus === 'error' ? '#E04644' : '#E04644'
                  }
                />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.otaModalTitle}>
                  {otaStatus === 'checking' && 'Verificando Firmware'}
                  {otaStatus === 'up_to_date' && 'Pulsera Actualizada'}
                  {otaStatus === 'available' && 'Nueva Actualización Disponible'}
                  {(otaStatus === 'downloading' || otaStatus === 'transferring') && 'Actualizando Pulsera'}
                  {otaStatus === 'completed' && '¡Actualización Exitosa!'}
                  {otaStatus === 'error' && 'Error de Actualización'}
                </Text>
                <Text style={styles.otaModalSubtitle}>
                  Versión actual: v{firmwareVersion}
                </Text>
              </View>
              {otaStatus !== 'downloading' && otaStatus !== 'transferring' && (
                <TouchableOpacity
                  onPress={() => setShowOtaModal(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close" size={22} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>

            {/* Estado: Buscando en Firebase */}
            {otaStatus === 'checking' && (
              <View style={styles.otaStateCenter}>
                <ActivityIndicator size="large" color="#E04644" style={{ marginBottom: 14 }} />
                <Text style={styles.otaMessageText}>{otaMessage}</Text>
              </View>
            )}

            {/* Estado: Ya está al día */}
            {otaStatus === 'up_to_date' && (
              <View style={styles.otaStateCenter}>
                <Text style={styles.otaMessageText}>{otaMessage}</Text>
                <TouchableOpacity
                  style={styles.otaSecondaryBtn}
                  onPress={() => setShowOtaModal(false)}
                >
                  <Text style={styles.otaSecondaryBtnText}>Entendido</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Estado: Nueva versión disponible */}
            {otaStatus === 'available' && updateInfo && (
              <Animatable.View animation="fadeIn" duration={300}>
                <View style={styles.otaReleaseBox}>
                  <View style={styles.otaReleaseHeader}>
                    <Text style={styles.otaReleaseTag}>NUEVA VERSIÓN v{updateInfo.version}</Text>
                  </View>
                  <Text style={styles.otaReleaseNotesTitle}>Notas de la versión:</Text>
                  <Text style={styles.otaReleaseNotesText}>{updateInfo.notas}</Text>
                </View>

                <TouchableOpacity
                  style={styles.otaPrimaryBtn}
                  onPress={startOtaUpdate}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="bluetooth-transfer" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.otaPrimaryBtnText}>Actualizar Pulsera</Text>
                </TouchableOpacity>
              </Animatable.View>
            )}

            {/* Estado: Descargando / Transfiriendo por BLE */}
            {(otaStatus === 'downloading' || otaStatus === 'transferring') && (
              <View style={styles.otaProgressWrapper}>
                <View style={styles.otaProgressHeader}>
                  <Text style={styles.otaProgressLabel}>
                    {otaStatus === 'downloading' ? 'Descargando paquete...' : 'Enviando bloques BLE...'}
                  </Text>
                  <Text style={styles.otaProgressPercent}>{otaProgress}%</Text>
                </View>

                <View style={styles.otaProgressBarBg}>
                  <View style={[styles.otaProgressBarFill, { width: `${otaProgress}%` }]} />
                </View>

                <Text style={styles.otaMessageText}>{otaMessage}</Text>
              </View>
            )}

            {/* Estado: Completado */}
            {otaStatus === 'completed' && (
              <Animatable.View animation="bounceIn" style={styles.otaStateCenter}>
                <View style={styles.otaProgressBarBg}>
                  <View style={[styles.otaProgressBarFill, { width: '100%', backgroundColor: '#43C667' }]} />
                </View>
                <Text style={[styles.otaMessageText, { color: '#43C667', fontWeight: '700', marginTop: 14 }]}>
                  {otaMessage}
                </Text>
              </Animatable.View>
            )}

            {/* Estado: Error */}
            {otaStatus === 'error' && (
              <View style={styles.otaStateCenter}>
                <Text style={[styles.otaMessageText, { color: '#E04644' }]}>{otaMessage}</Text>
                <View style={styles.otaErrorActions}>
                  <TouchableOpacity
                    style={[styles.otaSecondaryBtn, { flex: 1, marginRight: 8 }]}
                    onPress={() => setShowOtaModal(false)}
                  >
                    <Text style={styles.otaSecondaryBtnText}>Cerrar</Text>
                  </TouchableOpacity>
                  {updateInfo && (
                    <TouchableOpacity
                      style={[styles.otaPrimaryBtn, { flex: 1, marginLeft: 8, marginTop: 0 }]}
                      onPress={startOtaUpdate}
                    >
                      <Text style={styles.otaPrimaryBtnText}>Reintentar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

          </Animatable.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 42, paddingBottom: 18 },
  headerContent: { flexDirection: 'row', flex: 1, alignItems: 'center' },
  backCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  headerSubtitle: { color: '#D4A359', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.2, flexShrink: 1 },
  statusDot: { width: 9, height: 9, borderRadius: 4.5, marginLeft: 8, marginTop: 2 },
  profileBtn: { marginLeft: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },

  // Content
  content: { flex: 1, paddingHorizontal: 20 },

  // Toast de desconexión
  disconnectToast: { backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  disconnectToastLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  disconnectToastText: { color: '#E04644', fontSize: 13, fontWeight: '600', marginLeft: 10 },

  // Vista No Conectada
  notConnectedWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  radarContainer: { width: 190, height: 190, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  radarRingOuter: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(224, 70, 68, 0.06)', borderWidth: 1, borderColor: 'rgba(224, 70, 68, 0.16)' },
  radarRingInner: { position: 'absolute', width: 134, height: 134, borderRadius: 67, backgroundColor: 'rgba(224, 70, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(224, 70, 68, 0.24)' },
  radarCore: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.surface, borderWidth: 2, borderColor: '#E04644', justifyContent: 'center', alignItems: 'center' },
  radarCoreScanning: { borderColor: '#D4A359' },
  notConnectedTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  notConnectedSubtitle: { color: '#9CA3AF', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  bigConnectBtn: { backgroundColor: '#E04644', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 17, borderRadius: 22 },
  bigConnectBtnActive: { backgroundColor: '#D4A359' },
  bigConnectBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.6 },
  hintCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, marginTop: 22, marginHorizontal: 6 },
  hintText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', flex: 1 },

  // Barra de estado conectado
  connectedStatusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  connectedBadge: { flex: 1.45, marginRight: 10, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, borderRadius: 21 },
  greenPulseDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.ok, marginRight: 8 },
  connectedBadgeText: { color: colors.ok, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6 },
  disconnectIconBtn: { flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, borderRadius: 21 },
  disconnectIconText: { color: colors.textSoft, fontSize: 13.5, fontWeight: '700' },

  fullscreenCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginTop: 14, borderWidth: 1, borderColor: `${colors.danger}55` },
  fullscreenIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.danger}1F`, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  fullscreenTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  fullscreenText: { color: colors.textMuted, fontSize: 12, fontWeight: '500', lineHeight: 17, marginTop: 2 },
  settingsHint: { color: colors.textMuted, fontSize: 11.5, fontWeight: '500', marginTop: 2 },
  familyInfoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.border },
  familyInfoText: { color: colors.textMuted, fontSize: 12.5, fontWeight: '500', flex: 1, lineHeight: 18 },

  // Modo emergencia (pantalla completa)
  emergencyContainer: { flex: 1, paddingHorizontal: 22, paddingTop: 44, paddingBottom: 30 },
  emergencyNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  emergencyNoticeText: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },

  // Ícono de batería personalizado igual a la referencia
  customBatteryWrap: { alignItems: 'center', marginLeft: 4 },
  customBatteryCap: { width: 12, height: 4, backgroundColor: '#43C667', borderTopLeftRadius: 2, borderTopRightRadius: 2, marginBottom: 1 },
  customBatteryBody: { width: 26, height: 42, borderRadius: 4, borderWidth: 2.5, borderColor: '#43C667', padding: 3, justifyContent: 'space-between' },
  customBatteryBar: { width: '100%', height: 9, backgroundColor: '#43C667', borderRadius: 1.5, marginBottom: 2 },

  // Alerta Crítica
  alertCard: { backgroundColor: '#E04644', flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 22, marginTop: 4, marginBottom: 12 },
  alertTextGroup: { marginLeft: 16, flex: 1 },
  alertTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.4 },
  alertDesc: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '500', marginTop: 2 },

  // Sección OTA en Ajustes
  otaSectionCard: { backgroundColor: colors.bg, borderRadius: 18, padding: 16, marginTop: 4 },
  otaVersionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  otaVersionBadge: { flexDirection: 'row', alignItems: 'center' },
  otaVersionText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  otaVersionHighlight: { color: '#FFFFFF', fontWeight: '800' },
  otaCheckBtn: { backgroundColor: colors.surfaceRaised, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  otaCheckBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  settingsProfileBtn: { backgroundColor: colors.bg, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Modal OTA & Ajustes
  otaModalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.78)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  otaModalCard: { width: '100%', backgroundColor: colors.surface, borderRadius: 24, padding: 22 },
  otaModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  otaModalIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  otaModalTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  otaModalSubtitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', marginTop: 2 },
  otaStateCenter: { alignItems: 'center', paddingVertical: 12 },
  otaMessageText: { color: '#D1D5DB', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20 },
  otaReleaseBox: { backgroundColor: colors.bg, borderRadius: 16, padding: 16, marginBottom: 18 },
  otaReleaseHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  otaReleaseTag: { color: '#E04644', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  otaReleaseNotesTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  otaReleaseNotesText: { color: '#9CA3AF', fontSize: 13, lineHeight: 19 },
  otaPrimaryBtn: { backgroundColor: '#E04644', borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  otaPrimaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  otaSecondaryBtn: { backgroundColor: colors.surfaceRaised, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  otaSecondaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  otaProgressWrapper: { paddingVertical: 8 },
  otaProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  otaProgressLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  otaProgressPercent: { color: '#E04644', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  otaProgressBarBg: { width: '100%', height: 10, backgroundColor: colors.bg, borderRadius: 5, overflow: 'hidden', marginBottom: 14 },
  otaProgressBarFill: { height: '100%', backgroundColor: '#E04644', borderRadius: 5 },
  otaErrorActions: { flexDirection: 'row', width: '100%', marginTop: 16, alignItems: 'center' },
});





