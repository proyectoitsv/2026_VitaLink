import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

// UUIDs del Servidor BLE en C++
const VITALINK_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BPM_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const SPO2_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a9';

const bleManager = new BleManager();

// Utilidad para decodificar Base64 a texto (porque BLE-PLX devuelve Base64)
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
  const [device, setDevice] = useState(null);
  const [connected, setConnected] = useState(false);
  const [bpm, setBpm] = useState('--');
  const [spo2, setSpo2] = useState('--');

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
      console.log('Conectando a:', foundDevice.name);
      const connectedDevice = await bleManager.connectToDevice(foundDevice.id);
      setConnected(true);
      setDevice(connectedDevice);

      console.log('Descubriendo servicios y características...');
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      console.log('¡Conectado y listo! Suscribiendo a notificaciones...');

      // Suscribirse al buzón de BPM
      connectedDevice.monitorCharacteristicForService(
        VITALINK_SERVICE_UUID, 
        BPM_CHAR_UUID, 
        (error, characteristic) => {
          if (error) {
            console.log('Error leyendo BPM:', error);
            return;
          }
          if (characteristic?.value) {
            const decodedBPM = decodeBase64(characteristic.value);
            setBpm(decodedBPM);
          }
        }
      );

      // Suscribirse al buzón de SpO2
      connectedDevice.monitorCharacteristicForService(
        VITALINK_SERVICE_UUID, 
        SPO2_CHAR_UUID, 
        (error, characteristic) => {
          if (error) {
            console.log('Error leyendo SpO2:', error);
            return;
          }
          if (characteristic?.value) {
            const decodedSpo2 = decodeBase64(characteristic.value);
            setSpo2(decodedSpo2);
          }
        }
      );

      // Si se desconecta...
      connectedDevice.onDisconnected((error, disconnectedDevice) => {
        console.log('Dispositivo desconectado');
        setConnected(false);
        setDevice(null);
        setBpm('--');
        setSpo2('--');
      });

    } catch (error) {
      console.log('Fallo al conectar:', error);
    }
  };

  const startScan = async () => {
    const permission = await requestPermissions();
    if (!permission) {
      alert("Faltan permisos de Bluetooth");
      return;
    }

    setIsScanning(true);
    setDevice(null);
    setConnected(false);
    setBpm('--');
    setSpo2('--');

    console.log("Buscando pulsera VitaLink...");
    
    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) {
        console.warn("Error en escaneo:", error);
        setIsScanning(false);
        return;
      }

      if (scannedDevice && scannedDevice.name === 'VitaLink') {
        console.log("¡Encontrada!", scannedDevice.id);
        bleManager.stopDeviceScan();
        setIsScanning(false);
        connectToDevice(scannedDevice);
      }
    });

    setTimeout(() => {
      bleManager.stopDeviceScan();
      setIsScanning(false);
    }, 10000);
  };

  const disconnect = async () => {
    if (device) {
      await bleManager.cancelDeviceConnection(device.id);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Proyecto VitaLink</Text>
      
      <View style={styles.card}>
        <Text style={styles.status}>
          Estado: {connected ? "🟢 Conectado" : (isScanning ? "🔎 Buscando..." : "🔴 Desconectado")}
        </Text>
        
        {connected && (
          <View style={styles.dataContainer}>
            <View style={styles.dataBox}>
              <Text style={styles.dataLabel}>Latidos (BPM)</Text>
              <Text style={styles.dataValue}>{bpm}</Text>
            </View>
            <View style={styles.dataBox}>
              <Text style={styles.dataLabel}>Oxígeno (SpO2)</Text>
              <Text style={styles.dataValue}>{spo2}%</Text>
            </View>
          </View>
        )}
      </View>

      {!connected ? (
        <Button 
          title={isScanning ? "Escaneando..." : "Conectar Pulsera"} 
          onPress={startScan} 
          disabled={isScanning} 
        />
      ) : (
        <Button 
          title="Desconectar" 
          color="red"
          onPress={disconnect} 
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#005b9f',
    marginBottom: 40,
  },
  card: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 15,
    width: '100%',
    alignItems: 'center',
    marginBottom: 30,
    elevation: 4, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  status: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
  },
  dataContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 10,
  },
  dataBox: {
    alignItems: 'center',
    backgroundColor: '#e6f4fe',
    padding: 15,
    borderRadius: 10,
    minWidth: 120,
  },
  dataLabel: {
    fontSize: 14,
    color: '#555',
    marginBottom: 5,
  },
  dataValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#d32f2f',
  }
});

