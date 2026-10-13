import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform, 
  StatusBar, 
  ScrollView 
} from 'react-native';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

const VINCULOS = ['Papá', 'Mamá', 'Abuelo/a', 'Hijo/a', 'Pareja', 'Hermano/a', 'Otro'];

export default function FamilyLoginScreen({ navigation, route }) {
  const [patientId, setPatientId] = useState('');
  const [selectedVinculo, setSelectedVinculo] = useState('Papá');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const auth = getAuth();

  useEffect(() => {
    signInAnonymously(auth);
    if (route.params?.scannedCode) {
      setPatientId(route.params.scannedCode);
    }
  }, [route.params?.scannedCode]);

  const handleLogin = async () => {
    const cleanId = patientId.trim();
    if (cleanId.length !== 8) {
      setError('El código debe tener exactamente 8 caracteres.');
      return;
    }
    
    setLoading(true);
    setError('');
    const db = getFirestore();
    const docRef = doc(db, 'pacientes', cleanId);
    try {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const patientData = docSnap.data();
        const u = auth.currentUser;
        if (u) {
          const familyUid = u.uid.substring(0, 8);
          const fullName = [patientData.nombre, patientData.apellido].filter(Boolean).join(' ');
          // Guardar este paciente en la lista de este familiar
          await setDoc(doc(db, 'familiares', familyUid, 'pacientes', cleanId), {
            patientId: cleanId,
            vinculo: selectedVinculo,
            nombre: fullName || patientData.nombre || '',
            avatar: patientData.avatar || 'account-circle',
            foto: patientData.foto || null,
            agregadoEn: serverTimestamp()
          }, { merge: true });

          // Notificar al paciente que un familiar se vinculó en tiempo real
          await setDoc(doc(db, 'pacientes', cleanId), {
            familiarVinculado: true,
            ultimoFamiliarUid: familyUid,
            vinculoFamiliar: selectedVinculo,
            vinculadoEn: serverTimestamp()
          }, { merge: true });
        }
        navigation.navigate('FamilyDashboard', { patientId: cleanId });
      } else {
        setError('No se encontró ningún paciente activo con este código.');
      }
    } catch (err) {
      setError('Error al verificar el código. Revisá tu conexión.');
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* Header */}
          <View style={styles.topNav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <MaterialCommunityIcons name="chevron-left" size={32} color="#FFF" />
            </TouchableOpacity>
          </View>

          <Animatable.View animation="fadeInDown" style={styles.header}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="account-plus" size={36} color="#FF2D55" />
            </View>
            <Text style={styles.title}>Vincular Paciente</Text>
            <Text style={styles.subtitle}>
              Ingresá el código de 8 caracteres o escaneá el QR desde la pantalla de tu ser querido.
            </Text>
          </Animatable.View>

          <Animatable.View animation="fadeInUp" delay={200} style={styles.formCard}>
            
            {/* Código Input */}
            <Text style={styles.label}>CÓDIGO DEL PACIENTE</Text>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons name="key-variant" size={22} color="#888" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Ej: Pk4fDIJ4"
                placeholderTextColor="#555"
                value={patientId}
                onChangeText={setPatientId}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={8}
              />
            </View>

            {/* QR Scan Action */}
            <TouchableOpacity 
              style={styles.qrButton} 
              onPress={() => navigation.navigate('QRScanner')}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FF2D55" />
              <Text style={styles.qrButtonText}>Escanear Código QR con Cámara</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Vínculo Selector */}
            <Text style={styles.label}>¿QUÉ PARENTESCO O VÍNCULO TENÉS?</Text>
            <View style={styles.vinculosGrid}>
              {VINCULOS.map((v) => {
                const isSelected = selectedVinculo === v;
                return (
                  <TouchableOpacity 
                    key={v}
                    style={[styles.vinculoPill, isSelected && styles.vinculoPillSelected]}
                    onPress={() => setSelectedVinculo(v)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.vinculoPillText, isSelected && styles.vinculoPillTextSelected]}>
                      {v}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            
            {error ? (
              <Animatable.View animation="shake" style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle" size={16} color="#FF5252" />
                <Text style={styles.errorText}>{error}</Text>
              </Animatable.View>
            ) : null}

            {/* Submit Button */}
            <TouchableOpacity 
              style={[styles.button, loading && styles.buttonDisabled]} 
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{loading ? 'Verificando...' : 'Comenzar a Monitorear'}</Text>
              {!loading && <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{ marginLeft: 8 }} />}
            </TouchableOpacity>

          </Animatable.View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  keyboardView: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 50 },
  topNav: { marginBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center' },

  header: { alignItems: 'center', marginBottom: 30 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,45,85,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,45,85,0.25)' },
  title: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },

  formCard: { backgroundColor: '#121212', borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  label: { fontSize: 11, fontWeight: '800', color: '#8E8E93', marginBottom: 10, letterSpacing: 1 },
  
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 14, borderWidth: 1, borderColor: '#333', marginBottom: 14 },
  inputIcon: { paddingLeft: 14 },
  input: { flex: 1, fontSize: 18, color: '#FFFFFF', fontWeight: '600', paddingVertical: 14, paddingHorizontal: 10, letterSpacing: 1 },
  
  qrButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,45,85,0.3)', marginBottom: 20 },
  qrButtonText: { color: '#FF2D55', fontSize: 14, fontWeight: '700', marginLeft: 8 },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 20 },

  // Vínculos
  vinculosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  vinculoPill: { backgroundColor: '#1A1A1A', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E' },
  vinculoPillSelected: { backgroundColor: '#FF2D55', borderColor: '#FF2D55' },
  vinculoPillText: { color: '#8E8E93', fontSize: 13, fontWeight: '600' },
  vinculoPillTextSelected: { color: '#FFFFFF', fontWeight: '800' },

  button: { backgroundColor: '#FF2D55', borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, marginTop: 6, shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
  buttonDisabled: { backgroundColor: '#661623' },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3B1919', padding: 12, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: '#FF5252' },
  errorText: { color: '#FF5252', fontSize: 13, marginLeft: 6, flex: 1 }
});
