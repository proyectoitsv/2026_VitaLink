import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

export default function FamilyLoginScreen({ navigation }) {
  const [patientId, setPatientId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (patientId.length !== 8) {
      setError('El código debe tener exactamente 8 caracteres.');
      return;
    }
    
    setLoading(true);
    setError('');
    const db = getFirestore();
    const docRef = doc(db, 'pacientes', patientId);
    try {
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        navigation.navigate('FamilyDashboard', { patientId });
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
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        
        <Animatable.View animation="fadeInDown" style={styles.header}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="account-supervisor" size={40} color="#E53935" />
          </View>
          <Text style={styles.title}>Acceso Familiar</Text>
          <Text style={styles.subtitle}>Ingresá el código único de 8 letras y números que aparece en la pantalla del paciente.</Text>
        </Animatable.View>

        <Animatable.View animation="fadeInUp" delay={300} style={styles.formCard}>
          <Text style={styles.label}>Código del Paciente</Text>
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="key-variant" size={24} color="#888" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Ej: A1b2C3d4"
              placeholderTextColor="#555"
              value={patientId}
              onChangeText={setPatientId}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={8}
            />
          </View>
          
          {error ? (
            <Animatable.View animation="shake" style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle" size={16} color="#FF5252" />
              <Text style={styles.errorText}>{error}</Text>
            </Animatable.View>
          ) : null}

          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]} 
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{loading ? 'Verificando...' : 'Comenzar a Monitorear'}</Text>
            {!loading && <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{marginLeft: 8}} />}
          </TouchableOpacity>
        </Animatable.View>

      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  keyboardView: { flex: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2A1A1A', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#AAAAAA', textAlign: 'center', lineHeight: 22, paddingHorizontal: 10 },
  formCard: { backgroundColor: '#1E1E1E', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#333' },
  label: { fontSize: 14, fontWeight: '700', color: '#BBBBBB', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121212', borderRadius: 12, borderWidth: 1, borderColor: '#444', marginBottom: 20 },
  inputIcon: { padding: 14 },
  input: { flex: 1, fontSize: 18, color: '#FFFFFF', fontWeight: '500', paddingVertical: 14, paddingRight: 14 },
  button: { backgroundColor: '#E53935', borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, marginTop: 10 },
  buttonDisabled: { backgroundColor: '#8E2825' },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3B1919', padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: '#FF5252' },
  errorText: { color: '#FF5252', fontSize: 13, marginLeft: 6, flex: 1 }
});
