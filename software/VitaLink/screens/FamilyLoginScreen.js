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
          await setDoc(doc(db, 'familiares', familyUid, 'pacientes', cleanId), {
            patientId: cleanId,
            vinculo: selectedVinculo,
            nombre: fullName || patientData.nombre || '',
            avatar: patientData.avatar || 'account-circle',
            foto: patientData.foto || null,
            agregadoEn: serverTimestamp()
          }, { merge: true });

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
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* Header */}
          <View style={styles.topNav}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
              <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
            </TouchableOpacity>
          </View>

          <Animatable.View animation="fadeInDown" style={styles.header}>
            <View style={styles.iconCircle}>
              <Animatable.View animation="pulse" iterationCount="infinite" duration={2200}>
                <MaterialCommunityIcons name="account-plus" size={34} color="#E04644" />
              </Animatable.View>
            </View>
            <Text style={styles.categoryLabel}>NUEVO ENLACE</Text>
            <Text style={styles.title}>Vincular Paciente</Text>
            <Text style={styles.subtitle}>
              Ingresá el código de 8 caracteres o escaneá el QR desde la pantalla de tu ser querido.
            </Text>
          </Animatable.View>

          <Animatable.View animation="fadeInUp" delay={150} style={styles.formCard}>
            
            {/* Código Input */}
            <Text style={styles.label}>CÓDIGO DEL PACIENTE</Text>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons name="key-variant" size={22} color="#9CA3AF" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Ej: Pk4fDIJ4"
                placeholderTextColor="#6B7280"
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
              <MaterialCommunityIcons name="qrcode-scan" size={20} color="#E5E7EB" />
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
                <MaterialCommunityIcons name="alert-circle" size={16} color="#E04644" />
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
  container: { flex: 1, backgroundColor: '#0B0D10' },
  keyboardView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 42 },
  topNav: { marginBottom: 6 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },

  header: { alignItems: 'center', marginBottom: 24 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#22252A', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  categoryLabel: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 4 },
  title: { fontSize: 25, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },

  formCard: { backgroundColor: '#22252A', borderRadius: 22, padding: 20 },
  label: { fontSize: 11, fontWeight: '700', color: '#D4A359', marginBottom: 10, letterSpacing: 0.6 },
  
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181A1F', borderRadius: 16, marginBottom: 12 },
  inputIcon: { paddingLeft: 14 },
  input: { flex: 1, fontSize: 18, color: '#FFFFFF', fontWeight: '600', paddingVertical: 14, paddingHorizontal: 10, letterSpacing: 1 },
  
  qrButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#181A1F', borderRadius: 16, paddingVertical: 14, marginBottom: 20 },
  qrButtonText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600', marginLeft: 8 },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 18 },

  vinculosGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  vinculoPill: { backgroundColor: '#181A1F', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14 },
  vinculoPillSelected: { backgroundColor: '#43C667' },
  vinculoPillText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  vinculoPillTextSelected: { color: '#FFFFFF', fontWeight: '700' },

  button: { backgroundColor: '#E04644', borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181A1F', padding: 12, borderRadius: 12, marginBottom: 14 },
  errorText: { color: '#E04644', fontSize: 13, fontWeight: '600', marginLeft: 8, flex: 1 }
});
