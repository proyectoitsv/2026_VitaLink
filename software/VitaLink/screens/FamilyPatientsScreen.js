import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  StatusBar, 
  ActivityIndicator, 
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

export default function FamilyPatientsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    signInAnonymously(auth);
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
      <StatusBar barStyle="light-content" backgroundColor="#050505" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.navigate('RoleSelection')}
        >
          <MaterialCommunityIcons name="chevron-left" size={32} color="#FFF" />
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
          <ActivityIndicator size="large" color="#FF2D55" />
        </View>
      ) : patients.length === 0 ? (
        <Animatable.View animation="fadeInUp" style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <MaterialCommunityIcons name="account-multiple-plus-outline" size={56} color="#FF2D55" />
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
              onPress={() => navigation.navigate('FamilyDashboard', { patientId: item.patientId || item.id })}
              onRemove={(name) => handleRemovePatient(item.patientId || item.id, name)}
            />
          ))}

          {/* Quick link to add another */}
          <TouchableOpacity 
            style={styles.bottomAddCard} 
            onPress={() => navigation.navigate('FamilyLogin')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={22} color="#8E8E93" />
            <Text style={styles.bottomAddCardText}>Vincular a otro paciente</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

// Subcomponent that listens to live vitals and profile for each individual patient card
function PatientListItem({ item, db, onPress, onRemove }) {
  const patientId = item.patientId || item.id;
  const [patientData, setPatientData] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [alerta, setAlerta] = useState(null);

  useEffect(() => {
    // 1. Escuchar perfil del paciente (nombre, apellido, avatar, ficha)
    const unsubDoc = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) setPatientData(docSnap.data());
    });

    // 2. Escuchar signos vitales live
    const unsubVitals = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) setVitals(docSnap.data());
    });

    // 3. Escuchar alertas recientes
    const qAlertas = query(collection(db, 'pacientes', patientId, 'alertas_criticas'), orderBy('timestamp', 'desc'), limit(1));
    const unsubAlertas = onSnapshot(qAlertas, (snap) => {
      if (!snap.empty) {
        const al = snap.docs[0].data();
        setAlerta(al);
      }
    });

    return () => { unsubDoc(); unsubVitals(); unsubAlertas(); };
  }, [patientId]);

  const nombreCompleto = patientData 
    ? [patientData.nombre, patientData.apellido].filter(Boolean).join(' ')
    : (item.nombre || `Paciente ${patientId}`);
  const avatar = patientData?.avatar || 'account-circle';
  const vinculo = item.vinculo || 'Familiar';
  const edad = patientData?.edad;
  const tipoSangre = patientData?.tipoSangre;

  return (
    <Animatable.View animation="fadeInUp" duration={400}>
      <TouchableOpacity 
        style={[styles.patientCard, alerta && styles.patientCardAlert]} 
        onPress={onPress}
        onLongPress={() => onRemove(nombreCompleto)}
        activeOpacity={0.8}
      >
        {/* Left: Avatar */}
        <View style={[styles.avatarCircle, alerta && { borderColor: '#FFF' }]}>
          <MaterialCommunityIcons name={avatar} size={36} color={alerta ? "#FFF" : "#FF2D55"} />
        </View>

        {/* Center: Info */}
        <View style={styles.cardInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.patientName} numberOfLines={1}>{nombreCompleto}</Text>
          </View>
          
          <View style={styles.badgeRow}>
            <View style={styles.vinculoBadge}>
              <Text style={styles.vinculoBadgeText}>{vinculo.toUpperCase()}</Text>
            </View>
            {edad && (
              <Text style={styles.metaText}>{edad} años</Text>
            )}
            {tipoSangre && (
              <Text style={styles.metaText}>• {tipoSangre}</Text>
            )}
          </View>
        </View>

        {/* Right: Live Status Pill & Actions */}
        <View style={styles.statusCol}>
          {alerta ? (
            <Animatable.View animation="flash" iterationCount="infinite" duration={1000} style={styles.alertPill}>
              <MaterialCommunityIcons name="alert-octagon" size={14} color="#FFF" style={{ marginRight: 4 }} />
              <Text style={styles.alertPillText}>CAÍDA</Text>
            </Animatable.View>
          ) : vitals && vitals.bpm && vitals.bpm !== '--' ? (
            <View style={styles.vitalsPill}>
              <MaterialCommunityIcons name="heart-pulse" size={16} color="#FF2D55" style={{ marginRight: 4 }} />
              <Text style={styles.vitalsPillText}>{vitals.bpm} BPM</Text>
            </View>
          ) : (
            <View style={styles.waitingPill}>
              <Text style={styles.waitingPillText}>STANDBY</Text>
            </View>
          )}
          
          <View style={styles.cardActionsRow}>
            <TouchableOpacity 
              style={styles.cardUnlinkBtn} 
              onPress={() => onRemove(nombreCompleto)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="link-off" size={17} color="#8E8E93" />
            </TouchableOpacity>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#555" />
          </View>
        </View>

      </TouchableOpacity>
    </Animatable.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 55, paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { alignItems: 'center' },
  headerCategory: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 2 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FF2D55', justifyContent: 'center', alignItems: 'center', shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },

  // Empty State
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,45,85,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(255,45,85,0.2)' },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  emptySubtitle: { color: '#8E8E93', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  firstAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF2D55', paddingVertical: 16, paddingHorizontal: 28, borderRadius: 16, shadowColor: '#FF2D55', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 },
  firstAddBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

  // List
  listContent: { padding: 20, paddingBottom: 50 },
  patientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121212', borderRadius: 24, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  patientCardAlert: { backgroundColor: '#380B13', borderColor: '#FF2D55' },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)' },
  cardInfo: { flex: 1, marginLeft: 16, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  patientName: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  vinculoBadge: { backgroundColor: 'rgba(255,45,85,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 8 },
  vinculoBadgeText: { color: '#FF2D55', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  metaText: { color: '#8E8E93', fontSize: 12, marginRight: 6 },

  statusCol: { alignItems: 'flex-end', justifyContent: 'space-between', height: 48 },
  vitalsPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,45,85,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,45,85,0.25)' },
  vitalsPillText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  alertPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF2D55', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  alertPillText: { color: '#FFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  waitingPill: { backgroundColor: '#1E1E1E', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  waitingPillText: { color: '#777', fontSize: 11, fontWeight: '700' },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  cardUnlinkBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center', marginRight: 6 },

  bottomAddCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0D0D0D', borderRadius: 18, paddingVertical: 16, marginTop: 8, borderWidth: 1, borderColor: '#222', borderStyle: 'dashed' },
  bottomAddCardText: { color: '#8E8E93', fontSize: 14, fontWeight: '600', marginLeft: 8 }
});
