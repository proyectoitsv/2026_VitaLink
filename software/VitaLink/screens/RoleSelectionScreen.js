import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
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
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />

      {/* Encabezado */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Animatable.View animation="pulse" easing="ease-out" iterationCount="infinite" duration={1800}>
            <MaterialCommunityIcons name="heart-pulse" size={52} color="#E04644" />
          </Animatable.View>
        </View>
        <Text style={styles.title}>VitaLink</Text>
        <Text style={styles.subtitle}>Elegí cómo vas a usar la aplicación hoy</Text>
      </View>

      {/* Botones de selección de rol (ubicados más arriba y limpios) */}
      <View style={styles.buttonContainer}>
        <Animatable.View animation="fadeInUp" duration={450} delay={80}>
          <TouchableOpacity
            style={[styles.cardButton, styles.patientCardBorder]}
            activeOpacity={0.78}
            onPress={handlePatientPress}
            disabled={checkingPatient}
          >
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(224, 70, 68, 0.16)' }]}>
              <MaterialCommunityIcons name="watch-variant" size={30} color="#E04644" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Soy Paciente</Text>
              <Text style={styles.cardDesc}>Tengo la pulsera y quiero emitir mis signos vitales.</Text>
            </View>
            <View style={[styles.arrowBadge, { backgroundColor: '#E04644' }]}>
              {checkingPatient ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <MaterialCommunityIcons name="chevron-right" size={24} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>
        </Animatable.View>

        <Animatable.View animation="fadeInUp" duration={450} delay={180}>
          <TouchableOpacity
            style={[styles.cardButton, styles.familyCardBorder]}
            activeOpacity={0.78}
            onPress={() => navigation.navigate('FamilyPatients')}
          >
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(67, 198, 103, 0.16)' }]}>
              <MaterialCommunityIcons name="account-supervisor" size={30} color="#43C667" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Soy Familiar</Text>
              <Text style={styles.cardDesc}>Quiero monitorear a mi ser querido a distancia.</Text>
            </View>
            <View style={[styles.arrowBadge, { backgroundColor: '#43C667' }]}>
              <MaterialCommunityIcons name="chevron-right" size={24} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </Animatable.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0D10',
    paddingTop: 58,
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
    paddingHorizontal: 24,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#22252A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '500',
  },
  buttonContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22252A',
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: 1.5,
  },
  patientCardBorder: {
    borderColor: 'rgba(224, 70, 68, 0.35)',
  },
  familyCardBorder: {
    borderColor: 'rgba(67, 198, 103, 0.35)',
  },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  cardText: {
    flex: 1,
    paddingRight: 10,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13.5,
    color: '#9CA3AF',
    lineHeight: 19,
    fontWeight: '500',
  },
  arrowBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
