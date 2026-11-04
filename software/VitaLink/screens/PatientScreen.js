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

  // Estados OTA y Ajustes
  const [showSettingsModal, setShowSettingsModal] = useState(false);
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
              if (!isConnectedRef.current && !isConnectingRef.current && !userExplicitlyDisconnectedRef.current) {
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
    if (!isConnectedRef.current && !isConnectingRef.current && !deviceRef.current) return;
    isConnectedRef.current = false;
    isConnectingRef.current = false;

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
    if (isConnectedRef.current || isConnectingRef.current) return;
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
    if (isConnectedRef.current || isConnectingRef.current) return;
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
      if (!isUserInitiated && !isConnectedRef.current && !isConnectingRef.current && !userExplicitlyDisconnectedRef.current && lastKnownDeviceIdRef.current) {
        autoReconnectTimerRef.current = setTimeout(() => {
          if (!isConnectedRef.current && !isConnectingRef.current) checkAndAutoConnect();
        }, 8000);
      }
    }, isUserInitiated ? 15000 : 8000);

    bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, scannedDevice) => {
      if (error) {
        console.warn('Error escaneo BLE:', error);
        setIsScanning(false);
        return;
      }
      if (!scannedDevice || isConnectedRef.current || isConnectingRef.current) return;

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
        activeDev.onDisconnected(() => {
          if (!isUpdatingOtaRef.current) {
            console.log('⚡ Pulsera desconectada físicamente');
            handleDisconnection(true);
          }
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

  const connectToDevice = async (scannedDevice) => {
    if (isConnectingRef.current || isConnectedRef.current) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    try {
      // Si el dispositivo ya está conectado al OS, usar la conexión o conectar limpiando caché GATT
      const isAlready = await scannedDevice.isConnected().catch(() => false);
      let activeDevice = scannedDevice;
      if (!isAlready) {
        activeDevice = await scannedDevice.connect({ refreshGatt: 'OnConnected' });
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
      
      await new Promise(resolve => setTimeout(resolve, 600));
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
              await new Promise(resolve => setTimeout(resolve, 450));
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

      await tryReadFirmwareVersion(activeDevice);

      isConnectedRef.current = true;
      isConnectingRef.current = false;
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

  const batNum = parseInt(bateria, 10);
  const batValid = !isNaN(batNum) && batNum >= 0;
  const batBars = !batValid ? 2 : batNum > 66 ? 3 : batNum > 25 ? 2 : 1;

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      
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
          /* VISTA 2: CUANDO LA PULSERA ESTÁ CONECTADA (DASHBOARD FIEL A LA REFERENCIA) */
          <Animatable.View animation="fadeInUp" duration={500} style={{ flex: 1 }}>
            
            {/* Barra de estado conectada (2 píldoras grises oscuras) */}
            <View style={styles.connectedStatusBar}>
              <View style={styles.connectedBadge}>
                <Animatable.View animation="pulse" iterationCount="infinite" duration={1400} style={styles.greenPulseDot} />
                <Text style={styles.connectedBadgeText}>VITALINK EN LÍNEA</Text>
              </View>
              <TouchableOpacity style={styles.disconnectIconBtn} onPress={disconnectDevice} activeOpacity={0.7}>
                <Text style={styles.disconnectIconText}>Desconectar</Text>
              </TouchableOpacity>
            </View>

            {/* BPM Hero Card (Frecuencia Cardíaca + Corazón + LPM + Onda ECG) */}
            <View style={styles.heroCard}>
              <Text style={styles.cardTitle}>Frecuencia Cardíaca</Text>
              
              <View style={styles.bpmContainer}>
                <View style={styles.bpmLeftGroup}>
                  <Animatable.View 
                    animation={heartbeatAnim} 
                    iterationCount="infinite" 
                    duration={bpm !== '--' && bpm !== '0' && bpm !== '-1' ? Math.max(500, 60000 / parseInt(bpm)) : 1000}
                  >
                    <MaterialCommunityIcons name="cards-heart" size={44} color="#E04644" />
                  </Animatable.View>
                  
                  <View style={styles.bpmTextRow}>
                    <Text style={styles.bpmValue} numberOfLines={1}>
                      {bpm === '0' ? '--' : bpm === '-1' ? '...' : bpm}
                    </Text>
                    <Text style={styles.bpmUnit}>LPM</Text>
                  </View>
                </View>

                <Animatable.View
                  animation="pulse"
                  iterationCount="infinite"
                  duration={1800}
                  style={styles.ecgContainer}
                >
                  <Image
                    source={require('../assets/ecg_wave.png')}
                    style={styles.ecgImage}
                    resizeMode="contain"
                  />
                </Animatable.View>
              </View>
            </View>

            {/* Fila secundaria: Oxígeno y Batería */}
            <View style={styles.rowCards}>
              
              {/* SpO2 Card */}
              <View style={[styles.smallCard, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.cardTitle}>Oxígeno</Text>

                <Animatable.View animation={breatheAnim} iterationCount="infinite" duration={2500} style={styles.smallCardIconWrap}>
                  <MaterialCommunityIcons name="water" size={48} color="#3AB4F2" />
                </Animatable.View>

                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>
                    {spo2 === '0' ? '--' : spo2 === '-1' ? '...' : spo2}
                  </Text>
                  <Text style={styles.smallCardUnit}> %</Text>
                </View>
              </View>

              {/* Batería Card */}
              <View style={[styles.smallCard, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.cardTitle}>Batería</Text>

                <View style={styles.smallCardIconWrap}>
                  <View style={styles.customBatteryWrap}>
                    <View style={styles.customBatteryCap} />
                    <View style={styles.customBatteryBody}>
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 3 ? 0.45 : 0.15 }]} />
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 2 ? 1 : 0.2 }]} />
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 1 ? 1 : 0.2, marginBottom: 0 }]} />
                    </View>
                  </View>
                </View>

                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{bateria}</Text>
                  <Text style={styles.smallCardUnit}> %</Text>
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

          </Animatable.View>
        )}

      </View>

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
  container: { flex: 1, backgroundColor: '#0B0D10' },
  
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 42, paddingBottom: 18 },
  headerContent: { flexDirection: 'row', flex: 1, alignItems: 'center' },
  backCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  headerSubtitle: { color: '#D4A359', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.2, flexShrink: 1 },
  statusDot: { width: 9, height: 9, borderRadius: 4.5, marginLeft: 8, marginTop: 2 },
  profileBtn: { marginLeft: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },

  // Content
  content: { flex: 1, paddingHorizontal: 20 },

  // Toast de desconexión
  disconnectToast: { backgroundColor: '#22252A', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  disconnectToastLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  disconnectToastText: { color: '#E04644', fontSize: 13, fontWeight: '600', marginLeft: 10 },

  // Vista No Conectada
  notConnectedWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40 },
  radarContainer: { width: 190, height: 190, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  radarRingOuter: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(224, 70, 68, 0.06)', borderWidth: 1, borderColor: 'rgba(224, 70, 68, 0.16)' },
  radarRingInner: { position: 'absolute', width: 134, height: 134, borderRadius: 67, backgroundColor: 'rgba(224, 70, 68, 0.1)', borderWidth: 1, borderColor: 'rgba(224, 70, 68, 0.24)' },
  radarCore: { width: 92, height: 92, borderRadius: 46, backgroundColor: '#22252A', borderWidth: 2, borderColor: '#E04644', justifyContent: 'center', alignItems: 'center' },
  radarCoreScanning: { borderColor: '#D4A359' },
  notConnectedTitle: { color: '#FFFFFF', fontSize: 23, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  notConnectedSubtitle: { color: '#9CA3AF', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  bigConnectBtn: { backgroundColor: '#E04644', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 17, borderRadius: 22 },
  bigConnectBtnActive: { backgroundColor: '#D4A359' },
  bigConnectBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.6 },
  hintCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252A', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, marginTop: 22, marginHorizontal: 6 },
  hintText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', flex: 1 },

  // Barra de estado conectado (2 píldoras como en la imagen)
  connectedStatusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  connectedBadge: { flex: 1.45, marginRight: 10, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252A', paddingHorizontal: 14, borderRadius: 21 },
  greenPulseDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#43C667', marginRight: 8 },
  connectedBadgeText: { color: '#43C667', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  disconnectIconBtn: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252A', paddingHorizontal: 14, borderRadius: 21 },
  disconnectIconText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600' },

  // Títulos de tarjetas
  cardTitle: { color: '#E8EAED', fontSize: 18, fontWeight: '600', letterSpacing: 0.1 },
  
  // Hero Card (Frecuencia Cardíaca)
  heroCard: { backgroundColor: '#22252A', borderRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, marginBottom: 16 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  bpmLeftGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  bpmTextRow: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 12 },
  bpmValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false },
  bpmUnit: { color: '#E8EAED', fontSize: 22, fontWeight: '500', marginLeft: 8 },
  ecgContainer: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', marginLeft: 10 },
  ecgImage: { width: 155, height: 78 },

  // Row Cards (Oxígeno y Batería)
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  smallCard: { backgroundColor: '#22252A', borderRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, minHeight: 175, justifyContent: 'space-between' },
  smallCardIconWrap: { alignSelf: 'flex-start', marginVertical: 12 },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline' },
  smallCardValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false },
  smallCardUnit: { color: '#FFFFFF', fontSize: 30, fontWeight: '500' },

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
  otaSectionCard: { backgroundColor: '#191C20', borderRadius: 18, padding: 16, marginTop: 4 },
  otaVersionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  otaVersionBadge: { flexDirection: 'row', alignItems: 'center' },
  otaVersionText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  otaVersionHighlight: { color: '#FFFFFF', fontWeight: '800' },
  otaCheckBtn: { backgroundColor: '#2A2E35', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  otaCheckBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  settingsProfileBtn: { backgroundColor: '#191C20', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Modal OTA & Ajustes
  otaModalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.78)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  otaModalCard: { width: '100%', backgroundColor: '#22252A', borderRadius: 24, padding: 22 },
  otaModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  otaModalIconCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#191C20', justifyContent: 'center', alignItems: 'center' },
  otaModalTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  otaModalSubtitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', marginTop: 2 },
  otaStateCenter: { alignItems: 'center', paddingVertical: 12 },
  otaMessageText: { color: '#D1D5DB', fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20 },
  otaReleaseBox: { backgroundColor: '#191C20', borderRadius: 16, padding: 16, marginBottom: 18 },
  otaReleaseHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  otaReleaseTag: { color: '#E04644', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  otaReleaseNotesTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  otaReleaseNotesText: { color: '#9CA3AF', fontSize: 13, lineHeight: 19 },
  otaPrimaryBtn: { backgroundColor: '#E04644', borderRadius: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  otaPrimaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  otaSecondaryBtn: { backgroundColor: '#2A2E35', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, marginTop: 16, alignItems: 'center', justifyContent: 'center' },
  otaSecondaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  otaProgressWrapper: { paddingVertical: 8 },
  otaProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  otaProgressLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  otaProgressPercent: { color: '#E04644', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  otaProgressBarBg: { width: '100%', height: 10, backgroundColor: '#191C20', borderRadius: 5, overflow: 'hidden', marginBottom: 14 },
  otaProgressBarFill: { height: '100%', backgroundColor: '#E04644', borderRadius: 5 },
  otaErrorActions: { flexDirection: 'row', width: '100%', marginTop: 16, alignItems: 'center' },
});





