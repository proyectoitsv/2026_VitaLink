import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PermissionsAndroid, Platform, ActivityIndicator, StatusBar, Image } from 'react-native';
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

  // Signos
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
      
      console.log('⏳ Intentando enviar signos...', { 
        usuario: currentUser ? currentUser.uid.substring(0,8) : 'Nulo', 
        bpm: datosRef.current.bpm 
      });

      if (currentUser) {
        let pushData = {
          bpm: datosRef.current.bpm,
          spo2: datosRef.current.spo2,
          bateria: datosRef.current.bateria,
          timestamp: serverTimestamp()
        };
        if (currentLocation) {
          pushData.ubicacion = { latitude: currentLocation.latitude, longitude: currentLocation.longitude };
        }
        console.log('✅ Enviando a Firestore...');
        setDoc(doc(db, 'pacientes', currentUser.uid.substring(0, 8), 'signos_actuales', 'live'), pushData)
          .then(() => console.log('✅ Firestore guardado OK'))
          .catch((err) => console.error('❌ Error Firestore:', err));
      }
    }, 5000);

    return () => { 
      unsubAuth(); 
      unsubProfile(); 
      clearInterval(interval); 
      if (locationSub) locationSub.remove();
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

  const scanAndConnect = async () => {
    await requestPermissions();
    setIsScanning(true);

    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) { setIsScanning(false); return; }
      
      const esVitaLink = scannedDevice.name === 'VitaLink' || (scannedDevice.localName && scannedDevice.localName === 'VitaLink');
      
      if (esVitaLink) {
        bleManager.stopDeviceScan();
        setIsScanning(false);
        connectToDevice(scannedDevice);
      }
    });
  };

  const connectToDevice = async (scannedDevice) => {
    setIsConnecting(true);
    try {
      const connectedDevice = await scannedDevice.connect();
      setDevice(connectedDevice);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      setConnected(true);
      setIsConnecting(false);

      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setBpm(val);
            datosRef.current.bpm = val;
          }
      });
      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, SPO2_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setSpo2(val);
            datosRef.current.spo2 = val;
          }
      });
      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, BAT_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setBateria(val);
            datosRef.current.bateria = val;
          }
      });
      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setAlertaCaida(val);
            datosRef.current.alertaCaida = val;
            if (val === '1' && user) {
              addDoc(collection(db, 'pacientes', user.uid.substring(0, 8), 'alertas_criticas'), { tipo: 'CAIDA', timestamp: serverTimestamp(), ubicacion: location ? { latitude: location.latitude, longitude: location.longitude } : null });
            }
          }
      });
      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, SOS_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setAlertaSOS(val);
            datosRef.current.alertaSOS = val;
            if (val === '1' && user) {
              addDoc(collection(db, 'pacientes', user.uid.substring(0, 8), 'alertas_criticas'), { tipo: 'SOS', timestamp: serverTimestamp(), ubicacion: location ? { latitude: location.latitude, longitude: location.longitude } : null });
            }
          }
      });
    } catch (e) {
      setIsConnecting(false);
    }
  };

  const getStatusColor = () => {
    if (connected) return '#43A047';
    if (isConnecting || isScanning) return '#FB8C00';
    return '#E53935';
  };

  const getStatusText = () => {
    if (connected) return 'Pulsera Conectada';
    if (isConnecting) return 'Sincronizando...';
    if (isScanning) return 'Buscando Pulsera...';
    return 'Pulsera Desconectada';
  };

  const handleLogout = async () => {
    await signOut(getAuth());
    setUser(null);
    if (device) {
      await device.cancelConnection();
      setDevice(null);
      setConnected(false);
    }
    navigation.goBack();
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
              duration={bpm !== '--' && bpm !== '0' ? Math.max(500, 60000 / parseInt(bpm)) : 1000}
              style={styles.heroIconWrapper}
            >
              <MaterialCommunityIcons name="cards-heart" size={100} color="#FF2D55" />
            </Animatable.View>
            
            <View style={styles.bpmTextWrapper}>
              <Text style={styles.bpmValue} adjustsFontSizeToFit numberOfLines={1}>{bpm}</Text>
              <Text style={styles.bpmUnit}>LPM</Text>
            </View>
          </View>
        </View>

        {/* Secondary Metrics Row */}
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
              <Text style={styles.smallCardValue}>{spo2}</Text>
              <Text style={styles.smallCardUnit}>%</Text>
            </View>
            <Animatable.View 
              animation={breatheAnim} 
              iterationCount="infinite" 
              duration={2500}
              style={styles.glowSpO2}
            />
          </View>

          {/* Battery Card */}
          <View style={[styles.smallCard, { flex: 1, marginLeft: 8 }]}>
            <View style={styles.cardHeader}>
              <Animatable.View animation="pulse" iterationCount="infinite" duration={3000}>
                <MaterialCommunityIcons name="battery-charging-60" size={20} color="#34C759" />
              </Animatable.View>
              <Text style={styles.cardTitle}>Pulsera</Text>
            </View>
            <View style={styles.metricContainer}>
              <Text style={styles.smallCardValue}>{bateria}</Text>
              <Text style={styles.smallCardUnit}>%</Text>
            </View>
          </View>

        </View>

        {/* Actions / Alerts */}
        <View style={styles.actionSection}>
          {!connected && (
            <TouchableOpacity 
              style={styles.connectBtn} 
              onPress={scanAndConnect}
              disabled={isScanning || isConnecting}
            >
              {isScanning || isConnecting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <MaterialCommunityIcons name="bluetooth-connect" size={24} color="#FFF" />
              )}
              <Text style={styles.connectBtnText}>
                {isScanning ? 'BUSCANDO...' : isConnecting ? 'CONECTANDO...' : 'VINCULAR PULSERA'}
              </Text>
            </TouchableOpacity>
          )}

          {(alertaCaida === '1' || alertaSOS === '1') && (
            <Animatable.View animation="shake" iterationCount="infinite" style={styles.alertCard}>
              <MaterialCommunityIcons name="alert-octagon" size={32} color="#FFF" />
              <View style={styles.alertTextGroup}>
                <Text style={styles.alertTitle}>ALERTA CRÍTICA</Text>
                <Text style={styles.alertDesc}>Se ha notificado al familiar.</Text>
              </View>
            </Animatable.View>
          )}
        </View>

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
  statusDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8, shadowColor: '#FFF', shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.3, shadowRadius: 8 },
  profileBtn: { marginLeft: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },

  // Content
  content: { flex: 1, paddingHorizontal: 20 },

  // Cards Base
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: '#8E8E93', fontSize: 15, fontWeight: '600', marginLeft: 8, letterSpacing: 0.5 },
  
  // Hero Card (BPM)
  heroCard: { backgroundColor: '#121212', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', shadowColor: '#000', shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.5, shadowRadius: 20 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  heroIconWrapper: { shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.4, shadowRadius: 30 },
  bpmTextWrapper: { alignItems: 'flex-end', flex: 1 },
  bpmValue: { color: '#FFFFFF', fontSize: 110, fontWeight: '200', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -4, textAlign: 'right' },
  bpmUnit: { color: '#FF2D55', fontSize: 22, fontWeight: '800', letterSpacing: 1, marginTop: -5 },

  // Row Cards
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  smallCard: { backgroundColor: '#121212', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  smallCardValue: { color: '#FFFFFF', fontSize: 50, fontWeight: '300', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -1 },
  smallCardUnit: { color: '#8E8E93', fontSize: 18, fontWeight: '600', marginLeft: 4 },
  glowSpO2: { position: 'absolute', bottom: -20, right: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(50, 173, 230, 0.15)', blurRadius: 20 },

  // Actions
  actionSection: { marginTop: 10 },
  connectBtn: { backgroundColor: '#2C2C2E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  connectBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginLeft: 10, letterSpacing: 1 },
  
  alertCard: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.4, shadowRadius: 15 },
  alertTextGroup: { marginLeft: 16 },
  alertTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  alertDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500', marginTop: 2 },
  
  // Footer
  logoutBtn: { paddingVertical: 20, alignItems: 'center' },
  logoutText: { color: '#48484A', fontSize: 13, fontWeight: '700', letterSpacing: 1 }
});
