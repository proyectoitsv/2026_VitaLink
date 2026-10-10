import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Button, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';

const auth = getAuth();
const db = getFirestore();




// UUIDs del Servidor BLE en C++
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BAT_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const CAIDA_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const SOS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';

const bleManager = new BleManager();

const decodeBase64 = (input) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input.replace(/=+$/, '');
  let output = '';
  for (let bc = 0, bs = 0, buffer, i = 0;
    buffer = str.charAt(i++);
    ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
  ) {
    buffer = chars.indexOf(buffer);
  }
  return output;
};

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [device, setDevice] = useState(null);
  const [connected, setConnected] = useState(false);
  
  const [bpm, setBpm] = useState('--');
  const [spo2, setSpo2] = useState('--');
  const [bateria, setBateria] = useState('--');
  const [alertaCaida, setAlertaCaida] = useState('0');
  const [alertaSOS, setAlertaSOS] = useState('0');
  
  const [ultimaSync, setUltimaSync] = useState('--:--:--');
  const datosRef = useRef({ bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' });

  useEffect(() => {
    const subscriber = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (initializing) setInitializing(false);
    });
    return subscriber;
  }, []);

  // Sincronización con Firebase Firestore cada 10 segundos
  useEffect(() => {
    if (!connected || !user) return;
    
    const interval = setInterval(async () => {
      const data = datosRef.current;
      // Solo guardar si recibimos latidos válidos
      if (data.bpm !== '--' || data.spo2 !== '--') {
        try {
          await addDoc(collection(db, 'pacientes', user.uid, 'historial_signos'), {
            bpm: data.bpm,
            spo2: data.spo2,
            bateria: data.bateria,
            alertaCaida: data.alertaCaida,
            alertaSOS: data.alertaSOS,
            timestamp: serverTimestamp()
          });
          const now = new Date();
          setUltimaSync(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`);
        } catch (error) {
          console.error("Error guardando en Firestore:", error);
        }
      }
    }, 10000);
    
    return () => clearInterval(interval);
  }, [connected, user]);

  const loginAnonymously = async () => {
    try {
      setIsLoggingIn(true);
      await signInAnonymously(auth);
    } catch (e) {
      console.error(e);
      alert('Error al iniciar sesión: ' + e.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    disconnect();
    await signOut(auth);
  };

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const connectToDevice = async (foundDevice) => {
    try {
      setIsConnecting(true);
      const connectedDevice = await bleManager.connectToDevice(foundDevice.id, { autoConnect: false });
      
      try { await connectedDevice.requestMTU(512); } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      setConnected(true);
      setDevice(connectedDevice);
      setIsConnecting(false);

      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setBpm(val);
            datosRef.current.bpm = val;
          }
      });
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, SPO2_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setSpo2(val);
            datosRef.current.spo2 = val;
          }
      });
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, BAT_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setBateria(val);
            datosRef.current.bateria = val;
          }
      });
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setAlertaCaida(val);
            datosRef.current.alertaCaida = val;
            
            // Subida inmediata en caso de emergencia
            if (val === '1' && user) {
              addDoc(collection(db, 'pacientes', user.uid, 'alertas_criticas'), { tipo: 'CAIDA', timestamp: serverTimestamp() }).then(() => { const now = new Date(); setUltimaSync(now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0')); }).catch(()=>{});
            }
          }
      });
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, SOS_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            setAlertaSOS(val);
            datosRef.current.alertaSOS = val;
            
            // Subida inmediata en caso de emergencia
            if (val === '1' && user) {
              addDoc(collection(db, 'pacientes', user.uid, 'alertas_criticas'), { tipo: 'SOS', timestamp: serverTimestamp() }).then(() => { const now = new Date(); setUltimaSync(now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0')); }).catch(()=>{});
            }
          }
      });

      connectedDevice.onDisconnected(() => {
        setConnected(false);
        setDevice(null);
        setBpm('--'); setSpo2('--'); setBateria('--');
        setAlertaCaida('0'); setAlertaSOS('0');
      });

    } catch (error) {
      console.log('Fallo al conectar:', error);
      setIsConnecting(false);
    }
  };

  const startScan = async () => {
    const permission = await requestPermissions();
    if (!permission) return alert("Faltan permisos de Bluetooth");

    setIsScanning(true);
    setIsConnecting(false);
    
    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) { setIsScanning(false); return; }
      
      const esVitaLink = (scannedDevice.name === 'VitaLink') || 
                         (scannedDevice.localName === 'VitaLink') || 
                         (scannedDevice.serviceUUIDs && scannedDevice.serviceUUIDs.includes(VITALINK_SERVICE_UUID.toLowerCase())) ||
                         (scannedDevice.id === '1E:CE:60:36:36:C8');

      if (esVitaLink) {
        bleManager.stopDeviceScan();
        setIsScanning(false);
        connectToDevice(scannedDevice);
      }
    });

    setTimeout(() => {
      bleManager.stopDeviceScan();
      if (!isConnecting && !connected) setIsScanning(false);
    }, 15000);
  };

  const disconnect = async () => {
    if (device) await bleManager.cancelDeviceConnection(device.id);
  };

  if (initializing) return null;

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Proyecto VitaLink</Text>
        <Text style={styles.subtitle}>Acceso Médico Seguro</Text>
        <View style={{ marginTop: 50 }}>
          <Button title={isLoggingIn ? "Ingresando..." : "Ingresar como Paciente"} onPress={loginAnonymously} disabled={isLoggingIn} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titleSmall}>VitaLink</Text>
        <Button title="Cerrar Sesión" color="#ff5252" onPress={logout} />
      </View>
      
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}><Text style={styles.uid}>ID: {user.uid.substring(0, 8)}</Text><Text style={[styles.uid, { color: '#005b9f', fontWeight: 'bold' }]}>Nube: {ultimaSync}</Text></View>
      
      <View style={styles.card}>
        <Text style={styles.status}>
          {connected ? "🟢 Pulsera Conectada" : (isConnecting ? "🔌 Conectando..." : (isScanning ? "🔎 Buscando..." : "🔴 Desconectada"))}
        </Text>
        
        {connected && (
          <View style={styles.dashboard}>
            <View style={styles.row}>
              <View style={styles.dataBox}>
                <Text style={styles.dataLabel}>Latidos</Text>
                <Text style={styles.dataValue}>{bpm} <Text style={styles.unit}>BPM</Text></Text>
              </View>
              <View style={styles.dataBox}>
                <Text style={styles.dataLabel}>Oxígeno</Text>
                <Text style={styles.dataValue}>{spo2} <Text style={styles.unit}>%</Text></Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.dataBox, {width: '100%', backgroundColor: '#e8f5e9'}]}>
                <Text style={styles.dataLabel}>Batería de la Pulsera</Text>
                <Text style={[styles.dataValue, {color: '#2e7d32'}]}>{bateria}%</Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.dataBox, alertaCaida === '1' ? styles.alertActive : styles.alertInactive]}>
                <Text style={styles.dataLabel}>Caída</Text>
                <Text style={styles.dataValue}>{alertaCaida === '1' ? '¡SÍ!' : 'NO'}</Text>
              </View>
              <View style={[styles.dataBox, alertaSOS === '1' ? styles.alertActiveSOS : styles.alertInactive]}>
                <Text style={styles.dataLabel}>Botón SOS</Text>
                <Text style={styles.dataValue}>{alertaSOS === '1' ? '¡SÍ!' : 'NO'}</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {!connected ? (
        <Button title={isConnecting ? "Conectando..." : (isScanning ? "Escaneando..." : "Conectar Pulsera")} onPress={startScan} disabled={isScanning || isConnecting} />
      ) : (
        <Button title="Desconectar" color="#757575" onPress={disconnect} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 10, marginTop: 40 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#005b9f' },
  titleSmall: { fontSize: 22, fontWeight: 'bold', color: '#005b9f' },
  subtitle: { fontSize: 16, color: '#555', marginTop: 10 },
  uid: { fontSize: 12, color: '#999', marginBottom: 20, alignSelf: 'flex-start' },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center', marginBottom: 30, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  status: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 20 },
  dashboard: { width: '100%', gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', gap: 10 },
  dataBox: { flex: 1, alignItems: 'center', backgroundColor: '#e6f4fe', padding: 15, borderRadius: 10 },
  dataLabel: { fontSize: 14, color: '#555', marginBottom: 5 },
  dataValue: { fontSize: 32, fontWeight: 'bold', color: '#005b9f' },
  unit: { fontSize: 16, color: '#005b9f' },
  alertInactive: { backgroundColor: '#f5f5f5' },
  alertActive: { backgroundColor: '#ffebee' }, 
  alertActiveSOS: { backgroundColor: '#ffcdd2' } 
});

