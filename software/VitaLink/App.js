import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Button, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';

// Inicializamos el administrador de Bluetooth
const bleManager = new BleManager();

export default function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [deviceFound, setDeviceFound] = useState(null);

  // Pedir permisos en Android (obligatorio para Bluetooth)
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

  const startScan = async () => {
    const permission = await requestPermissions();
    if (!permission) {
      alert("Faltan permisos de Bluetooth");
      return;
    }

    setIsScanning(true);
    setDeviceFound(null);

    console.log("Buscando pulsera VitaLink...");
    
    // Iniciar escaneo
    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.warn("Error en escaneo:", error);
        setIsScanning(false);
        return;
      }

      // Si encuentra un dispositivo con el nombre "VitaLink", frenamos
      if (device && device.name === 'VitaLink') {
        console.log("¡Pulsera VitaLink Encontrada!", device.id);
        setDeviceFound(device);
        bleManager.stopDeviceScan();
        setIsScanning(false);
      }
    });

    // Cortar el escaneo automáticamente después de 10 segundos
    setTimeout(() => {
      bleManager.stopDeviceScan();
      setIsScanning(false);
    }, 10000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Proyecto VitaLink</Text>
      
      <View style={styles.card}>
        <Text style={styles.status}>
          Estado del Escáner: {isScanning ? "Buscando..." : "Detenido"}
        </Text>
        
        {deviceFound ? (
          <Text style={styles.success}>¡Encontramos tu pulsera! ({deviceFound.id})</Text>
        ) : (
          <Text style={styles.waiting}>Aún no conectada</Text>
        )}
      </View>

      <Button 
        title={isScanning ? "Escaneando..." : "Buscar Pulsera VitaLink"} 
        onPress={startScan} 
        disabled={isScanning} 
      />
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
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginBottom: 30,
    elevation: 3, // Sombra
  },
  status: {
    fontSize: 16,
    color: '#333',
    marginBottom: 10,
  },
  success: {
    fontSize: 18,
    color: 'green',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  waiting: {
    fontSize: 16,
    color: 'gray',
  }
});

