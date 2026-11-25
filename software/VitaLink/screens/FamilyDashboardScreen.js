import React, { useState, useEffect, useRef } from 'react';
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
  Alert,
  Vibration,
  AppState,
} from 'react-native';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  deleteDoc,
  getDoc,
} from '@react-native-firebase/firestore';
import { getAuth } from '@react-native-firebase/auth';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { colors, radius } from '../constants/theme';
import { useAlertaActiva, cancelarAlerta, ALERTA_DURACION_MAX_MS, marcarAlertaVista, listaVistas } from '../constants/alertas';
import VitalsPanel, { mostrarValor } from '../components/VitalsPanel';
import { EmergencyBackdrop, EmergencyHero, EmergencyStatusPill, EmergencyVitals, HoldToConfirm, EmergencyMap, useElapsed } from '../components/EmergencyVisuals';
import { setPacienteEnPantalla } from '../services/monitorFamilia';
import { cancelarNotificacionEmergencia } from '../services/notificaciones';
import AvatarVolador from '../components/AvatarVolador';
import { iniciarSirena, detenerSirena } from '../services/sirena';

// Si el teléfono del paciente no sube datos en este tiempo, se considera fuera de línea
const DATOS_VIGENTES_MS = 25000;

export default function FamilyDashboardScreen({ navigation, route }) {
  const { patientId } = route.params;
  const db = getFirestore();
  const [signos, setSignos] = useState(null);
  const [patientData, setPatientData] = useState(null);
  const [alerta] = useAlertaActiva(db, patientId);
  const [cancelando, setCancelando] = useState(false);
  const [silenciado, setSilenciado] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsubPaciente = onSnapshot(doc(db, 'pacientes', patientId), (docSnap) => {
      if (docSnap.exists()) setPatientData(docSnap.data());
    });

    let unsubFallback = () => {};
    const unsubSignos = onSnapshot(doc(db, 'pacientes', patientId, 'signos_actuales', 'live'), (docSnap) => {
      if (docSnap.exists()) {
        setSignos(docSnap.data());
      } else {
        unsubFallback();
        const qFallback = query(collection(db, 'pacientes', patientId, 'historial_signos'), orderBy('timestamp', 'desc'), limit(1));
        unsubFallback = onSnapshot(qFallback, (snapshot) => {
          if (!snapshot.empty) setSignos(snapshot.docs[0].data());
          else setSignos({ bpm: '--', spo2: '--', bateria: '--', timestamp: null });
        });
      }
    });

    const tick = setInterval(() => setNow(Date.now()), 5000);

    return () => {
      clearInterval(tick);
      unsubPaciente();
      unsubSignos();
      unsubFallback();
    };
  }, [patientId]);

  // Mientras el familiar mira este panel, la alarma se muestra acá y no como notificación
  useEffect(() => {
    setPacienteEnPantalla(patientId);
    return () => setPacienteEnPantalla(null);
  }, [patientId]);

  useEffect(() => {
    if (alerta?.id) cancelarNotificacionEmergencia(alerta.id);
  }, [alerta?.id]);

  // Sirena + vibración mientras dure la emergencia (el botón de arriba las silencia)
  useEffect(() => {
    if (!alerta || silenciado) {
      Vibration.cancel();
      detenerSirena();
      return undefined;
    }
    try { Vibration.vibrate([0, 700, 500, 700, 1500], true); } catch (e) {}
    iniciarSirena();
    return () => { Vibration.cancel(); detenerSirena(); };
  }, [alerta?.id, silenciado]);

  useEffect(() => { setSilenciado(false); }, [alerta?.id]);

  // ---- Transición compartida: el avatar llega volando desde la tarjeta de la lista ----
  const origen = route.params?.origen || null;
  const [vuelo, setVuelo] = useState(origen ? { destino: null } : null);
  const headerAvatarRef = useRef(null);

  const medirDestinoVuelo = () => {
    if (!headerAvatarRef.current) return;
    headerAvatarRef.current.measureInWindow((x, y, w) => {
      setVuelo((v) => {
        if (!v || v.destino) return v;
        return w ? { destino: { x, y, size: w } } : null;
      });
    });
  };

  useEffect(() => {
    if (!vuelo) return undefined;
    // En modo emergencia no hay avatar en el encabezado: no hay a dónde volar
    if (alerta) { setVuelo(null); return undefined; }
    const seguridad = setTimeout(() => setVuelo(null), 1800);
    return () => clearTimeout(seguridad);
  }, [!!vuelo, !!alerta]);

  // ---- "Visto por": avisarle al paciente que este familiar abrió la alerta ----
  const yoRef = useRef(null); // { uid, nombre, vinculo }
  const vistasMarcadasRef = useRef(new Set());
  const [vistaConfirmada, setVistaConfirmada] = useState(false);

  useEffect(() => {
    const u = getAuth().currentUser;
    if (!u) return;
    const uid = u.uid.substring(0, 8);
    Promise.all([
      getDoc(doc(db, 'familiares', uid)).catch(() => null),
      getDoc(doc(db, 'familiares', uid, 'pacientes', patientId)).catch(() => null),
    ]).then(([yo, enlace]) => {
      yoRef.current = {
        uid,
        nombre: yo?.exists() ? (yo.data().nombre || '') : '',
        vinculo: enlace?.exists() ? (enlace.data().vinculo || '') : '',
      };
      marcarVistaSiCorresponde();
    });
  }, [patientId]);

  const alertaRef = useRef(null);
  alertaRef.current = alerta;

  // Solo cuenta como "vista" si la pantalla está en uso de verdad (app abierta y panel enfocado)
  const marcarVistaSiCorresponde = () => {
    const al = alertaRef.current;
    if (!al || !yoRef.current) return;
    if (AppState.currentState !== 'active' || !navigation.isFocused()) return;
    if (vistasMarcadasRef.current.has(al.id)) return;
    vistasMarcadasRef.current.add(al.id);
    marcarAlertaVista(al, yoRef.current)
      .then(() => setVistaConfirmada(true))
      .catch(() => vistasMarcadasRef.current.delete(al.id));
  };

  useEffect(() => {
    setVistaConfirmada(false);
    marcarVistaSiCorresponde();
  }, [alerta?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') marcarVistaSiCorresponde(); });
    const unsubFocus = navigation.addListener('focus', marcarVistaSiCorresponde);
    return () => { sub.remove(); unsubFocus(); };
  }, []);

  const otrosQueLaVieron = listaVistas(alerta).filter((v) => v.uid !== yoRef.current?.uid);

  const firstName = patientData?.nombre ? patientData.nombre.trim().split(' ')[0] : '';
  const displayName = firstName || `Paciente ${patientId}`;
  const avatar = patientData?.avatar || 'account';

  const tsMillis = signos?.timestamp?.toMillis ? signos.timestamp.toMillis() : 0;
  const isLive = !!tsMillis && now - tsMillis < DATOS_VIGENTES_MS && signos?.bpm && signos.bpm !== '--';
  const estadoSensor = !isLive
    ? 'esperando'
    : signos.estadoSensor || (String(signos.bpm) === '0' ? 'sin_muneca' : String(signos.bpm) === '-1' ? 'calibrando' : 'midiendo');

  // Durante la emergencia se usa la ubicación más reciente disponible
  const lat = signos?.ubicacion?.latitude || alerta?.ubicacion?.latitude;
  const lng = signos?.ubicacion?.longitude || alerta?.ubicacion?.longitude;
  const tsUbicacion = signos?.ubicacionTs?.toMillis ? signos.ubicacionTs.toMillis() : tsMillis;

  const elapsed = useElapsed(alerta?.inicioMs);
  const minutosRestantes = alerta ? Math.max(1, Math.ceil((ALERTA_DURACION_MAX_MS - elapsed) / 60000)) : 0;

  const formatTime = (ts) => {
    if (!ts?.toDate) return '...';
    try {
      return new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(ts.toDate());
    } catch (e) {
      return ts.toDate().toLocaleTimeString();
    }
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
            const u = getAuth().currentUser;
            if (u) await deleteDoc(doc(db, 'familiares', u.uid.substring(0, 8), 'pacientes', patientId));
            navigation.navigate('FamilyPatients');
          },
        },
      ]
    );
  };

  // El botón de "mantener presionado" ya funciona como confirmación
  const handleCancelarAlerta = async () => {
    setCancelando(true);
    try {
      await cancelarAlerta(alerta, 'familiar');
    } catch (e) {
      Alert.alert('No se pudo cancelar', 'Revisá tu conexión a internet e intentá de nuevo.');
    } finally {
      setCancelando(false);
    }
  };

  const telefono = patientData?.telefonoEmergencia;

  return (
    <View style={styles.safeArea}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      <EmergencyBackdrop visible={!!alerta} />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Barra superior */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={[styles.navCircleBtn, alerta && styles.navCircleBtnEmergency]}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color="#FFF" />
          </TouchableOpacity>

          {alerta ? (
            <Animatable.View animation="fadeInDown" delay={400} duration={400}>
              <EmergencyStatusPill inicioMs={alerta.inicioMs} />
            </Animatable.View>
          ) : (
            <View style={styles.statusPill}>
              <Animatable.View
                animation={isLive ? 'pulse' : undefined}
                iterationCount="infinite"
                style={[styles.statusDot, { backgroundColor: isLive ? colors.ok : colors.textFaint }]}
              />
              <Text style={[styles.statusPillText, { color: isLive ? colors.ok : colors.textMuted }]}>
                {isLive ? 'EN LÍNEA' : 'SIN CONEXIÓN'}
              </Text>
            </View>
          )}

          {alerta ? (
            <TouchableOpacity
              style={[styles.navCircleBtn, styles.navCircleBtnEmergency]}
              onPress={() => setSilenciado((s) => !s)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name={silenciado ? 'volume-off' : 'volume-high'} size={20} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.navCircleBtn}
              onPress={handleUnlinkPatient}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="link-off" size={20} color={colors.textSoft} />
            </TouchableOpacity>
          )}
        </View>

        {alerta ? (
          /* ======================= MODO EMERGENCIA ======================= */
          <View key={`em-${alerta.id}`} style={styles.emergencyWrap}>
            <Animatable.View animation="zoomIn" delay={250} duration={550} easing="ease-out-back">
              <EmergencyHero compact tipo={alerta.tipo} subtitulo={`${displayName} necesita ayuda ahora`} />
            </Animatable.View>

            <View style={styles.seenRow}>
              {vistaConfirmada ? (
                <Animatable.View animation="bounceIn" duration={600} style={styles.seenPill}>
                  <MaterialCommunityIcons name="check-all" size={16} color={colors.ok} style={{ marginRight: 6 }} />
                  <Text style={styles.seenPillText}>{displayName} ya sabe que la viste</Text>
                </Animatable.View>
              ) : null}
              {otrosQueLaVieron.length > 0 ? (
                <Animatable.View animation="fadeIn" duration={400} style={[styles.seenPill, styles.seenPillOthers]}>
                  <MaterialCommunityIcons name="account-multiple-check" size={16} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={styles.seenPillTextOthers} numberOfLines={1}>
                    También la vio {otrosQueLaVieron.map((v) => v.nombre || v.vinculo || 'otro familiar').join(', ')}
                  </Text>
                </Animatable.View>
              ) : null}
            </View>

            <Animatable.View animation="fadeInUp" delay={520} duration={450} style={{ marginTop: 18 }}>
              <EmergencyVitals items={[
                { icon: 'cards-heart', value: mostrarValor(signos?.bpm), unit: 'LPM', label: 'Pulso' },
                { icon: 'water', value: mostrarValor(signos?.spo2), unit: '%', label: 'Oxígeno' },
                { icon: 'battery', value: mostrarValor(signos?.bateria), unit: '%', label: 'Batería' },
              ]} />
            </Animatable.View>

            <View style={{ marginTop: 18 }}>
              <EmergencyMap visible lat={lat} lng={lng} delay={700} />
            </View>

            <Animatable.View animation="fadeInUp" delay={900} duration={450} style={{ marginTop: 20 }}>
              <HoldToConfirm
                label={cancelando ? 'Cancelando...' : 'Mantené presionado para cancelar'}
                holdingLabel="Cancelando alerta..."
                icon="close-octagon-outline"
                onConfirm={handleCancelarAlerta}
                disabled={cancelando}
              />
              <Text style={styles.autoCancelText}>
                Cancelala cuando {displayName} esté asistido. Si nadie la cancela, se cierra sola en {minutosRestantes} min.
              </Text>
            </Animatable.View>
          </View>
        ) : (
          /* ======================= MODO NORMAL ======================= */
          <Animatable.View key="normal" animation="fadeIn" duration={450}>
            <View style={styles.patientHeaderCard}>
              {/* Mientras el avatar "vuela" desde la lista, el real queda oculto */}
              <View
                ref={headerAvatarRef}
                collapsable={false}
                onLayout={() => requestAnimationFrame(medirDestinoVuelo)}
                style={[styles.avatarCircle, { opacity: vuelo ? 0 : 1 }]}
              >
                {(patientData?.foto || route.params?.foto) ? (
                  <Image source={{ uri: patientData?.foto || route.params?.foto }} style={styles.avatarImg} />
                ) : (
                  <MaterialCommunityIcons name={avatar} size={40} color="#374151" />
                )}
              </View>
              <Animatable.View animation={origen ? 'fadeInRight' : undefined} delay={380} duration={420} style={styles.profileTextGroup}>
                <Text style={styles.headerSubtitle}>MONITOR DEL PACIENTE</Text>
                <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
              </Animatable.View>
            </View>

            {(patientData?.tipoSangre || patientData?.edad || telefono) ? (
              <View style={styles.chipsRow}>
                {patientData?.tipoSangre ? (
                  <View style={styles.chip}>
                    <MaterialCommunityIcons name="water" size={14} color={colors.danger} style={{ marginRight: 5 }} />
                    <Text style={styles.chipText}>Grupo {patientData.tipoSangre}</Text>
                  </View>
                ) : null}
                {patientData?.edad ? (
                  <View style={styles.chip}>
                    <MaterialCommunityIcons name="account-clock-outline" size={14} color={colors.oxygen} style={{ marginRight: 5 }} />
                    <Text style={styles.chipText}>{patientData.edad} años</Text>
                  </View>
                ) : null}
                {telefono ? (
                  <TouchableOpacity style={styles.chip} onPress={() => Linking.openURL(`tel:${telefono}`)} activeOpacity={0.7}>
                    <MaterialCommunityIcons name="phone" size={14} color={colors.ok} style={{ marginRight: 5 }} />
                    <Text style={[styles.chipText, { color: colors.ok }]}>Llamar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {signos ? (
              <View style={styles.content}>
                <VitalsPanel bpm={isLive ? signos.bpm : '--'} spo2={isLive ? signos.spo2 : '--'} bateria={isLive ? signos.bateria : '--'} estado={estadoSensor} />

                <View style={styles.safeCard}>
                  <View style={styles.safeIcon}>
                    <MaterialCommunityIcons name="shield-check" size={20} color={colors.ok} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.safeTitle}>Sin emergencias</Text>
                    <Text style={styles.safeText}>Si la pulsera detecta una caída, esta pantalla cambiará y vas a recibir una alerta.</Text>
                  </View>
                </View>

                <TarjetaUbicacion lat={lat} lng={lng} tsMs={tsUbicacion} now={now} nombre={displayName} />

                <View style={styles.timeFooter}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color={colors.textFaint} style={{ marginRight: 6 }} />
                  <Text style={styles.timeText}>ÚLTIMO DATO: {formatTime(signos.timestamp)}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.centerCard}>
                <ActivityIndicator size="large" color={colors.danger} />
                <Text style={styles.loadingText}>Conectando con el monitor...</Text>
              </View>
            )}
          </Animatable.View>
        )}
      </ScrollView>

      {vuelo && origen ? (
        <AvatarVolador
          origen={origen}
          destino={vuelo.destino}
          foto={route.params?.foto || patientData?.foto}
          icono={route.params?.avatar || avatar}
          onFin={() => setVuelo(null)}
        />
      ) : null}
    </View>
  );
}

// Última ubicación conocida del paciente (también fuera de una emergencia)
function haceCuanto(ms, now) {
  if (!ms) return '';
  const seg = Math.max(0, Math.round((now - ms) / 1000));
  if (seg < 60) return 'hace instantes';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function TarjetaUbicacion({ lat, lng, tsMs, now, nombre }) {
  const hay = !!(lat && lng);
  const [error, setError] = useState(false);
  useEffect(() => { setError(false); }, [lat, lng]);
  const url = hay ? `https://static-maps.yandex.ru/1.x/?lang=es_ES&ll=${lng},${lat}&z=16&l=map&size=600,300` : null;
  return (
    <View style={styles.ubiCard}>
      <View style={styles.ubiHeader}>
        <View style={styles.ubiIcon}>
          <MaterialCommunityIcons name="map-marker-radius" size={18} color={colors.oxygen} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.ubiTitle}>Última ubicación</Text>
          <Text style={styles.ubiSub}>
            {hay ? `${haceCuanto(tsMs, now) || 'actualizada'} · ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : `Esperando la ubicación del celular de ${nombre}...`}
          </Text>
        </View>
      </View>
      {hay ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}>
          <View style={styles.ubiMapa}>
            {!error ? (
              <Image source={{ uri: url }} style={styles.ubiImg} resizeMode="cover" onError={() => setError(true)} />
            ) : (
              <View style={styles.ubiSinMapa}>
                <MaterialCommunityIcons name="map-outline" size={34} color={colors.textFaint} />
                <Text style={styles.ubiSinMapaText}>No se pudo cargar el mapa. Tocá para abrirlo en Google Maps.</Text>
              </View>
            )}
            {!error ? (
              <View style={styles.ubiPin} pointerEvents="none">
                <View style={styles.ubiPinDot} />
              </View>
            ) : null}
          </View>
          <View style={styles.ubiCta}>
            <MaterialCommunityIcons name="navigation-variant" size={16} color={colors.oxygen} style={{ marginRight: 6 }} />
            <Text style={styles.ubiCtaText}>Abrir en Google Maps</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[styles.ubiMapa, styles.ubiSinMapa]}>
          <MaterialCommunityIcons name="crosshairs-question" size={34} color={colors.textFaint} />
          <Text style={styles.ubiSinMapaText}>Aparece cuando el celular del paciente comparte su ubicación.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ubiCard: { backgroundColor: colors.surface, borderRadius: radius.md, marginTop: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  ubiHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  ubiIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.oxygen}1F`, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  ubiTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  ubiSub: { color: colors.textMuted, fontSize: 12, fontWeight: '500', marginTop: 2, fontVariant: ['tabular-nums'] },
  ubiMapa: { height: 170, backgroundColor: colors.surfaceAlt },
  ubiImg: { width: '100%', height: '100%' },
  ubiPin: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ubiPinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, borderWidth: 3, borderColor: '#FFF' },
  ubiSinMapa: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  ubiSinMapaText: { color: colors.textFaint, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  ubiCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  ubiCtaText: { color: colors.oxygen, fontSize: 13, fontWeight: '800' },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { paddingBottom: 40 },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 42, paddingBottom: 14 },
  navCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  navCircleBtnEmergency: { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: 'rgba(255,255,255,0.3)' },

  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, height: 40, borderRadius: 20 },
  statusPillEmergency: { backgroundColor: '#FFF', borderColor: '#FFF' },
  statusDot: { width: 9, height: 9, borderRadius: 4.5, marginRight: 8 },
  statusPillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.7 },

  patientHeaderCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14 },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  profileTextGroup: { flex: 1 },
  headerSubtitle: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, marginBottom: 2 },
  headerName: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: 0.2 },

  chipsRow: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 14, flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  chipText: { color: colors.textSoft, fontSize: 12, fontWeight: '700' },

  content: { paddingHorizontal: 20 },

  safeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginTop: 14, borderWidth: 1, borderColor: colors.border },
  safeIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: `${colors.ok}1F`, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  safeTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  safeText: { color: colors.textMuted, fontSize: 12, fontWeight: '500', lineHeight: 17, marginTop: 2 },

  timeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  timeText: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },

  centerCard: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { marginTop: 14, color: colors.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },

  emergencyWrap: { paddingHorizontal: 20, paddingTop: 4 },
  seenRow: { alignItems: 'center', marginTop: 12, gap: 8 },
  seenPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 14, height: 34, borderRadius: radius.pill, maxWidth: '100%' },
  seenPillText: { color: '#1E7D3C', fontSize: 13, fontWeight: '800' },
  seenPillOthers: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  seenPillTextOthers: { color: '#FFF', fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  autoCancelText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 12 },
});
