import React, { useState, useEffect } from 'react';
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
              onPress={() => navigation.navigate('FamilyDashboard', { patientId: item.patientId || item.id })}
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
        </ScrollView>
      )}
    </View>
  );
}

function PatientListItem({ item, db, onPress, onRemove }) {
  const patientId = item.patientId || item.id;
  const [patientData, setPatientData] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [alerta, setAlerta] = useState(null);

  useEffect(() => {
    const unsubDoc = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) setPatientData(docSnap.data());
    });

    const unsubVitals = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) setVitals(docSnap.data());
    });

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
  const avatar = patientData?.avatar || 'account';
  const vinculo = item.vinculo || 'Familiar';
  const edad = patientData?.edad;
  const tipoSangre = patientData?.tipoSangre;
  const isOnline = vitals && vitals.bpm && vitals.bpm !== '--';

  return (
    <Animatable.View animation="fadeInUp" duration={400}>
      <TouchableOpacity 
        style={[styles.patientCard, alerta && styles.patientCardAlert]} 
        onPress={onPress}
        onLongPress={() => onRemove(nombreCompleto)}
        activeOpacity={0.8}
      >
        {/* Left: Avatar */}
        <View style={styles.avatarCircle}>
          {patientData?.foto ? (
            <Image source={{ uri: patientData.foto }} style={styles.avatarImg} />
          ) : (
            <MaterialCommunityIcons name={avatar} size={34} color="#374151" />
          )}
        </View>

        {/* Center: Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.vinculoLabel}>{vinculo.toUpperCase()}</Text>
          <View style={styles.nameRow}>
            <Text style={styles.patientName} numberOfLines={1}>{nombreCompleto}</Text>
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#43C667' : '#6B7280' }]} />
          </View>
          
          {(edad || tipoSangre) ? (
            <View style={styles.badgeRow}>
              {edad ? <Text style={styles.metaText}>{edad} años</Text> : null}
              {tipoSangre ? <Text style={styles.metaText}>{edad ? '• ' : ''}Grupo {tipoSangre}</Text> : null}
            </View>
          ) : null}
        </View>

        {/* Right: Live Status Pill & Actions */}
        <View style={styles.statusCol}>
          {alerta ? (
            <Animatable.View animation="flash" iterationCount="infinite" duration={1000} style={styles.alertPill}>
              <MaterialCommunityIcons name="alert-octagon" size={14} color="#FFF" style={{ marginRight: 4 }} />
              <Text style={styles.alertPillText}>CAÍDA</Text>
            </Animatable.View>
          ) : isOnline ? (
            <View style={styles.vitalsPill}>
              <Animatable.View animation="pulse" iterationCount="infinite" duration={1200}>
                <MaterialCommunityIcons name="cards-heart" size={15} color="#E04644" style={{ marginRight: 5 }} />
              </Animatable.View>
              <Text style={styles.vitalsPillText}>{vitals.bpm} LPM</Text>
            </View>
          ) : (
            <View style={styles.waitingPill}>
              <Text style={styles.waitingPillText}>EN ESPERA</Text>
            </View>
          )}
          
          <View style={styles.cardActionsRow}>
            <TouchableOpacity 
              style={styles.cardUnlinkBtn} 
              onPress={() => onRemove(nombreCompleto)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="link-off" size={16} color="#9CA3AF" />
            </TouchableOpacity>
            <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
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
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },
  headerCenter: { alignItems: 'center' },
  headerCategory: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 2 },
  headerTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E04644', justifyContent: 'center', alignItems: 'center' },

  // Empty State
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center', marginBottom: 22 },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { color: '#9CA3AF', fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  firstAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E04644', paddingVertical: 16, paddingHorizontal: 26, borderRadius: 20 },
  firstAddBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  // List
  listContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 50 },
  patientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252A', borderRadius: 22, padding: 18, marginBottom: 14 },
  patientCardAlert: { backgroundColor: '#3B1819', borderWidth: 1.5, borderColor: '#E04644' },
  avatarCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  cardInfo: { flex: 1, marginLeft: 14, marginRight: 8 },
  vinculoLabel: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  patientName: { color: '#FFF', fontSize: 19, fontWeight: '700', flexShrink: 1 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 7, marginTop: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  metaText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', marginRight: 6 },

  statusCol: { alignItems: 'flex-end', justifyContent: 'space-between', height: 50 },
  vitalsPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181A1F', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  vitalsPillText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  alertPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E04644', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  alertPillText: { color: '#FFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  waitingPill: { backgroundColor: '#181A1F', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  waitingPillText: { color: '#9CA3AF', fontSize: 11, fontWeight: '600' },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  cardUnlinkBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#181A1F', justifyContent: 'center', alignItems: 'center', marginRight: 6 },

  bottomAddCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252A', borderRadius: 20, paddingVertical: 16, marginTop: 4 },
  bottomAddCardText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600', marginLeft: 8 }
});
