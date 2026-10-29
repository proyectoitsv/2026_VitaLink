import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PermissionsAndroid, Platform, ActivityIndicator, StatusBar, Image, Vibration, AppState, Modal } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, setDoc, getDoc, doc, serverTimestamp, onSnapshot } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

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
  const [alertaCaida, setAlertaCaida] = useState('0');
  const [alertaSOS, setAlertaSOS] = useState('0');

  // Estados OTA
  const [firmwareVersion, setFirmwareVersion] = useState('--');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showOtaModal, setShowOtaModal] = useState(false);
  const [otaStatus, setOtaStatus] = useState('idle'); // 'idle' | 'checking' | 'up_to_date' | 'available' | 'downloading' | 'transferring' | 'completed' | 'error'
  const [otaProgress, setOtaProgress] = useState(0);
  const [otaMessage, setOtaMessage] = useState('');

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ nombre: '', apellido: '', avatar: 'account-circle', foto: null });
  const [location, setLocation] = useState(null);
  const db = getFirestore();
  const userRef = useRef(null);
  const locationRef = useRef(null);
  const datosRef = useRef({ bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' });
  const isConnectedRef = useRef(false);
  const deviceRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const lastKnownDeviceIdRef = useRef(null);
  const lastDataTimestampRef = useRef(Date.now());
  const scanTimeoutRef = useRef(null);
  const autoReconnectTimerRef = useRef(null);
  const subscriptionsRef = useRef([]);
  const userExplicitlyDisconnectedRef = useRef(false);
  const isUpdatingOtaRef = useRef(false);
  const otaControlSubRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
              if (!isConnectedRef.current && !userExplicitlyDisconnectedRef.current) {
                checkAndAutoConnect();
              }
            }
            setProfile({
              nombre: data.nombre || '',
              apellido: data.apellido || '',
              avatar: data.avatar || 'account-circle',
              foto: data.foto || null
            });
          } else {
            navigation.replace('PatientOnboarding');
          }
        });
      }
    });
    
    let locationSub = null;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
          (loc) => {
            setLocation(loc.coords);
          }
        );
      }
    })();

    const interval = setInterval(() => {
      const currentUser = userRef.current;
      const currentLocation = locationRef.current;

      if (currentUser && datosRef.current.bpm !== '--') {
        let pushData = {
          bpm: datosRef.current.bpm,
          spo2: datosRef.current.spo2,
          bateria: datosRef.current.bateria,
          timestamp: serverTimestamp()
        };
        if (currentLocation) {
          pushData.ubicacion = { latitude: currentLocation.latitude, longitude: currentLocation.longitude };
        }
        setDoc(doc(db, 'pacientes', currentUser.uid.substring(0, 8), 'signos_actuales', 'live'), pushData)
          .catch((err) => console.error('Error Firestore:', err));
      }
    }, 5000);

    // Intento inicial de auto-conexión
    checkAndAutoConnect();

    // Escuchar cuando la app pasa de segundo plano a primer plano
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !isConnectedRef.current && !userExplicitlyDisconnectedRef.current) {
        console.log('📱 App activa: verificando conexión con pulsera...');
        checkAndAutoConnect();
      }
    });

    return () => { 
      appStateSub.remove();
      unsubAuth(); 
      unsubProfile(); 
      clearInterval(interval); 
      if (locationSub) locationSub.remove();
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (autoReconnectTimerRef.current) clearTimeout(autoReconnectTimerRef.current);
      try { bleManager.stopDeviceScan(); } catch (e) {}
    };
  }, []);

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
    if (!isConnectedRef.current && !deviceRef.current) return;
    isConnectedRef.current = false;

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
    setFirmwareVersion('--');
    datosRef.current = { bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' };
    if (!isUpdatingOtaRef.current) {
      setDisconnectNotice(true);
    }

    // 5. Auto-reconexión si corresponde
    if (allowAutoReconnect && !userExplicitlyDisconnectedRef.current) {
      if (autoReconnectTimerRef.current) clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = setTimeout(() => {
        if (!isConnectedRef.current && !userExplicitlyDisconnectedRef.current) {
          console.log('🔄 Reintentando auto-conexión con pulsera...');
          checkAndAutoConnect();
        }
      }, 3000);
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
      if (elapsed < 10000) {
        pingFailures = 0;
        return;
      }

      // Si pasaron más de 10s sin datos de la pulsera, hacer un ping suave
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
        console.log(`⚠️ Alerta ping BLE (${pingFailures}/2):`, err.message);
        if (pingFailures >= 2) {
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
    if (isConnectedRef.current) return;
    try {
      await requestPermissions();

      // 1. ¿Está ya conectada en la pila BLE de Android? (Caso típico al reabrir la app)
      const connectedList = await bleManager.connectedDevices([VITALINK_SERVICE_UUID]);
      if (connectedList && connectedList.length > 0) {
        console.log('✅ Pulsera ya enlazada en el sistema:', connectedList[0].id);
        await connectToDevice(connectedList[0]);
        return;
      }

      // 2. ¿Tenemos el ID guardado de la pulsera?
      const savedId = lastKnownDeviceIdRef.current;
      if (savedId) {
        try {
          const isConn = await bleManager.isDeviceConnected(savedId);
          if (isConn) {
            const devs = await bleManager.devices([savedId]);
            if (devs && devs.length > 0) {
              console.log('✅ Conectando directamente por ID conocido:', devs[0].id);
              await connectToDevice(devs[0]);
              return;
            }
          }
        } catch (e) {}
      }

      // 3. Si no está en el sistema, buscarla en segundo plano
      startScan(false);
    } catch (err) {
      console.warn('Error en auto-reconexión BLE:', err);
    }
  };

  const startScan = async (isUserInitiated = false) => {
    if (isConnectedRef.current) return;
    await requestPermissions();
    if (isUserInitiated) {
      userExplicitlyDisconnectedRef.current = false;
      setDisconnectNotice(false);
      setIsScanning(true);
    }

    // Comprobar si ya está conectada antes de escanear
    try {
      const connectedList = await bleManager.connectedDevices([VITALINK_SERVICE_UUID]);
      if (connectedList && connectedList.length > 0) {
        setIsScanning(false);
        await connectToDevice(connectedList[0]);
        return;
      }
    } catch (e) {}

    // Detener cualquier escaneo anterior
    try {
      bleManager.stopDeviceScan();
    } catch (e) {}

    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      bleManager.stopDeviceScan();
      setIsScanning(false);
      if (!isUserInitiated && !isConnectedRef.current && !userExplicitlyDisconnectedRef.current && lastKnownDeviceIdRef.current) {
        autoReconnectTimerRef.current = setTimeout(() => {
          if (!isConnectedRef.current) checkAndAutoConnect();
        }, 8000);
      }
    }, isUserInitiated ? 15000 : 8000);

    bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, scannedDevice) => {
      if (error) {
        console.warn('Error escaneo BLE:', error);
        setIsScanning(false);
        return;
      }
      if (!scannedDevice) return;

      const name = scannedDevice.name || scannedDevice.localName || '';
      const isVitaLinkName = name.toLowerCase().includes('vitalink');
      const isVitaLinkService = scannedDevice.serviceUUIDs && 
        scannedDevice.serviceUUIDs.some(u => u.toLowerCase() === VITALINK_SERVICE_UUID.toLowerCase());
      const isSavedMac = lastKnownDeviceIdRef.current && scannedDevice.id === lastKnownDeviceIdRef.current;

      if (isVitaLinkName || isVitaLinkService || isSavedMac) {
        console.log('🎯 Pulsera VitaLink detectada en escaneo:', scannedDevice.id, name);
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        bleManager.stopDeviceScan();
        setIsScanning(false);
        connectToDevice(scannedDevice);
      }
    });
  };

  const scanAndConnect = () => {
    userExplicitlyDisconnectedRef.current = false;
    startScan(true);
  };

  const connectToDevice = async (scannedDevice) => {
    setIsConnecting(true);
    try {
      // Si el dispositivo ya está conectado al OS, no forzar connect()
      const isAlready = await scannedDevice.isConnected().catch(() => false);
      let activeDevice = scannedDevice;
      if (!isAlready) {
        activeDevice = await scannedDevice.connect();
      }
      setDevice(activeDevice);
      deviceRef.current = activeDevice;
      lastKnownDeviceIdRef.current = activeDevice.id;

      // Guardar el ID de la pulsera en Firestore para que el paciente la recuerde siempre
      if (userRef.current) {
        setDoc(doc(db, 'pacientes', userRef.current.uid.substring(0, 8)), {
          pulseraBleId: activeDevice.id,
          pulseraNombre: activeDevice.name || 'VitaLink'
        }, { merge: true }).catch(() => {});
      }

      // Listener para detectar desconexión si la pulsera se apaga
      activeDevice.onDisconnected((error, disconnectedDev) => {
        console.log('⚡ Pulsera desconectada físicamente');
        handleDisconnection(true);
      });
      
      await new Promise(resolve => setTimeout(resolve, 800));
      await activeDevice.discoverAllServicesAndCharacteristics();

      // Negociar MTU para permitir bloques grandes en OTA
      try {
        await activeDevice.requestMTU(256);
      } catch (mtuErr) {
        console.warn('No se pudo negociar MTU 256:', mtuErr);
      }

      // Leer la versión actual del firmware de la pulsera
      try {
        const versionChar = await activeDevice.readCharacteristicForService(VITALINK_SERVICE_UUID, OTA_VERSION_CHAR_UUID);
        if (versionChar?.value) {
          const decodedVer = decodeBase64(versionChar.value).trim();
          if (decodedVer) {
            setFirmwareVersion(decodedVer);
          }
        }
      } catch (verErr) {
        console.log('Característica de versión OTA no disponible aún:', verErr.message);
      }

      isConnectedRef.current = true;
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

      const subBpm = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
        if (error) {
          if (error.errorCode === 201 || error.message?.toLowerCase().includes('disconnect')) {
            handleDisconnection(true);
          }
          return;
        }
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value);
          setBpm(val);
          datosRef.current.bpm = val;
        }
      });
      subscriptionsRef.current.push(subBpm);

      const subSpo2 = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, SPO2_CHAR_UUID, (error, characteristic) => {
        if (error) {
          if (error.errorCode === 201 || error.message?.toLowerCase().includes('disconnect')) {
            handleDisconnection(true);
          }
          return;
        }
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value);
          setSpo2(val);
          datosRef.current.spo2 = val;
        }
      });
      subscriptionsRef.current.push(subSpo2);

      const subBat = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, BAT_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value);
          setBateria(val);
          datosRef.current.bateria = val;
        }
      });
      subscriptionsRef.current.push(subBat);

      const subCaida = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value);
          setAlertaCaida(val);
          datosRef.current.alertaCaida = val;
          if (val === '1' && userRef.current) {
            addDoc(collection(db, 'pacientes', userRef.current.uid.substring(0, 8), 'alertas_criticas'), { 
              tipo: 'CAIDA', 
              timestamp: serverTimestamp(), 
              ubicacion: locationRef.current ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude } : null 
            });
          }
        }
      });
      subscriptionsRef.current.push(subCaida);

      const subSos = bleManager.monitorCharacteristicForDevice(activeDevice.id, VITALINK_SERVICE_UUID, SOS_CHAR_UUID, (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          lastDataTimestampRef.current = Date.now();
          const val = decodeBase64(characteristic.value);
          setAlertaSOS(val);
          datosRef.current.alertaSOS = val;
          if (val === '1' && userRef.current) {
            addDoc(collection(db, 'pacientes', userRef.current.uid.substring(0, 8), 'alertas_criticas'), { 
              tipo: 'SOS', 
              timestamp: serverTimestamp(), 
              ubicacion: locationRef.current ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude } : null 
            });
          }
        }
      });
      subscriptionsRef.current.push(subSos);

    } catch (e) {
      console.warn('Error connectToDevice:', e);
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
    if (!connected || !deviceRef.current) return;
    setOtaStatus('checking');
    setOtaMessage('Buscando actualizaciones en la nube...');
    setShowOtaModal(true);

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
      } catch (e) {}

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
    const activeDevice = deviceRef.current;

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

      // 2. Negociar MTU antes de transferir
      try {
        await activeDevice.requestMTU(256);
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

      // 4. Enviar comando OPEN:<tamaño> en Base64
      setOtaMessage('Preparando memoria Flash de la pulsera...');
      const openCmd = encodeBase64(`OPEN:${totalBytes}`);
      await activeDevice.writeCharacteristicWithResponseForService(
        VITALINK_SERVICE_UUID,
        OTA_CONTROL_CHAR_UUID,
        openCmd
      );

      // 5. Esperar confirmación READY de la pulsera (máx 10s)
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado esperando READY de la pulsera')), 10000))
      ]);

      // 6. Enviar bloques de 180 bytes codificados en Base64 a OTA_DATA_CHAR_UUID
      setOtaStatus('transferring');
      setOtaMessage('Transfiriendo actualización por Bluetooth... No apagues la pulsera.');

      const CHUNK_SIZE = 180;
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

        await activeDevice.writeCharacteristicWithResponseForService(
          VITALINK_SERVICE_UUID,
          OTA_DATA_CHAR_UUID,
          base64Block
        );

        lastDataTimestampRef.current = Date.now();
        const localPct = Math.min(100, Math.round((end / totalBytes) * 100));
        setOtaProgress(localPct);
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
    if (connected) return '#34C759';
    if (isConnecting || isScanning) return '#FF9500';
    return '#FF453A';
  };

  const heartbeatAnim = {
    0: { transform: [{ scale: 1 }] },
    0.15: { transform: [{ scale: 1.25 }] },
    0.3: { transform: [{ scale: 1 }] },
    0.45: { transform: [{ scale: 1.15 }] },
    1: { transform: [{ scale: 1 }] }
  };

  const breatheAnim = {
    0: { transform: [{ scale: 1 }], opacity: 0.7 },
    0.5: { transform: [{ scale: 1.15 }], opacity: 1 },
    1: { transform: [{ scale: 1 }], opacity: 0.7 }
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
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity 
            style={styles.backCircleBtn} 
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.avatarCircle} 
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.8}
          >
            {profile.foto ? (
              <Image source={{ uri: profile.foto }} style={styles.avatarImg} />
            ) : (
              <MaterialCommunityIcons name={profile.avatar || 'account-circle'} size={34} color="#FF2D55" />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={styles.greetingRow}>
              <MaterialCommunityIcons name={greeting.icon} size={14} color="#FF9500" style={{ marginRight: 5 }} />
              <Text style={styles.headerSubtitle}>{greeting.text.toUpperCase()}</Text>
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {profile.nombre ? profile.nombre.trim().split(' ')[0] : `Paciente ${user ? user.uid.substring(0, 8) : '...'}`}
            </Text>
          </View>
          <Animatable.View 
            animation={isScanning || isConnecting ? 'flash' : undefined} 
            iterationCount="infinite" 
            style={[styles.statusDot, { backgroundColor: getStatusColor() }]} 
          />
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')}>
          <MaterialCommunityIcons name="cog" size={24} color="#8E8E93" />
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.content}>

        {/* Notificación de desconexión flotante */}
        {disconnectNotice && !connected && (
          <Animatable.View animation="bounceInDown" duration={500} style={styles.disconnectToast}>
            <View style={styles.disconnectToastLeft}>
              <MaterialCommunityIcons name="bluetooth-off" size={20} color="#FF453A" />
              <Text style={styles.disconnectToastText}>Pulsera desconectada o fuera de alcance</Text>
            </View>
            <TouchableOpacity onPress={() => setDisconnectNotice(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialCommunityIcons name="close" size={18} color="#8E8E93" />
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
                  size={58} 
                  color="#FF2D55" 
                />
              </Animatable.View>
            </View>

            {/* Textos descriptivos */}
            <Text style={styles.notConnectedTitle}>
              {isConnecting ? 'Sincronizando con VitaLink...' : isScanning ? 'Buscando tu Pulsera...' : 'Pulsera Desconectada'}
            </Text>
            <Text style={styles.notConnectedSubtitle}>
              {isConnecting || isScanning 
                ? 'Mantené la pulsera encendida y cerca de tu teléfono.' 
                : 'Encendé tu pulsera VitaLink para visualizar tus signos vitales y mantener informada a tu familia.'}
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
                  <MaterialCommunityIcons name="bluetooth-connect" size={24} color="#FFF" style={{ marginRight: 10 }} />
                )}
                <Text style={styles.bigConnectBtnText}>
                  {isScanning ? 'BUSCANDO PULSERA...' : isConnecting ? 'SINCRONIZANDO...' : 'CONECTAR PULSERA'}
                </Text>
              </TouchableOpacity>
            </Animatable.View>

            {/* Consejo útil */}
            <View style={styles.hintCard}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#8E8E93" style={{ marginRight: 8 }} />
              <Text style={styles.hintText}>
                Verificá que el interruptor de la pulsera esté encendido y el Bluetooth activo.
              </Text>
            </View>

          </Animatable.View>
        ) : (
          /* VISTA 2: CUANDO LA PULSERA ESTÁ CONECTADA (DASHBOARD COMPLETO) */
          <Animatable.View animation="fadeInUp" duration={600} style={{ flex: 1 }}>
            
            {/* Barra de estado conectada */}
            <View style={styles.connectedStatusBar}>
              <View style={styles.connectedBadge}>
                <Animatable.View animation="pulse" iterationCount="infinite" duration={1400} style={styles.greenPulseDot} />
                <Text style={styles.connectedBadgeText}>VITALINK EN LÍNEA</Text>
              </View>
              <TouchableOpacity style={styles.disconnectIconBtn} onPress={disconnectDevice} activeOpacity={0.7}>
                <MaterialCommunityIcons name="bluetooth-off" size={16} color="#8E8E93" />
                <Text style={styles.disconnectIconText}>Desconectar</Text>
              </TouchableOpacity>
            </View>

            {/* BPM Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.cardHeader}>
                <Animatable.View animation="pulse" iterationCount="infinite" duration={1500}>
                  <MaterialCommunityIcons name="heart-pulse" size={24} color="#FF2D55" />
                </Animatable.View>
                <Text style={styles.cardTitle}>Frecuencia Cardíaca</Text>
              </View>
              
              <View style={styles.bpmContainer}>
                <Animatable.View 
                  animation={heartbeatAnim} 
                  iterationCount="infinite" 
                  duration={bpm !== '--' && bpm !== '0' && bpm !== '-1' ? Math.max(500, 60000 / parseInt(bpm)) : 1000}
                  style={styles.heroIconWrapper}
                >
                  <MaterialCommunityIcons name="cards-heart" size={100} color="#FF2D55" />
                </Animatable.View>
                
                <View style={styles.bpmTextWrapper}>
                  <Text style={styles.bpmValue} adjustsFontSizeToFit numberOfLines={1}>
                    {bpm === '0' ? '--' : bpm === '-1' ? '...' : bpm}
                  </Text>
                  <Text style={styles.bpmUnit}>
                    {bpm === '0' ? 'SIN CONTACTO' : bpm === '-1' ? 'CALIBRANDO' : 'LPM'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Fila secundaria: Oxígeno y Batería */}
            <View style={styles.rowCards}>
              
              {/* SpO2 Card */}
              <View style={[styles.smallCard, { flex: 1, marginRight: 8 }]}>
                <View style={styles.cardHeader}>
                  <Animatable.View animation={breatheAnim} iterationCount="infinite" duration={2500}>
                    <MaterialCommunityIcons name="water" size={20} color="#32ADE6" />
                  </Animatable.View>
                  <Text style={styles.cardTitle}>Oxígeno</Text>
                </View>
                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>
                    {spo2 === '0' ? '--' : spo2 === '-1' ? '...' : spo2}
                  </Text>
                  <Text style={styles.smallCardUnit}>%</Text>
                </View>
                <Animatable.View 
                  animation={breatheAnim} 
                  iterationCount="infinite" 
                  duration={2500}
                  style={styles.glowSpO2}
                />
              </View>

              {/* Batería Card */}
              <View style={[styles.smallCard, { flex: 1, marginLeft: 8 }]}>
                <View style={styles.cardHeader}>
                  <Animatable.View animation="pulse" iterationCount="infinite" duration={3000}>
                    <MaterialCommunityIcons name="battery-charging-60" size={20} color="#34C759" />
                  </Animatable.View>
                  <Text style={styles.cardTitle}>Batería</Text>
                </View>
                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{bateria}</Text>
                  <Text style={styles.smallCardUnit}>%</Text>
                </View>
              </View>

            </View>

            {/* Alerta de Caída o SOS */}
            {(alertaCaida === '1' || alertaSOS === '1') && (
              <Animatable.View animation="shake" iterationCount="infinite" style={styles.alertCard}>
                <MaterialCommunityIcons name="alert-octagon" size={32} color="#FFF" />
                <View style={styles.alertTextGroup}>
                  <Text style={styles.alertTitle}>ALERTA CRÍTICA</Text>
                  <Text style={styles.alertDesc}>Se ha notificado al familiar en tiempo real.</Text>
                </View>
              </Animatable.View>
            )}

            {/* Tarjeta de Firmware y Actualización OTA */}
            <View style={styles.otaSectionCard}>
              <View style={styles.otaVersionRow}>
                <View style={styles.otaVersionBadge}>
                  <MaterialCommunityIcons name="chip" size={18} color="#FF2D55" style={{ marginRight: 8 }} />
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

          </Animatable.View>
        )}

      </View>

      {/* Modal Animado de Actualización OTA */}
      <Modal
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
                    otaStatus === 'completed' || otaStatus === 'up_to_date' ? '#34C759' :
                    otaStatus === 'error' ? '#FF453A' : '#FF2D55'
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
                  <MaterialCommunityIcons name="close" size={22} color="#8E8E93" />
                </TouchableOpacity>
              )}
            </View>

            {/* Estado: Buscando en Firebase */}
            {otaStatus === 'checking' && (
              <View style={styles.otaStateCenter}>
                <ActivityIndicator size="large" color="#FF2D55" style={{ marginBottom: 14 }} />
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
                  <View style={[styles.otaProgressBarFill, { width: '100%', backgroundColor: '#34C759' }]} />
                </View>
                <Text style={[styles.otaMessageText, { color: '#34C759', fontWeight: '700', marginTop: 14 }]}>
                  {otaMessage}
                </Text>
              </Animatable.View>
            )}

            {/* Estado: Error */}
            {otaStatus === 'error' && (
              <View style={styles.otaStateCenter}>
                <Text style={[styles.otaMessageText, { color: '#FF453A' }]}>{otaMessage}</Text>
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
  container: { flex: 1, backgroundColor: '#050505' },
  
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16 },
  headerContent: { flexDirection: 'row', flex: 1, alignItems: 'center' },
  backCircleBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginRight: 10 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#161616', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  greetingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  headerSubtitle: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  headerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', letterSpacing: 0.3 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
  profileBtn: { marginLeft: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },

  // Content
  content: { flex: 1, paddingHorizontal: 20 },

  // Toast de desconexión
  disconnectToast: { backgroundColor: '#1C1517', borderWidth: 1, borderColor: 'rgba(255, 69, 58, 0.4)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  disconnectToastLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  disconnectToastText: { color: '#FF453A', fontSize: 13, fontWeight: '600', marginLeft: 10 },

  // Vista No Conectada (Hero Onboarding)
  notConnectedWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  radarContainer: { width: 200, height: 200, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  radarRingOuter: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255, 45, 85, 0.05)', borderWidth: 1, borderColor: 'rgba(255, 45, 85, 0.15)' },
  radarRingInner: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255, 45, 85, 0.08)', borderWidth: 1, borderColor: 'rgba(255, 45, 85, 0.25)' },
  radarCore: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#141414', borderWidth: 2, borderColor: '#FF2D55', justifyContent: 'center', alignItems: 'center', shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 18 },
  radarCoreScanning: { borderColor: '#FF9500' },
  notConnectedTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3, marginBottom: 8 },
  notConnectedSubtitle: { color: '#8E8E93', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  bigConnectBtn: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 24, shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16 },
  bigConnectBtnActive: { backgroundColor: '#FF9500' },
  bigConnectBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.8 },
  hintCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121212', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, marginTop: 24, marginHorizontal: 10 },
  hintText: { color: '#8E8E93', fontSize: 12, fontWeight: '500', flex: 1 },

  // Barra de estado conectado
  connectedStatusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  connectedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52, 199, 89, 0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(52, 199, 89, 0.3)' },
  greenPulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#34C759', marginRight: 6 },
  connectedBadgeText: { color: '#34C759', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  disconnectIconBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  disconnectIconText: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginLeft: 6 },

  // Cards Base
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: '#8E8E93', fontSize: 15, fontWeight: '600', marginLeft: 8, letterSpacing: 0.5 },
  
  // Hero Card (BPM)
  heroCard: { backgroundColor: '#121212', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', shadowColor: '#000', shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.5, shadowRadius: 20 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  heroIconWrapper: { shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.4, shadowRadius: 30 },
  bpmTextWrapper: { alignItems: 'flex-end', flex: 1 },
  bpmValue: { color: '#FFFFFF', fontSize: 110, fontWeight: '200', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -4, textAlign: 'right' },
  bpmUnit: { color: '#FF2D55', fontSize: 18, fontWeight: '800', letterSpacing: 1, marginTop: -5 },

  // Row Cards
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  smallCard: { backgroundColor: '#121212', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  smallCardValue: { color: '#FFFFFF', fontSize: 50, fontWeight: '300', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -1 },
  smallCardUnit: { color: '#8E8E93', fontSize: 18, fontWeight: '600', marginLeft: 4 },
  glowSpO2: { position: 'absolute', bottom: -20, right: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(50, 173, 230, 0.15)', blurRadius: 20 },

  // Alerta Crítica
  alertCard: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.4, shadowRadius: 15, marginTop: 8, marginBottom: 12 },
  alertTextGroup: { marginLeft: 16 },
  alertTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  alertDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500', marginTop: 2 },

  // Sección OTA en Dashboard
  otaSectionCard: { backgroundColor: '#121212', borderRadius: 24, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginTop: 4 },
  otaVersionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  otaVersionBadge: { flexDirection: 'row', alignItems: 'center' },
  otaVersionText: { color: '#8E8E93', fontSize: 13, fontWeight: '600' },
  otaVersionHighlight: { color: '#FFFFFF', fontWeight: '800' },
  otaCheckBtn: { backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255, 45, 85, 0.35)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  otaCheckBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },

  // Modal OTA
  otaModalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.78)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  otaModalCard: { width: '100%', backgroundColor: '#141416', borderRadius: 28, padding: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.6, shadowRadius: 24 },
  otaModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  otaModalIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255, 45, 85, 0.12)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 45, 85, 0.25)' },
  otaModalTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  otaModalSubtitle: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginTop: 2 },
  otaStateCenter: { alignItems: 'center', paddingVertical: 12 },
  otaMessageText: { color: '#D1D1D6', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20 },
  otaReleaseBox: { backgroundColor: '#1C1C1E', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 18 },
  otaReleaseHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  otaReleaseTag: { color: '#FF2D55', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  otaReleaseNotesTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  otaReleaseNotesText: { color: '#AEAEB2', fontSize: 13, lineHeight: 19 },
  otaPrimaryBtn: { backgroundColor: '#FF2D55', borderRadius: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, marginTop: 4 },
  otaPrimaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  otaSecondaryBtn: { backgroundColor: '#242426', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  otaSecondaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  otaProgressWrapper: { paddingVertical: 8 },
  otaProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  otaProgressLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  otaProgressPercent: { color: '#FF2D55', fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  otaProgressBarBg: { width: '100%', height: 12, backgroundColor: '#242426', borderRadius: 6, overflow: 'hidden', marginBottom: 14 },
  otaProgressBarFill: { height: '100%', backgroundColor: '#FF2D55', borderRadius: 6 },
  otaErrorActions: { flexDirection: 'row', width: '100%', marginTop: 16, alignItems: 'center' },
});

