import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

// UUIDs del Servidor BLE en C++
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';
const BAT_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const CAIDA_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ab';
const SOS_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26ac';

const bleManager = new BleManager();

// Utilidad para decodificar Base64 a texto
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
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [device, setDevice] = useState(null);
  const [connected, setConnected] = useState(false);
  
  // Estados para los 5 buzones
  const [bpm, setBpm] = useState('--');
  const [spo2, setSpo2] = useState('--');
  const [bateria, setBateria] = useState('--');
  const [alertaCaida, setAlertaCaida] = useState('0');
  const [alertaSOS, setAlertaSOS] = useState('0');

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
      console.log('Estableciendo conexión física con:', foundDevice.id);
      
      const connectedDevice = await bleManager.connectToDevice(foundDevice.id, { autoConnect: false });
      
      console.log('Conexión física lograda. Solicitando MTU (GATT Patch)...');
      try {
        await connectedDevice.requestMTU(512);
      } catch (mtuError) {
        console.log('Aviso: El celular rechazó cambiar el MTU.');
      }
      
      console.log('Esperando estabilización (1.5s)...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('Descubriendo servicios y buzones internos...');
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      setConnected(true);
      setDevice(connectedDevice);
      setIsConnecting(false);

      console.log('¡Conectado y listo! Suscribiendo a notificaciones (BPM, SpO2, Bat, Caída, SOS)...');

      // 1. Suscribirse a BPM
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, BPM_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) setBpm(decodeBase64(characteristic.value));
      });

      // 2. Suscribirse a SpO2
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, SPO2_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) setSpo2(decodeBase64(characteristic.value));
      });

      // 3. Suscribirse a Batería
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, BAT_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) setBateria(decodeBase64(characteristic.value));
      });

      // 4. Suscribirse a Alerta de Caída
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, CAIDA_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) setAlertaCaida(decodeBase64(characteristic.value));
      });

      // 5. Suscribirse a SOS
      connectedDevice.monitorCharacteristicForService(VITALINK_SERVICE_UUID, SOS_CHAR_UUID, (error, characteristic) => {
          if (!error && characteristic?.value) setAlertaSOS(decodeBase64(characteristic.value));
      });

      connectedDevice.onDisconnected((error, disconnectedDevice) => {
        console.log('Dispositivo desconectado');
        setConnected(false);
        setDevice(null);
        setBpm('--');
        setSpo2('--');
        setBateria('--');
        setAlertaCaida('0');
        setAlertaSOS('0');
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
    setDevice(null);
    setConnected(false);
    setBpm('--');
    setSpo2('--');
    setBateria('--');
    setAlertaCaida('0');
    setAlertaSOS('0');
    
    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) {
        setIsScanning(false);
        return;
      }
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Proyecto VitaLink</Text>
      
      <View style={styles.card}>
        <Text style={styles.status}>
          Estado: {connected ? "🟢 Conectado" : (isConnecting ? "🔌 Conectando..." : (isScanning ? "🔎 Buscando..." : "🔴 Desconectado"))}
        </Text>
        
        {connected && (
          <View style={styles.dashboard}>
            
            {/* Fila 1: Signos Vitales */}
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

            {/* Fila 2: Batería */}
            <View style={styles.row}>
              <View style={[styles.dataBox, {width: '100%', backgroundColor: '#e8f5e9'}]}>
                <Text style={styles.dataLabel}>Batería de la Pulsera</Text>
                <Text style={[styles.dataValue, {color: '#2e7d32'}]}>{bateria}%</Text>
              </View>
            </View>

            {/* Fila 3: Alertas */}
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
        <Button title="Desconectar" color="red" onPress={disconnect} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#005b9f', marginBottom: 40 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center', marginBottom: 30, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  status: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 20 },
  dashboard: { width: '100%', gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', gap: 10 },
  dataBox: { flex: 1, alignItems: 'center', backgroundColor: '#e6f4fe', padding: 15, borderRadius: 10 },
  dataLabel: { fontSize: 14, color: '#555', marginBottom: 5 },
  dataValue: { fontSize: 32, fontWeight: 'bold', color: '#005b9f' },
  unit: { fontSize: 16, color: '#005b9f' },
  alertInactive: { backgroundColor: '#f5f5f5' },
  alertActive: { backgroundColor: '#ffebee' }, // Rojo claro para caída
  alertActiveSOS: { backgroundColor: '#ffcdd2' } // Rojo más intenso para SOS
});

