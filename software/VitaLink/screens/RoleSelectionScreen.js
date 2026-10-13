import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore, doc, getDoc } from '@react-native-firebase/firestore';

export default function RoleSelectionScreen({ navigation }) {
  const [checkingPatient, setCheckingPatient] = React.useState(false);

  const handlePatientPress = async () => {
    if (checkingPatient) return;
    setCheckingPatient(true);
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) {
        // No hay sesión anónima previa: es nuevo paciente
        setCheckingPatient(false);
        navigation.navigate('PatientOnboarding');
        return;
      }
      const db = getFirestore();
      const uid = user.uid.substring(0, 8);
      const snap = await getDoc(doc(db, 'pacientes', uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data && (data.perfilCompletado || data.nombre)) {
          setCheckingPatient(false);
          navigation.navigate('Patient');
          return;
        }
      }
      setCheckingPatient(false);
      navigation.navigate('PatientOnboarding');
    } catch (e) {
      console.warn('Error al verificar paciente:', e);
      setCheckingPatient(false);
      navigation.navigate('Patient');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      
      <View style={styles.header}>
        <Animatable.View animation="pulse" easing="ease-out" iterationCount="infinite">
          <MaterialCommunityIcons name="heart-pulse" size={75} color="#E53935" />
        </Animatable.View>
        <Text style={styles.title}>VitaLink</Text>
        <Text style={styles.subtitle}>Elegí cómo vas a usar la aplicación hoy</Text>
      </View>

      <View style={styles.buttonContainer}>
        <Animatable.View animation="fadeInUp" duration={450} delay={100}>
          <TouchableOpacity 
            style={styles.cardButton} 
            activeOpacity={0.7}
            onPress={handlePatientPress}
            disabled={checkingPatient}
          >
            <View style={[styles.iconCircle, {backgroundColor: '#2A1A1A'}]}>
              <MaterialCommunityIcons name="watch-variant" size={32} color="#E53935" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Soy Paciente</Text>
              <Text style={styles.cardDesc}>Tengo la pulsera y quiero emitir mis signos vitales.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#555" />
          </TouchableOpacity>
        </Animatable.View>

        <Animatable.View animation="fadeInUp" duration={450} delay={250}>
          <TouchableOpacity 
            style={styles.cardButton} 
            activeOpacity={0.7}
            onPress={() => navigation.navigate('FamilyPatients')}
          >
            <View style={[styles.iconCircle, {backgroundColor: '#1A2A2A'}]}>
              <MaterialCommunityIcons name="account-supervisor" size={32} color="#43A047" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Soy Familiar</Text>
              <Text style={styles.cardDesc}>Quiero monitorear a mi ser querido a distancia.</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#555" />
          </TouchableOpacity>
        </Animatable.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: { alignItems: 'center', marginTop: 100, marginBottom: 60, paddingHorizontal: 20 },
  title: { fontSize: 38, fontWeight: '900', color: '#FFFFFF', marginTop: 15, letterSpacing: 1 },
  subtitle: { fontSize: 16, color: '#AAAAAA', textAlign: 'center', marginTop: 10, lineHeight: 22 },
  buttonContainer: { paddingHorizontal: 24, gap: 20 },
  cardButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E1E', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#333' },
  iconCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 19, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4 },
  cardDesc: { fontSize: 14, color: '#888888', lineHeight: 20 }
});
