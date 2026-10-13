import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  Image, 
  Linking, 
  TouchableOpacity, 
  ActivityIndicator, 
  StatusBar, 
  Alert 
} from 'react-native';
import { 
  getFirestore, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  doc, 
  deleteDoc 
} from '@react-native-firebase/firestore';
import { getAuth } from '@react-native-firebase/auth';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

export default function FamilyDashboardScreen({ navigation, route }) {
  const { patientId } = route.params;
  const [signos, setSignos] = useState(null);
  const [alerta, setAlerta] = useState(null);
  const [patientData, setPatientData] = useState(null);

  useEffect(() => {
    const db = getFirestore();
    
    // Escuchar perfil del paciente en tiempo real (nombre, apellido, avatar, ficha médica)
    const unsubPaciente = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) {
        setPatientData(docSnap.data());
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

  // Extraer únicamente el primer nombre para evitar desbordes en pantalla
  const firstName = patientData?.nombre ? patientData.nombre.trim().split(' ')[0] : '';
  const displayName = firstName || `Paciente ${patientId}`;
  const avatar = patientData?.avatar || 'account-circle';

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
    0: { transform: [{ scale: 1 }], opacity: 0.6 },
    0.5: { transform: [{ scale: 1.12 }], opacity: 1 },
    1: { transform: [{ scale: 1 }], opacity: 0.6 }
  };

  const handleUnlinkPatient = () => {
    Alert.alert(
      '¿Desvincular paciente?',
      `¿Estás seguro de que deseas desvincular a ${displayName}?\n\nDejarás de recibir sus alertas y monitoreo en tiempo real.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Sí, desvincular', 
          style: 'destructive',
          onPress: async () => {
            const auth = getAuth();
            const u = auth.currentUser;
            if (u) {
              const db = getFirestore();
              await deleteDoc(doc(db, 'familiares', u.uid.substring(0, 8), 'pacientes', patientId));
            }
            navigation.navigate('FamilyPatients');
          }
        }
      ]
    );
  };

  const isLive = signos && signos.bpm && signos.bpm !== '--';

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* Top Navigation Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity 
            style={styles.navCircleBtn} 
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={28} color="#FFF" />
          </TouchableOpacity>

          <View style={[styles.statusPill, isLive ? styles.statusPillLive : styles.statusPillStandby]}>
            <Animatable.View 
              animation="pulse" 
              iterationCount="infinite" 
              style={[styles.statusDot, { backgroundColor: isLive ? '#34C759' : '#FF9500' }]} 
            />
            <Text style={[styles.statusPillText, { color: isLive ? '#34C759' : '#FF9500' }]}>
              {isLive ? 'MONITOR EN VIVO' : 'EN ESPERA'}
            </Text>
          </View>

          <TouchableOpacity 
            style={styles.navCircleBtn} 
            onPress={handleUnlinkPatient}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="link-off" size={20} color="#8E8E93" />
          </TouchableOpacity>
        </View>

        {/* Patient Profile Header Card */}
        <Animatable.View animation="fadeInDown" duration={400} style={styles.patientHeaderCard}>
          <View style={styles.avatarCircle}>
            <MaterialCommunityIcons name={avatar} size={36} color="#FF2D55" />
          </View>
          <View style={styles.profileTextGroup}>
            <Text style={styles.headerSubtitle}>MONITOR DEL PACIENTE</Text>
            <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
          </View>
        </Animatable.View>

        {/* Medical Sheet Quick Chips */}
        {(patientData?.tipoSangre || patientData?.edad || patientData?.telefonoEmergencia) && (
          <Animatable.View animation="fadeIn" delay={150} style={styles.chipsRow}>
            {patientData?.tipoSangre ? (
              <View style={styles.chip}>
                <MaterialCommunityIcons name="water" size={14} color="#FF2D55" style={{ marginRight: 4 }} />
                <Text style={styles.chipText}>Grupo {patientData.tipoSangre}</Text>
              </View>
            ) : null}

            {patientData?.edad ? (
              <View style={styles.chip}>
                <MaterialCommunityIcons name="account-clock-outline" size={14} color="#64D2FF" style={{ marginRight: 4 }} />
                <Text style={styles.chipText}>{patientData.edad} años</Text>
              </View>
            ) : null}

            {patientData?.telefonoEmergencia ? (
              <TouchableOpacity 
                style={styles.callChip} 
                onPress={() => Linking.openURL(`tel:${patientData.telefonoEmergencia}`)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="phone" size={14} color="#34C759" style={{ marginRight: 4 }} />
                <Text style={styles.callChipText}>Llamar</Text>
              </TouchableOpacity>
            ) : null}
          </Animatable.View>
        )}

        {/* Alert Banner */}
        {alerta && (
          <Animatable.View animation="shake" iterationCount="infinite" style={styles.alertCard}>
            <MaterialCommunityIcons name="alert-octagon" size={32} color="#FFF" />
            <View style={styles.alertTextGroup}>
              <Text style={styles.alertTitle}>{alerta.tipo || 'CAÍDA'} DETECTADO</Text>
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
                <MaterialCommunityIcons name="heart-pulse" size={22} color="#FF2D55" />
                <Text style={styles.cardTitle}>Frecuencia Cardíaca</Text>
              </View>
              
              <View style={styles.bpmContainer}>
                <Animatable.View 
                  animation={signos.bpm !== '--' && signos.bpm !== '0' ? heartbeatAnim : undefined} 
                  iterationCount="infinite" 
                  duration={signos.bpm ? Math.max(500, 60000 / parseInt(signos.bpm)) : 1000}
                  style={styles.heroIconWrapper}
                >
                  <MaterialCommunityIcons name="cards-heart" size={90} color="#FF2D55" />
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
                  <MaterialCommunityIcons name="water" size={18} color="#32ADE6" />
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
                  <MaterialCommunityIcons name="battery-charging-60" size={18} color="#34C759" />
                  <Text style={styles.cardTitle}>Pulsera</Text>
                </View>
                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{signos.bateria}</Text>
                  <Text style={styles.smallCardUnit}>%</Text>
                </View>
              </View>
            </View>

            {/* Timestamp Footer */}
            <View style={styles.timeFooter}>
              <MaterialCommunityIcons name="clock-outline" size={13} color="#666" style={{ marginRight: 6 }} />
              <Text style={styles.timeText}>ACTUALIZADO: {formatTime(signos.timestamp)}</Text>
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
          <Animatable.View animation="fadeInUp" delay={250} style={styles.mapCard}>
            <View style={styles.mapCardHeader}>
              <MaterialCommunityIcons name="map-marker-radius" size={22} color="#FFFFFF" />
              <Text style={styles.mapCardTitle}>Ubicación GPS</Text>
            </View>
            <TouchableOpacity 
              activeOpacity={0.9}
              onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}
            >
              <Image source={{ uri: staticMapUrl }} style={styles.map} resizeMode="cover" />
              <View style={styles.mapOverlay}>
                <Text style={styles.mapOverlayText}>Abrir en Google Maps</Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color="#000" />
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
  container: { paddingBottom: 50 },

  // Top Nav Bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 52, paddingBottom: 14 },
  navCircleBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  
  // Status Pill
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusPillLive: { backgroundColor: 'rgba(52, 199, 89, 0.1)', borderColor: 'rgba(52, 199, 89, 0.25)' },
  statusPillStandby: { backgroundColor: 'rgba(255, 149, 0, 0.1)', borderColor: 'rgba(255, 149, 0, 0.25)' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  statusPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  // Patient Header Card
  patientHeaderCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14 },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,45,85,0.3)', marginRight: 14 },
  profileTextGroup: { flex: 1 },
  headerSubtitle: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 2 },
  headerName: { color: '#FFFFFF', fontSize: 30, fontWeight: '700', letterSpacing: 0.3 },

  // Medical Chips
  chipsRow: { flexDirection: 'row', paddingHorizontal: 22, marginBottom: 18, flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  chipText: { color: '#CCC', fontSize: 12, fontWeight: '700' },
  callChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52, 199, 89, 0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(52, 199, 89, 0.3)' },
  callChipText: { color: '#34C759', fontSize: 12, fontWeight: '800' },

  // Alerts
  alertCard: { backgroundColor: '#FF2D55', flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 22, marginHorizontal: 20, marginBottom: 18, shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12 },
  alertTextGroup: { marginLeft: 14 },
  alertTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  alertDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginTop: 2 },

  // Content
  content: { paddingHorizontal: 20 },

  // Hero Card (BPM)
  heroCard: { backgroundColor: '#121212', borderRadius: 30, padding: 22, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardTitle: { color: '#8E8E93', fontSize: 14, fontWeight: '700', marginLeft: 8, letterSpacing: 0.5 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  heroIconWrapper: { shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 25 },
  bpmTextWrapper: { alignItems: 'flex-end', flex: 1 },
  bpmValue: { color: '#FFFFFF', fontSize: 96, fontWeight: '200', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -3, textAlign: 'right' },
  bpmUnit: { color: '#FF2D55', fontSize: 18, fontWeight: '800', letterSpacing: 1, marginTop: -4 },

  // Row Cards
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  smallCard: { backgroundColor: '#121212', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  smallCardValue: { color: '#FFFFFF', fontSize: 46, fontWeight: '300', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -1 },
  smallCardUnit: { color: '#8E8E93', fontSize: 16, fontWeight: '600', marginLeft: 4 },
  glowSpO2: { position: 'absolute', bottom: -20, right: -20, width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(50, 173, 230, 0.15)' },

  // Footer
  timeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 8 },
  timeText: { color: '#555', fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  centerCard: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { marginTop: 14, color: '#8E8E93', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },

  // Map Card
  mapCard: { marginHorizontal: 20, marginTop: 6, borderRadius: 26, overflow: 'hidden', backgroundColor: '#121212', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  mapCardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  mapCardTitle: { color: '#8E8E93', fontSize: 14, fontWeight: '700', marginLeft: 8, letterSpacing: 0.5 },
  map: { width: '100%', height: 210, opacity: 0.9 },
  mapOverlay: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  mapOverlayText: { color: '#000000', fontSize: 13, fontWeight: '800', letterSpacing: 0.3, marginRight: 4 }
});
