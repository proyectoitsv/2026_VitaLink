import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Linking, TouchableOpacity } from 'react-native';
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from '@react-native-firebase/firestore';

export default function FamilyDashboardScreen({ route }) {
  const { patientId } = route.params;
  const [signos, setSignos] = useState(null);
  const [alerta, setAlerta] = useState(null);

  useEffect(() => {
    const db = getFirestore();
    
    const qSignos = query(collection(db, 'pacientes', patientId, 'historial_signos'), orderBy('timestamp', 'desc'), limit(1));
    const unsubSignos = onSnapshot(qSignos, (snapshot) => {
      if (!snapshot.empty) setSignos(snapshot.docs[0].data());
    });

    const qAlertas = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
    const unsubAlertas = onSnapshot(qAlertas, (snapshot) => {
      if (!snapshot.empty) setAlerta(snapshot.docs[0].data());
    });

    return () => { unsubSignos(); unsubAlertas(); };
  }, [patientId]);

  // Sacar ubicacion de la alerta, o si no de los signos
  const lat = alerta?.ubicacion?.latitude || signos?.ubicacion?.latitude;
  const lng = alerta?.ubicacion?.longitude || signos?.ubicacion?.longitude;

  // Mapa estatico super confiable sin necesidad de API Key
  const staticMapUrl = lat && lng 
    ? `https://static-maps.yandex.ru/1.x/?lang=es_ES&ll=${lng},${lat}&z=16&l=map&size=450,250&pt=${lng},${lat},pm2rdm`
    : null;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Monitoreando Paciente</Text>
      <Text style={styles.codeText}>Codigo: {patientId}</Text>
      
      {alerta && (
        <View style={styles.alertBox}>
          <Text style={styles.alertTitle}> ALERTA: {alerta.tipo}</Text>
          <Text style={styles.alertTime}>
            {alerta.timestamp ? new Date(alerta.timestamp.toDate()).toLocaleTimeString() : '...'}
          </Text>
        </View>
      )}

      {lat && lng && (
        <View style={styles.mapContainer}>
          <Text style={styles.mapTitle}>Ubicacion en Tiempo Real</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}>
            <Image 
              source={{ uri: staticMapUrl }} 
              style={styles.map} 
              resizeMode="cover"
            />
            <View style={styles.mapOverlay}>
              <Text style={styles.mapOverlayText}>Tocar para abrir en Google Maps</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Signos Vitales</Text>
        {signos ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Pulsaciones (BPM):</Text>
              <Text style={styles.value}>{signos.bpm}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Oxigeno (SpO2):</Text>
              <Text style={styles.value}>{signos.spo2}%</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Bateria Pulsera:</Text>
              <Text style={styles.value}>{signos.bateria}%</Text>
            </View>
            <Text style={styles.timeText}>
              Ultima act: {signos.timestamp ? new Date(signos.timestamp.toDate()).toLocaleTimeString() : '...'}
            </Text>
          </>
        ) : (
          <Text style={styles.waiting}>Esperando datos del paciente...</Text>
        )}
      </View>
      <View style={{height: 40}} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f0f4f8' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#005b9f', textAlign: 'center', marginTop: 10 },
  codeText: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  alertBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#d32f2f', marginBottom: 20 },
  alertTitle: { color: '#d32f2f', fontWeight: 'bold', fontSize: 18, textAlign: 'center' },
  alertTime: { color: '#666', textAlign: 'center', marginTop: 5 },
  card: { backgroundColor: 'white', padding: 20, borderRadius: 10, elevation: 3, marginBottom: 20 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  label: { fontSize: 16, color: '#555' },
  value: { fontSize: 18, fontWeight: 'bold', color: '#000' },
  waiting: { fontStyle: 'italic', color: '#999', textAlign: 'center' },
  timeText: { textAlign: 'center', color: '#999', fontSize: 12, marginTop: 10 },
  mapContainer: { backgroundColor: 'white', borderRadius: 10, elevation: 3, marginBottom: 20, overflow: 'hidden' },
  mapTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', padding: 15, paddingBottom: 10 },
  map: { width: '100%', height: 250, backgroundColor: '#e0e0e0' },
  mapOverlay: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 20 },
  mapOverlayText: { color: 'white', fontSize: 12, fontWeight: 'bold' }
});
