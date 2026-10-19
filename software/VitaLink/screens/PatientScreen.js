import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PermissionsAndroid, Platform, ActivityIndicator, StatusBar, Image, Vibration, AppState } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64 } from 'base-64';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, setDoc, doc, serverTimestamp, onSnapshot } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

const bleManager = new BleManager();
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID  = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BAT_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const CAIDA_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const SOS_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';

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
    datosRef.current = { bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' };
    setDisconnectNotice(true);

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

      isConnectedRef.current = true;
      setConnected(true);
      setIsConnecting(false);
      setDisconnectNotice(false);
      lastDataTimestampRef.current = Date.now();
      
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

          </Animatable.View>
        )}

      </View>
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
  alertCard: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.4, shadowRadius: 15, marginTop: 8 },
  alertTextGroup: { marginLeft: 16 },
  alertTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  alertDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500', marginTop: 2 },
});
