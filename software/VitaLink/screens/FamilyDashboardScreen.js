import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Linking, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

export default function FamilyDashboardScreen({ route }) {
  const { patientId } = route.params;
  const [signos, setSignos] = useState(null);
  const [alerta, setAlerta] = useState(null);
  const [patientName, setPatientName] = useState('');

  useEffect(() => {
    const db = getFirestore();
    
    // Escuchar datos del paciente (nombre)
    const unsubPaciente = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists() && docSnap.data().nombre) {
        setPatientName(docSnap.data().nombre);
      }
    });

    // Escuchar signos vitales live con fallback automático
    const unsubSignos = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) {
        setSignos(docSnap.data());
      } else {
        // Fallback: si live aún no existe, consultar el historial reciente
        const qFallback = query(collection(db, 'pacientes', patientId, 'historial_signos'), orderBy('timestamp', 'desc'), limit(1));
        const unsubFallback = onSnapshot(qFallback, (snapshot) => {
          if (!snapshot.empty) {
            setSignos(snapshot.docs[0].data());
          } else {
            // Si la base está vacía pero el paciente existe, mostrar tarjetas con guiones
            setSignos({ bpm: '--', spo2: '--', bateria: '--', timestamp: null });
          }
        });
      }
    });

    const qAlertas = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
    const unsubAlertas = onSnapshot(qAlertas, (snapshot) => {
      if (!snapshot.empty) setAlerta(snapshot.docs[0].data());
    });

    return () => { unsubPaciente(); unsubSignos(); unsubAlertas(); };
  }, [patientId]);

  const lat = alerta?.ubicacion?.latitude || signos?.ubicacion?.latitude;
  const lng = alerta?.ubicacion?.longitude || signos?.ubicacion?.longitude;

  const staticMapUrl = lat && lng 
    ? `https://static-maps.yandex.ru/1.x/?lang=es_ES&ll=${lng},${lat}&z=16&l=map&size=450,250&pt=${lng},${lat},pm2rdm`
    : null;

  const formatTime = (ts) => {
    if (!ts) return '...';
    try {
      return new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(ts.toDate());
    } catch(e) {
      return ts.toDate().toLocaleTimeString();
    }
  };

  const heartbeatAnim = {
    0: { transform: [{ scale: 1 }] },
    0.15: { transform: [{ scale: 1.25 }] },
    0.3: { transform: [{ scale: 1 }] },
    0.45: { transform: [{ scale: 1.15 }] },
    1: { transform: [{ scale: 1 }] }
  };

  const breatheAnim = {
    0: { transform: [{ scale: 1 }], opacity: 0.7 },
    0.5: { transform: [{ scale: 1.15 }], opacity: 1 },
    1: { transform: [{ scale: 1 }], opacity: 0.7 }
  };

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView contentContainerStyle={styles.container}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSubtitle}>MONITOR EN VIVO</Text>
            <View style={styles.codeRow}>
              <Text style={styles.headerTitle}>Paciente </Text>
              <Text style={styles.codeHighlight} numberOfLines={1}>
                {patientName ? patientName : patientId}
              </Text>
            </View>
            {patientName ? (
              <Text style={styles.patientIdBadge}>ID: {patientId}</Text>
            ) : null}
          </View>
          <View style={styles.statusDotWrapper}>
            <Animatable.View animation="pulse" iterationCount="infinite" style={[styles.statusDot, { backgroundColor: signos ? '#34C759' : '#FF9500' }]} />
          </View>
        </View>

        {/* Alert Banner */}
        {alerta && (
          <Animatable.View animation="shake" iterationCount="infinite" style={styles.alertCard}>
            <MaterialCommunityIcons name="alert-octagon" size={32} color="#FFF" />
            <View style={styles.alertTextGroup}>
              <Text style={styles.alertTitle}>{alerta.tipo} DETECTADO</Text>
              <Text style={styles.alertDesc}>{formatTime(alerta.timestamp)}</Text>
            </View>
          </Animatable.View>
        )}

        {/* Vitals Content */}
        {signos ? (
          <Animatable.View animation="fadeInUp" delay={100} style={styles.content}>
            
            {/* BPM Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="heart-pulse" size={24} color="#FF2D55" />
                <Text style={styles.cardTitle}>Frecuencia Cardíaca</Text>
              </View>
              
              <View style={styles.bpmContainer}>
                <Animatable.View 
                  animation={signos.bpm !== '--' && signos.bpm !== '0' ? heartbeatAnim : undefined} 
                  iterationCount="infinite" 
                  duration={signos.bpm ? Math.max(500, 60000 / parseInt(signos.bpm)) : 1000}
                  style={styles.heroIconWrapper}
                >
                  <MaterialCommunityIcons name="cards-heart" size={100} color="#FF2D55" />
                </Animatable.View>
                
                <View style={styles.bpmTextWrapper}>
                  <Text style={styles.bpmValue} adjustsFontSizeToFit numberOfLines={1}>{signos.bpm}</Text>
                  <Text style={styles.bpmUnit}>LPM</Text>
                </View>
              </View>
            </View>

            {/* Secondary Metrics Row */}
            <View style={styles.rowCards}>
              {/* SpO2 Card */}
              <View style={[styles.smallCard, { flex: 1, marginRight: 8 }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="water" size={20} color="#32ADE6" />
                  <Text style={styles.cardTitle}>Oxígeno</Text>
                </View>
                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{signos.spo2}</Text>
                  <Text style={styles.smallCardUnit}>%</Text>
                </View>
                <Animatable.View 
                  animation={breatheAnim} 
                  iterationCount="infinite" 
                  duration={3000}
                  style={styles.glowSpO2}
                />
              </View>

              {/* Battery Card */}
              <View style={[styles.smallCard, { flex: 1, marginLeft: 8 }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="battery-charging-60" size={20} color="#34C759" />
                  <Text style={styles.cardTitle}>Pulsera</Text>
                </View>
                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{signos.bateria}</Text>
                  <Text style={styles.smallCardUnit}>%</Text>
                </View>
              </View>
            </View>

            <View style={styles.timeFooter}>
              <MaterialCommunityIcons name="clock-outline" size={14} color="#48484A" style={{marginRight: 6}} />
              <Text style={styles.timeText}>Actualizado: {formatTime(signos.timestamp)}</Text>
            </View>

          </Animatable.View>
        ) : (
          <View style={styles.centerCard}>
            <ActivityIndicator size="large" color="#FF2D55" />
            <Text style={styles.loadingText}>Conectando con el monitor...</Text>
          </View>
        )}

        {/* Map */}
        {lat && lng && (
          <Animatable.View animation="fadeInUp" delay={300} style={[styles.heroCard, { marginTop: 16, padding: 0, overflow: 'hidden' }]}>
            <View style={[styles.cardHeader, { padding: 24, paddingBottom: 16, marginBottom: 0 }]}>
              <MaterialCommunityIcons name="map-marker-radius" size={24} color="#FFFFFF" />
              <Text style={styles.cardTitle}>Ubicación GPS</Text>
            </View>
            <TouchableOpacity 
              activeOpacity={0.9}
              onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}
            >
              <Image source={{ uri: staticMapUrl }} style={styles.map} resizeMode="cover" />
              <View style={styles.mapOverlay}>
                <Text style={styles.mapOverlayText}>Abrir en Google Maps</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color="#000" />
              </View>
            </TouchableOpacity>
          </Animatable.View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#050505' },
  container: { paddingBottom: 40 },
  
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 20 },
  headerSubtitle: { color: '#8E8E93', fontSize: 13, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  codeRow: { flexDirection: 'row', alignItems: 'baseline' },
  headerTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '300' },
  codeHighlight: { color: '#FF2D55', fontSize: 28, fontWeight: '700', letterSpacing: 1 },
  patientIdBadge: { color: '#8E8E93', fontSize: 13, fontWeight: '600', marginTop: 4, letterSpacing: 0.5 },
  statusDotWrapper: { marginTop: 8 },
  statusDot: { width: 14, height: 14, borderRadius: 7, shadowColor: '#FFF', shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.3, shadowRadius: 8 },

  // Alerts
  alertCard: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, marginHorizontal: 20, marginBottom: 20, shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.4, shadowRadius: 15 },
  alertTextGroup: { marginLeft: 16 },
  alertTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  alertDesc: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '500', marginTop: 2 },
  
  // Content
  content: { paddingHorizontal: 20 },

  // Cards Base
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: '#8E8E93', fontSize: 15, fontWeight: '600', marginLeft: 8, letterSpacing: 0.5 },
  
  // Hero Card (BPM)
  heroCard: { backgroundColor: '#121212', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', shadowColor: '#000', shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.5, shadowRadius: 20 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  heroIconWrapper: { shadowColor: '#FF2D55', shadowOffset: {width: 0, height: 0}, shadowOpacity: 0.4, shadowRadius: 30 },
  bpmTextWrapper: { alignItems: 'flex-end', flex: 1 },
  bpmValue: { color: '#FFFFFF', fontSize: 110, fontWeight: '200', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -4, textAlign: 'right' },
  bpmUnit: { color: '#FF2D55', fontSize: 22, fontWeight: '800', letterSpacing: 1, marginTop: -5 },

  // Row Cards
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  smallCard: { backgroundColor: '#121212', borderRadius: 28, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  smallCardValue: { color: '#FFFFFF', fontSize: 50, fontWeight: '300', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -1 },
  smallCardUnit: { color: '#8E8E93', fontSize: 18, fontWeight: '600', marginLeft: 4 },
  glowSpO2: { position: 'absolute', bottom: -20, right: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(50, 173, 230, 0.15)', blurRadius: 20 },

  // Footer
  timeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 10 },
  timeText: { color: '#48484A', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  
  centerCard: { alignItems: 'center', paddingVertical: 60 },
  loadingText: { marginTop: 16, color: '#8E8E93', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  
  // Map
  map: { width: '100%', height: 220, opacity: 0.9 },
  mapOverlay: { position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 30, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 10 },
  mapOverlayText: { color: '#000000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5, marginRight: 4 },
});
