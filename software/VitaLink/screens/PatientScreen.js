import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, PermissionsAndroid, Platform, StyleSheet } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { decode as decodeBase64 } from 'base-64';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from '@react-native-firebase/auth';
import { getFirestore, collection, addDoc, serverTimestamp } from '@react-native-firebase/firestore';
import * as Location from 'expo-location';

const bleManager = new BleManager();
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID  = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BAT_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const CAIDA_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const SOS_CHAR_UUID   = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';

export default function PatientScreen() {
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [device, setDevice] = useState(null);

  const [bpm, setBpm] = useState('--');
  const [spo2, setSpo2] = useState('--');
  const [bateria, setBateria] = useState('--');
  const [alertaCaida, setAlertaCaida] = useState('0');
  const [alertaSOS, setAlertaSOS] = useState('0');

  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  const [ultimaSync, setUltimaSync] = useState('--:--:--');
  const [location, setLocation] = useState(null);

  const datosRef = useRef({ bpm: '--', spo2: '--', bateria: '--', alertaCaida: '0', alertaSOS: '0' });

  const db = getFirestore();

  useEffect(() => {
    const subscriber = onAuthStateChanged(getAuth(), (currentUser) => {
      setUser(currentUser);
      if (initializing) setInitializing(false);
      setIsLoggingIn(false);
    });
    return subscriber;
  }, []);

  // Solicitar permiso GPS
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc.coords);
    })();
  }, []);

  useEffect(() => {
    let interval;
    if (connected && user) {
      interval = setInterval(async () => {
        let currentLoc = location;
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          currentLoc = loc.coords;
          setLocation(loc.coords);
        } catch(e){}

        const dataPayload = {
          bpm: datosRef.current.bpm,
          spo2: datosRef.current.spo2,
          bateria: datosRef.current.bateria,
          alertaCaida: datosRef.current.alertaCaida,
          alertaSOS: datosRef.current.alertaSOS,
          timestamp: serverTimestamp(),
          ubicacion: currentLoc ? { latitude: currentLoc.latitude, longitude: currentLoc.longitude } : null
        };
        
        const shortId = user.uid.substring(0, 8);
        addDoc(collection(db, 'pacientes', shortId, 'historial_signos'), dataPayload)
          .then(() => {
            const now = new Date();
            setUltimaSync(now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0'));
          })
          .catch(()=>{});
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [connected, user, location]);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  const loginAnonymously = () => {
    setIsLoggingIn(true);
    signInAnonymously(getAuth()).catch(error => { setIsLoggingIn(false); });
  };

  const logout = () => {
    disconnect();
    signOut(getAuth());
  };

  const connectToDevice = async (scannedDevice) => {
    setIsConnecting(true);
    try {
      const connectedDevice = await scannedDevice.connect();
      setDevice(connectedDevice);
      
      // Delay for Android GATT
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      setConnected(true);
      setIsConnecting(false);

      bleManager.monitorCharacteristicForDevice(connectedDevice.id, VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
          if (error) console.log('Error BPM:', error);
          if (!error && characteristic?.value) {
            const val = decodeBase64(characteristic.value);
            console.log('Got BPM:', val);
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

      connectedDevice.onDisconnected(() => {
        setConnected(false);
        setDevice(null);
        setBpm('--'); setSpo2('--'); setBateria('--');
        setAlertaCaida('0'); setAlertaSOS('0');
      });

    } catch (error) { setIsConnecting(false); }
  };

  const startScan = async () => {
    const permission = await requestPermissions();
    if (!permission) return alert("Faltan permisos de Bluetooth");

    setIsScanning(true);
    setIsConnecting(false);
    
    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) { setIsScanning(false); return; }
      const esVitaLink = (scannedDevice.name === 'VitaLink') || (scannedDevice.localName === 'VitaLink') || (scannedDevice.serviceUUIDs && scannedDevice.serviceUUIDs.includes(VITALINK_SERVICE_UUID.toLowerCase())) || (scannedDevice.id === '1E:CE:60:36:36:C8');
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

  const disconnect = async () => { if (device) await bleManager.cancelDeviceConnection(device.id); };

  if (initializing) return null;

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Proyecto VitaLink</Text>
        <Text style={styles.subtitle}>Modo Paciente</Text>
        <View style={{ marginTop: 50 }}>
          <Button title={isLoggingIn ? "Ingresando..." : "Generar mi Código"} onPress={loginAnonymously} disabled={isLoggingIn} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titleSmall}>VitaLink</Text>
        <Button title="Cerrar Sesin" color="#ff5252" onPress={logout} />
      </View>
      
      <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
        <Text style={styles.uid}>CDIGO: {user.uid.substring(0, 8)}</Text>
        <Text style={[styles.uid, { color: '#005b9f', fontWeight: 'bold' }]}>Nube: {ultimaSync}</Text>
      </View>
      
      <View style={styles.card}>
        <Text style={styles.status}>
          {connected ? "Conectada" : (isConnecting ? "Conectando..." : (isScanning ? "Buscando..." : "Desconectada"))}
        </Text>
        
        {connected && (
          <View style={styles.dashboard}>
            <View style={styles.row}>
              <View style={styles.dataBox}>
                <Text style={styles.dataLabel}>Latidos</Text>
                <Text style={styles.dataValue}>{bpm} <Text style={styles.unit}>BPM</Text></Text>
              </View>
              <View style={styles.dataBox}>
                <Text style={styles.dataLabel}>Oxgeno</Text>
                <Text style={styles.dataValue}>{spo2} <Text style={styles.unit}>%</Text></Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.dataBox, {width: '100%', backgroundColor: '#e8f5e9'}]}>
                <Text style={styles.dataLabel}>Batera de la Pulsera</Text>
                <Text style={[styles.dataValue, {color: '#2e7d32'}]}>{bateria}%</Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={[styles.dataBox, alertaCaida === '1' ? styles.alertActive : styles.alertInactive]}>
                <Text style={styles.dataLabel}>Cada</Text>
                <Text style={styles.dataValue}>{alertaCaida === '1' ? 'S?!' : 'NO'}</Text>
              </View>
              <View style={[styles.dataBox, alertaSOS === '1' ? styles.alertActiveSOS : styles.alertInactive]}>
                <Text style={styles.dataLabel}>Botn SOS</Text>
                <Text style={styles.dataValue}>{alertaSOS === '1' ? 'S?!' : 'NO'}</Text>
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
  uid: { fontSize: 13, color: '#000', marginBottom: 20, alignSelf: 'flex-start', fontWeight: 'bold' },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center', marginBottom: 30, elevation: 4 },
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
