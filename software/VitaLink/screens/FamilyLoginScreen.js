import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';

export default function FamilyLoginScreen({ navigation }) {
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Iniciar sesión anónima también para el familiar para poder leer Firestore
    signInAnonymously(getAuth()).catch(console.error);
  }, []);

  const handleConnect = () => {
    if (codigo.trim().length < 5) {
      Alert.alert("Error", "Ingresa un código válido");
      return;
    }
    setLoading(true);
    navigation.navigate('FamilyDashboard', { patientId: codigo.trim() });
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vincular Paciente</Text>
      <Text style={styles.subtitle}>Ingresa el código que aparece en la pantalla del celular del paciente.</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Ej: ABC123XYZ"
        value={codigo}
        onChangeText={setCodigo}
        autoCapitalize="none"
        autoCorrect={false}
      />
      
      <Button title={loading ? "Conectando..." : "Conectar"} onPress={handleConnect} color="#2e7d32" disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f0f4f8' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 30, textAlign: 'center' },
  input: { backgroundColor: 'white', padding: 15, borderRadius: 8, fontSize: 18, marginBottom: 20, textAlign: 'center', borderWidth: 1, borderColor: '#ccc' }
});
