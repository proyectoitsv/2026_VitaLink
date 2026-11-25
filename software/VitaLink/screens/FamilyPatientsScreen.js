import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Image,
  Alert
} from 'react-native';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  deleteDoc,
  query,
  orderBy,
  limit
} from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { useAlertaActiva, infoTipoAlerta } from '../constants/alertas';
import { iniciarMonitorFamilia } from '../services/monitorFamilia';
import { abrirAccesoNoMolestar, abrirAjustesBateria } from '../services/notificaciones';
import { mostrarValor } from '../components/VitalsPanel';
import { colors } from '../constants/theme';

export default function FamilyPatientsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  // Al volver del panel, el avatar del paciente que se abrió "aterriza" en su tarjeta
  const [aterrizaje, setAterrizaje] = useState({ id: null, n: 0 });
  const ultimoAbiertoRef = useRef(null);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (ultimoAbiertoRef.current) {
        setAterrizaje((a) => ({ id: ultimoAbiertoRef.current, n: a.n + 1 }));
        ultimoAbiertoRef.current = null;
      }
    });
    return unsub;
  }, [navigation]);
  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    signInAnonymously(auth);
    iniciarMonitorFamilia({ pedirPermisos: true });
    let unsubList = () => {};

    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (u) {
        const familyUid = u.uid.substring(0, 8);
        unsubList = onSnapshot(collection(db, 'familiares', familyUid, 'pacientes'), (snapshot) => {
          const list = [];
          snapshot.forEach((docSnap) => {
            list.push({ id: docSnap.id, ...docSnap.data() });
          });
          setPatients(list);
          setLoading(false);
        }, (err) => {
          console.error(err);
          setLoading(false);
        });
      }
    });

    return () => { unsubAuth(); unsubList(); };
  }, []);

  const handleRemovePatient = (patientId, patientName) => {
    Alert.alert(
      '¿Desvincular paciente?',
      `¿Estás seguro de que deseas desvincular a ${patientName || patientId}?\n\nDejarás de recibir sus alertas y monitoreo en tiempo real.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, desvincular',
          style: 'destructive',
          onPress: async () => {
            const u = auth.currentUser;
            if (u) {
              await deleteDoc(doc(db, 'familiares', u.uid.substring(0, 8), 'pacientes', patientId));
            }
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('RoleSelection')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerCategory}>MONITOREO FAMILIAR</Text>
          <Text style={styles.headerTitle}>Mis Pacientes</Text>
        </View>

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('FamilyLogin')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="plus" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#E04644" />
        </View>
      ) : patients.length === 0 ? (
        <Animatable.View animation="fadeInUp" style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <MaterialCommunityIcons name="account-multiple-plus-outline" size={52} color="#E04644" />
          </View>
          <Text style={styles.emptyTitle}>No hay pacientes vinculados</Text>
          <Text style={styles.emptySubtitle}>
            Agregá a tus seres queridos para comenzar a monitorear sus signos vitales y caídas en tiempo real.
          </Text>
          <TouchableOpacity
            style={styles.firstAddBtn}
            onPress={() => navigation.navigate('FamilyLogin')}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.firstAddBtnText}>Vincular Primer Paciente</Text>
          </TouchableOpacity>
        </Animatable.View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {patients.map((item) => (
            <PatientListItem
              key={item.id}
              item={item}
              db={db}
              aterrizar={aterrizaje.id === (item.patientId || item.id) ? aterrizaje.n : 0}
              onPress={(origen, extra) => {
                ultimoAbiertoRef.current = item.patientId || item.id;
                navigation.navigate('FamilyDashboard', { patientId: item.patientId || item.id, origen, ...extra });
              }}
              onRemove={(name) => handleRemovePatient(item.patientId || item.id, name)}
            />
          ))}

          {/* Quick link to add another */}
          <TouchableOpacity
            style={styles.bottomAddCard}
            onPress={() => navigation.navigate('FamilyLogin')}
            activeOpacity={0.75}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={22} color="#9CA3AF" />
            <Text style={styles.bottomAddCardText}>Vincular a otro paciente</Text>
          </TouchableOpacity>

          {/* Configuración para que la alarma suene siempre */}
          <View style={styles.alarmSetupCard}>
            <View style={styles.alarmSetupHeader}>
              <View style={styles.alarmSetupIcon}>
                <MaterialCommunityIcons name="alarm-light-outline" size={20} color={colors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alarmSetupTitle}>Que la alarma suene siempre</Text>
                <Text style={styles.alarmSetupText}>Hacé estos dos pasos una vez para recibir la alarma con la app cerrada o en "No molestar".</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.alarmSetupBtn} onPress={abrirAccesoNoMolestar} activeOpacity={0.8}>
              <MaterialCommunityIcons name="minus-circle-off-outline" size={18} color={colors.textSoft} style={{ marginRight: 10 }} />
              <Text style={styles.alarmSetupBtnText}>Permitir sonar en "No molestar"</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.alarmSetupBtn}
              onPress={async () => {
                const restringida = await abrirAjustesBateria();
                if (!restringida) Alert.alert('Listo', 'VitaLink ya puede funcionar en segundo plano. Si tu celular tiene un ahorro de batería propio (Xiaomi, Samsung, Huawei), agregá VitaLink como excepción.');
              }}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="battery-heart-variant" size={18} color={colors.textSoft} style={{ marginRight: 10 }} />
              <Text style={styles.alarmSetupBtnText}>Permitir funcionar en segundo plano</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function PatientListItem({ item, db, onPress, onRemove, aterrizar = 0 }) {
  const avatarRef = useRef(null);
  const avatarAnimRef = useRef(null);

  // Rebote suave cuando el avatar vuelve a su tarjeta
  useEffect(() => {
    if (aterrizar > 0) avatarAnimRef.current?.bounceIn?.(650);
  }, [aterrizar]);
  const patientId = item.patientId || item.id;
  const [patientData, setPatientData] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [alerta] = useAlertaActiva(db, patientId);

  useEffect(() => {
    const unsubDoc = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) setPatientData(docSnap.data());
    });

    const unsubVitals = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) setVitals(docSnap.data());
    });

    return () => {
      unsubDoc();
      unsubVitals();
    };
  }, [patientId]);

  const nombreCompleto = patientData
    ? [patientData.nombre, patientData.apellido].filter(Boolean).join(' ')
    : (item.nombre || `Paciente ${patientId}`);
  const avatar = patientData?.avatar || 'account';
  const vinculo = item.vinculo || 'Familiar';
  const edad = patientData?.edad;
  const tipoSangre = patientData?.tipoSangre;
  const tsMs = vitals?.timestamp?.toMillis ? vitals.timestamp.toMillis() : 0;
  const isOnline = !!tsMs && Date.now() - tsMs < 25000 && vitals?.bpm && vitals.bpm !== '--';
  const batNum = parseInt(vitals?.bateria, 10);
  const batBaja = isOnline && !isNaN(batNum) && batNum > 0 && batNum <= 20;

  return (
    <Animatable.View animation="fadeInUp" duration={400}>
      <TouchableOpacity
        style={[styles.patientCard, alerta && styles.patientCardAlert]}
        onPress={() => {
          const extra = { foto: patientData?.foto || item.foto || null, avatar };
          // Medir dónde está el avatar para que "vuele" hasta el encabezado del panel
          if (!avatarRef.current) return onPress(null, extra);
          avatarRef.current.measureInWindow((x, y, w) => onPress(w ? { x, y, size: w } : null, extra));
        }}
        onLongPress={() => onRemove(nombreCompleto)}
        activeOpacity={0.85}
      >
        {alerta ? (
          <Animatable.View animation="flash" iterationCount="infinite" duration={1400} style={styles.alertStrip}>
            <MaterialCommunityIcons name={infoTipoAlerta(alerta.tipo).icono} size={16} color="#FFF" style={{ marginRight: 6 }} />
            <Text style={styles.alertStripText}>EMERGENCIA · {infoTipoAlerta(alerta.tipo).titulo}</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color="#FFF" style={{ marginLeft: 'auto' }} />
          </Animatable.View>
        ) : null}

        <View style={styles.cardTop}>
          <Animatable.View ref={avatarAnimRef}>
          <View ref={avatarRef} collapsable={false} style={[styles.avatarCircle, isOnline && styles.avatarOnline]}>
            {patientData?.foto ? (
              <Image source={{ uri: patientData.foto }} style={styles.avatarImg} />
            ) : (
              <MaterialCommunityIcons name={avatar} size={34} color="#374151" />
            )}
          </View>
          </Animatable.View>

          <View style={styles.cardInfo}>
            <Text style={styles.vinculoLabel}>{vinculo.toUpperCase()}</Text>
            <Text style={styles.patientName} numberOfLines={1}>{nombreCompleto}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.ok : colors.textFaint }]} />
              <Text style={[styles.metaText, { color: isOnline ? colors.ok : colors.textMuted }]}>
                {isOnline ? 'En línea' : 'Sin conexión'}
              </Text>
              {edad ? <Text style={styles.metaText}>· {edad} años</Text> : null}
              {tipoSangre ? <Text style={styles.metaText}>· {tipoSangre}</Text> : null}
            </View>
          </View>

          <TouchableOpacity
            style={styles.cardUnlinkBtn}
            onPress={() => onRemove(nombreCompleto)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="link-off" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Animatable.View animation={isOnline ? 'pulse' : undefined} iterationCount="infinite" duration={1000}>
              <MaterialCommunityIcons name="cards-heart" size={16} color={colors.heart} />
            </Animatable.View>
            <Text style={styles.statValue}>{isOnline ? mostrarValor(vitals.bpm) : '--'}</Text>
            <Text style={styles.statUnit}>LPM</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <MaterialCommunityIcons name="water" size={16} color={colors.oxygen} />
            <Text style={styles.statValue}>{isOnline ? mostrarValor(vitals.spo2) : '--'}</Text>
            <Text style={styles.statUnit}>%</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <MaterialCommunityIcons name={batBaja ? 'battery-low' : 'battery'} size={16} color={batBaja ? colors.warn : colors.ok} />
            <Text style={[styles.statValue, batBaja && { color: colors.warn }]}>{isOnline ? mostrarValor(vitals.bateria) : '--'}</Text>
            <Text style={styles.statUnit}>%</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animatable.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 42, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#17191E', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { alignItems: 'center' },
  headerCategory: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 2 },
  headerTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E04644', justifyContent: 'center', alignItems: 'center' },

  // Empty State
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#17191E', justifyContent: 'center', alignItems: 'center', marginBottom: 22 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  firstAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E04644', paddingVertical: 16, paddingHorizontal: 26, borderRadius: 20 },
  firstAddBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 50 },
  patientCard: { backgroundColor: '#17191E', borderRadius: 22, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  patientCardAlert: { backgroundColor: '#2A1214', borderWidth: 1.5, borderColor: '#E04644' },
  alertStrip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#C81E24', marginHorizontal: -16, marginTop: -16, marginBottom: 14, paddingHorizontal: 16, paddingVertical: 10 },
  alertStripText: { color: '#FFF', fontSize: 12.5, fontWeight: '900', letterSpacing: 0.6 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatarCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  avatarOnline: { borderColor: '#43C667' },
  avatarImg: { width: '100%', height: '100%' },
  cardInfo: { flex: 1, marginLeft: 14, marginRight: 8 },
  vinculoLabel: { color: '#D4A359', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2 },
  patientName: { color: '#FFF', fontSize: 19, fontWeight: '800' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  onlineDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  metaText: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginRight: 5 },
  cardUnlinkBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#0F1114', justifyContent: 'center', alignItems: 'center' },
  statsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', borderRadius: 16, marginTop: 14, paddingVertical: 10 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  statValue: { color: '#FFF', fontSize: 17, fontWeight: '800', marginLeft: 6, fontVariant: ['tabular-nums'] },
  statUnit: { color: '#6B7280', fontSize: 11, fontWeight: '700', marginLeft: 3 },
  statDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.08)' },

  alarmSetupCard: { backgroundColor: '#17191E', borderRadius: 20, padding: 16, marginTop: 14, borderWidth: 1, borderColor: 'rgba(224,70,68,0.25)' },
  alarmSetupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  alarmSetupIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(224,70,68,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  alarmSetupTitle: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  alarmSetupText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', lineHeight: 17, marginTop: 2 },
  alarmSetupBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, marginTop: 8 },
  alarmSetupBtnText: { color: '#E5E7EB', fontSize: 13.5, fontWeight: '700', flex: 1 },
  bottomAddCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#17191E', borderRadius: 20, paddingVertical: 16, marginTop: 4 },
  bottomAddCardText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600', marginLeft: 8 }
});
