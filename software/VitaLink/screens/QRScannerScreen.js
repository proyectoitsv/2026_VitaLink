import React, { useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  StatusBar, 
  ActivityIndicator 
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

const { width } = Dimensions.get('window');
const CARD_SIZE = Math.min(width - 64, 280);

export default function QRScannerScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState(false);
  const scanLockRef = useRef(false);
  const isFocused = useIsFocused();

  if (!permission) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#FF2D55" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#050505" />
        <View style={styles.permissionCard}>
          <MaterialCommunityIcons name="camera-off" size={48} color="#FF2D55" style={{ marginBottom: 16 }} />
          <Text style={styles.permTitle}>Permiso de Cámara</Text>
          <Text style={styles.permSub}>
            VitaLink necesita acceso a la cámara para escanear el código QR que aparece en la pantalla del paciente.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.8}>
            <Text style={styles.permBtnText}>Permitir Acceso</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.cancelBtnText}>Volver</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleBarCodeScanned = ({ type, data }) => {
    if (scanLockRef.current || scanned) return;
    scanLockRef.current = true;
    setScanned(true);

    const cleanData = (data || '').trim();
    if (cleanData.length === 8) {
      navigation.navigate('FamilyLogin', { scannedCode: cleanData });
    } else {
      alert(`Código detectado: "${cleanData}".\nNo es un código válido de VitaLink (debe tener 8 caracteres).`);
      setTimeout(() => {
        scanLockRef.current = false;
        setScanned(false);
      }, 2000);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialCommunityIcons name="chevron-left" size={32} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerCategory}>VINCULACIÓN</Text>
          <Text style={styles.headerTitle}>Escanear Paciente</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Center Camera Card */}
      <View style={styles.centerSection}>
        <View style={styles.cameraCard}>
          <CameraView
            style={styles.camera}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          >
            {/* Precision Corners inside the viewfinder */}
            <View style={[styles.corner, styles.cornerTL]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerTR]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerBL]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerBR]} pointerEvents="none" />

            {scanned && (
              <View style={styles.scannedSuccess}>
                <MaterialCommunityIcons name="check-circle" size={48} color="#34C759" />
                <Text style={styles.scannedSuccessText}>VINCULANDO...</Text>
              </View>
            )}
          </CameraView>
        </View>

        {/* Torch Pill Toggle */}
        <TouchableOpacity 
          style={[styles.torchPill, torch && styles.torchPillActive]} 
          onPress={() => setTorch(!torch)}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons 
            name={torch ? "flashlight" : "flashlight-off"} 
            size={18} 
            color={torch ? "#FFD60A" : "#8E8E93"} 
          />
          <Text style={[styles.torchPillText, torch && styles.torchPillTextActive]}>
            {torch ? "Linterna Encendida" : "Linterna"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Instructions & Fallback */}
      <View style={styles.footer}>
        <Text style={styles.footerInstruction}>
          Apuntá la cámara al código QR que figura en la aplicación del paciente para conectar ambos dispositivos.
        </Text>

        <TouchableOpacity 
          style={styles.manualBtn} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.manualBtnText}>Ingresar código manualmente</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505', justifyContent: 'space-between' },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 55, paddingHorizontal: 20, paddingBottom: 15 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { alignItems: 'center' },
  headerCategory: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 2 },
  headerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },

  // Center Section
  centerSection: { alignItems: 'center', justifyContent: 'center' },
  cameraCard: { 
    width: CARD_SIZE, 
    height: CARD_SIZE, 
    borderRadius: 24, 
    overflow: 'hidden', 
    borderWidth: 2, 
    borderColor: '#333333',
    position: 'relative'
  },
  camera: { flex: 1 },
  scannedSuccess: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.85)', justifyContent: 'center', alignItems: 'center' },
  scannedSuccessText: { color: '#34C759', fontSize: 13, fontWeight: '800', letterSpacing: 1, marginTop: 10 },

  // Precision Corners
  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#FF2D55', borderWidth: 3.5 },
  cornerTL: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
  cornerTR: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
  cornerBL: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },

  // Torch Toggle Pill
  torchPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, marginTop: 20, borderWidth: 1, borderColor: '#262626' },
  torchPillActive: { backgroundColor: 'rgba(255, 214, 10, 0.15)', borderColor: '#FFD60A' },
  torchPillText: { color: '#8E8E93', fontSize: 13, fontWeight: '600', marginLeft: 8 },
  torchPillTextActive: { color: '#FFD60A' },

  // Footer
  footer: { paddingHorizontal: 30, paddingBottom: 45, alignItems: 'center' },
  footerInstruction: { color: '#8E8E93', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  manualBtn: { paddingVertical: 10 },
  manualBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  // Permission UI
  permissionCard: { padding: 32, alignItems: 'center', backgroundColor: '#121212', borderRadius: 24, marginHorizontal: 24, borderWidth: 1, borderColor: '#262626' },
  permTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  permSub: { color: '#8E8E93', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  permBtn: { backgroundColor: '#FF2D55', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 },
  permBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cancelBtn: { marginTop: 14, padding: 8 },
  cancelBtnText: { color: '#666', fontSize: 13 }
});
