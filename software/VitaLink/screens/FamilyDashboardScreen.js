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
    
    const unsubPaciente = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) {
        setPatientData(docSnap.data());
      }
    });

    let unsubFallback = () => {};
    const unsubSignos = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) {
        setSignos(docSnap.data());
      } else {
        const qFallback = query(collection(db, 'pacientes', patientId, 'historial_signos'), orderBy('timestamp', 'desc'), limit(1));
        unsubFallback = onSnapshot(qFallback, (snapshot) => {
          if (!snapshot.empty) {
            setSignos(snapshot.docs[0].data());
          } else {
            setSignos({ bpm: '--', spo2: '--', bateria: '--', timestamp: null });
          }
        });
      }
    });

    const qAlertas = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
    const unsubAlertas = onSnapshot(qAlertas, (snapshot) => {
      if (!snapshot.empty) setAlerta(snapshot.docs[0].data());
    });

    return () => { unsubPaciente(); unsubSignos(); unsubAlertas(); unsubFallback(); };
  }, [patientId]);

  const firstName = patientData?.nombre ? patientData.nombre.trim().split(' ')[0] : '';
  const displayName = firstName || `Paciente ${patientId}`;
  const avatar = patientData?.avatar || 'account';

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
    0.15: { transform: [{ scale: 1.18 }] },
    0.3: { transform: [{ scale: 1 }] },
    0.45: { transform: [{ scale: 1.1 }] },
    1: { transform: [{ scale: 1 }] }
  };

  const breatheAnim = {
    0: { transform: [{ scale: 1 }], opacity: 0.85 },
    0.5: { transform: [{ scale: 1.08 }], opacity: 1 },
    1: { transform: [{ scale: 1 }], opacity: 0.85 }
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
  const batNum = signos && signos.bateria ? parseInt(signos.bateria, 10) : NaN;
  const batValid = !isNaN(batNum) && batNum >= 0;
  const batBars = !batValid ? 2 : batNum > 66 ? 3 : batNum > 25 ? 2 : 1;

  return (
    <View style={styles.safeArea}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* Top Navigation Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity 
            style={styles.navCircleBtn} 
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
          </TouchableOpacity>

          <View style={styles.statusPill}>
            <Animatable.View 
              animation="pulse" 
              iterationCount="infinite" 
              style={[styles.statusDot, { backgroundColor: isLive ? '#43C667' : '#D4A359' }]} 
            />
            <Text style={[styles.statusPillText, { color: isLive ? '#43C667' : '#D4A359' }]}>
              {isLive ? 'VITALINK EN LÍNEA' : 'EN ESPERA'}
            </Text>
          </View>

          <TouchableOpacity 
            style={styles.navCircleBtn} 
            onPress={handleUnlinkPatient}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="link-off" size={20} color="#D1D5DB" />
          </TouchableOpacity>
        </View>

        {/* Patient Profile Header Card */}
        <Animatable.View animation="fadeInDown" duration={400} style={styles.patientHeaderCard}>
          <View style={styles.avatarCircle}>
            {patientData?.foto ? (
              <Image source={{ uri: patientData.foto }} style={styles.avatarImg} />
            ) : (
              <MaterialCommunityIcons name={avatar} size={34} color="#374151" />
            )}
          </View>
          <View style={styles.profileTextGroup}>
            <Text style={styles.headerSubtitle}>MONITOR DEL PACIENTE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
              <View style={[styles.inlineStatusDot, { backgroundColor: isLive ? '#43C667' : '#D4A359' }]} />
            </View>
          </View>
        </Animatable.View>

        {/* Medical Sheet Quick Chips */}
        {(patientData?.tipoSangre || patientData?.edad || patientData?.telefonoEmergencia) && (
          <Animatable.View animation="fadeIn" delay={150} style={styles.chipsRow}>
            {patientData?.tipoSangre ? (
              <View style={styles.chip}>
                <MaterialCommunityIcons name="water" size={14} color="#E04644" style={{ marginRight: 4 }} />
                <Text style={styles.chipText}>Grupo {patientData.tipoSangre}</Text>
              </View>
            ) : null}

            {patientData?.edad ? (
              <View style={styles.chip}>
                <MaterialCommunityIcons name="account-clock-outline" size={14} color="#3AB4F2" style={{ marginRight: 4 }} />
                <Text style={styles.chipText}>{patientData.edad} años</Text>
              </View>
            ) : null}

            {patientData?.telefonoEmergencia ? (
              <TouchableOpacity 
                style={styles.callChip} 
                onPress={() => Linking.openURL(`tel:${patientData.telefonoEmergencia}`)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="phone" size={14} color="#43C667" style={{ marginRight: 4 }} />
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
              <Text style={styles.cardTitle}>Frecuencia Cardíaca</Text>
              
              <View style={styles.bpmContainer}>
                <View style={styles.bpmLeftGroup}>
                  <Animatable.View 
                    animation={heartbeatAnim} 
                    iterationCount="infinite" 
                    duration={signos.bpm && signos.bpm !== '--' && signos.bpm !== '0' ? Math.max(500, 60000 / parseInt(signos.bpm)) : 1000}
                  >
                    <MaterialCommunityIcons name="cards-heart" size={44} color="#E04644" />
                  </Animatable.View>
                  
                  <View style={styles.bpmTextRow}>
                    <Text style={styles.bpmValue} numberOfLines={1}>{signos.bpm}</Text>
                    <Text style={styles.bpmUnit}>LPM</Text>
                  </View>
                </View>

                <Animatable.View
                  animation="pulse"
                  iterationCount="infinite"
                  duration={1800}
                  style={styles.ecgContainer}
                >
                  <Image
                    source={require('../assets/ecg_wave.png')}
                    style={styles.ecgImage}
                    resizeMode="contain"
                  />
                </Animatable.View>
              </View>
            </View>

            {/* Secondary Metrics Row */}
            <View style={styles.rowCards}>
              {/* SpO2 Card */}
              <View style={[styles.smallCard, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.cardTitle}>Oxígeno</Text>

                <Animatable.View animation={breatheAnim} iterationCount="infinite" duration={2500} style={styles.smallCardIconWrap}>
                  <MaterialCommunityIcons name="water" size={48} color="#3AB4F2" />
                </Animatable.View>

                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{signos.spo2}</Text>
                  <Text style={styles.smallCardUnit}> %</Text>
                </View>
              </View>

              {/* Battery Card */}
              <View style={[styles.smallCard, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.cardTitle}>Batería</Text>

                <View style={styles.smallCardIconWrap}>
                  <View style={styles.customBatteryWrap}>
                    <View style={styles.customBatteryCap} />
                    <View style={styles.customBatteryBody}>
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 3 ? 0.45 : 0.15 }]} />
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 2 ? 1 : 0.2 }]} />
                      <View style={[styles.customBatteryBar, { opacity: batBars >= 1 ? 1 : 0.2, marginBottom: 0 }]} />
                    </View>
                  </View>
                </View>

                <View style={styles.metricContainer}>
                  <Text style={styles.smallCardValue}>{signos.bateria}</Text>
                  <Text style={styles.smallCardUnit}> %</Text>
                </View>
              </View>
            </View>

            {/* Timestamp Footer */}
            <View style={styles.timeFooter}>
              <MaterialCommunityIcons name="clock-outline" size={13} color="#6B7280" style={{ marginRight: 6 }} />
              <Text style={styles.timeText}>ACTUALIZADO: {formatTime(signos.timestamp)}</Text>
            </View>

          </Animatable.View>
        ) : (
          <View style={styles.centerCard}>
            <ActivityIndicator size="large" color="#E04644" />
            <Text style={styles.loadingText}>Conectando con el monitor...</Text>
          </View>
        )}

        {/* Map */}
        {lat && lng && (
          <Animatable.View animation="fadeInUp" delay={250} style={styles.mapCard}>
            <View style={styles.mapCardHeader}>
              <MaterialCommunityIcons name="map-marker-radius" size={22} color="#E8EAED" />
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
  safeArea: { flex: 1, backgroundColor: '#0B0D10' },
  container: { paddingBottom: 50 },

  // Top Nav Bar
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 42, paddingBottom: 14 },
  navCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },
  
  // Status Pill
  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252A', paddingHorizontal: 16, height: 40, borderRadius: 20 },
  statusDot: { width: 9, height: 9, borderRadius: 4.5, marginRight: 8 },
  statusPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  // Patient Header Card
  patientHeaderCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14 },
  avatarCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  profileTextGroup: { flex: 1 },
  headerSubtitle: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 2 },
  headerName: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', letterSpacing: 0.2, flexShrink: 1 },
  inlineStatusDot: { width: 9, height: 9, borderRadius: 4.5, marginLeft: 8, marginTop: 2 },

  // Medical Chips
  chipsRow: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 16, flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252A', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  chipText: { color: '#E5E7EB', fontSize: 12, fontWeight: '600' },
  callChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252A', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  callChipText: { color: '#43C667', fontSize: 12, fontWeight: '700' },

  // Alerts
  alertCard: { backgroundColor: '#E04644', flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 22, marginHorizontal: 20, marginBottom: 16 },
  alertTextGroup: { marginLeft: 14 },
  alertTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  alertDesc: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600', marginTop: 2 },

  // Content
  content: { paddingHorizontal: 20 },

  // Titles
  cardTitle: { color: '#E8EAED', fontSize: 18, fontWeight: '600', letterSpacing: 0.1 },

  // Hero Card (BPM)
  heroCard: { backgroundColor: '#22252A', borderRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, marginBottom: 16 },
  bpmContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  bpmLeftGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  bpmTextRow: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 12 },
  bpmValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false },
  bpmUnit: { color: '#E8EAED', fontSize: 22, fontWeight: '500', marginLeft: 8 },
  ecgContainer: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', marginLeft: 10 },
  ecgImage: { width: 155, height: 78 },

  // Row Cards
  rowCards: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  smallCard: { backgroundColor: '#22252A', borderRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 22, minHeight: 175, justifyContent: 'space-between' },
  smallCardIconWrap: { alignSelf: 'flex-start', marginVertical: 12 },
  metricContainer: { flexDirection: 'row', alignItems: 'baseline' },
  smallCardValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], includeFontPadding: false },
  smallCardUnit: { color: '#FFFFFF', fontSize: 30, fontWeight: '500' },

  // Battery Icon
  customBatteryWrap: { alignItems: 'center', marginLeft: 4 },
  customBatteryCap: { width: 12, height: 4, backgroundColor: '#43C667', borderTopLeftRadius: 2, borderTopRightRadius: 2, marginBottom: 1 },
  customBatteryBody: { width: 26, height: 42, borderRadius: 4, borderWidth: 2.5, borderColor: '#43C667', padding: 3, justifyContent: 'space-between' },
  customBatteryBar: { width: '100%', height: 9, backgroundColor: '#43C667', borderRadius: 1.5, marginBottom: 2 },

  // Footer
  timeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 8 },
  timeText: { color: '#6B7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },

  centerCard: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { marginTop: 14, color: '#9CA3AF', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },

  // Map Card
  mapCard: { marginHorizontal: 20, marginTop: 6, borderRadius: 22, overflow: 'hidden', backgroundColor: '#22252A' },
  mapCardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  mapCardTitle: { color: '#E8EAED', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  map: { width: '100%', height: 210, opacity: 0.92 },
  mapOverlay: { position: 'absolute', bottom: 14, alignSelf: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, flexDirection: 'row', alignItems: 'center' },
  mapOverlayText: { color: '#000000', fontSize: 13, fontWeight: '800', letterSpacing: 0.3, marginRight: 4 }
});
