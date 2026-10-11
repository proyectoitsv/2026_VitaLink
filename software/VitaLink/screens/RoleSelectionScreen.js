import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function RoleSelectionScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenido a VitaLink</Text>
      <Text style={styles.subtitle}>¿Cómo vas a usar la aplicación?</Text>
      
      <View style={styles.buttonContainer}>
        <Button 
          title="Soy Paciente (Tengo la pulsera)" 
          onPress={() => navigation.navigate('Patient')} 
        />
        <View style={styles.spacer} />
        <Button 
          title="Soy Familiar / Médico" 
          onPress={() => navigation.navigate('FamilyLogin')} 
          color="#2e7d32"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f0f4f8' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#005b9f', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#555', marginBottom: 40 },
  buttonContainer: { width: '100%', maxWidth: 300 },
  spacer: { height: 20 }
});
