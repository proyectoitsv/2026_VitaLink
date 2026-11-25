import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Vibration } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { colors, radius } from '../constants/theme';
import { describirFamiliar, inicialesFamiliar } from '../constants/alertas';

const MAX_FILAS = 3;

const useAhora = (intervaloMs = 1000) => {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return ahora;
};

const haceCuanto = (ms, ahora) => {
  const seg = Math.max(0, Math.round((ahora - ms) / 1000));
  if (seg < 5) return 'recién';
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.floor(seg / 60);
  return `hace ${min} min`;
};

// Campana que se balancea mientras se espera que alguien vea la alerta
function CampanaEsperando() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(v, { toValue: -1, duration: 220, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.6, duration: 180, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.delay(1100),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }] }}>
      <MaterialCommunityIcons name="bell-ring-outline" size={20} color="#FFF" />
    </Animated.View>
  );
}

// Tres puntitos que se encienden en secuencia ("avisando...")
function PuntosEnviando() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ flexDirection: 'row', marginLeft: 4 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[styles.punto, { opacity: v.interpolate({ inputRange: [i, i + 0.5, i + 1, 3], outputRange: [0.25, 1, 0.25, 0.25], extrapolate: 'clamp' }) }]}
        />
      ))}
    </View>
  );
}

function Avatar({ vista, destacado }) {
  const iniciales = inicialesFamiliar(vista);
  return (
    <View style={styles.avatarWrap}>
      <View style={[styles.avatar, destacado && styles.avatarDestacado]}>
        {iniciales
          ? <Text style={styles.avatarText}>{iniciales}</Text>
          : <MaterialCommunityIcons name="account" size={20} color={colors.emergency} />}
      </View>
      <Animatable.View animation="zoomIn" delay={250} duration={400} style={styles.check}>
        <MaterialCommunityIcons name="check-bold" size={10} color="#FFF" />
      </Animatable.View>
    </View>
  );
}

/**
 * Tarjeta del paciente durante la emergencia: muestra en tiempo real
 * qué familiares ya abrieron la alerta. Mientras nadie la vio, indica que se está avisando.
 */
export default function VistoPorFamilia({ vistas = [] }) {
  const ahora = useAhora(1000);
  const cantidadPrevia = useRef(vistas.length);
  const ripple = useRef(new Animated.Value(0)).current;
  const [ultimoUid, setUltimoUid] = useState(null);

  // Cuando llega un familiar nuevo: vibración corta y un destello verde en la tarjeta
  useEffect(() => {
    if (vistas.length > cantidadPrevia.current) {
      setUltimoUid(vistas[vistas.length - 1].uid);
      try { Vibration.vibrate([0, 60, 90, 60]); } catch (e) {}
      ripple.setValue(0);
      Animated.timing(ripple, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    cantidadPrevia.current = vistas.length;
  }, [vistas.length]);

  const algunoVio = vistas.length > 0;
  // Los más recientes primero en la lista
  const filas = [...vistas].reverse().slice(0, MAX_FILAS);
  const restantes = vistas.length - filas.length;

  return (
    <View style={[styles.card, algunoVio && styles.cardVisto]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.ripple, {
          opacity: ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
        }]}
      />

      {!algunoVio ? (
        <View style={styles.headerRow}>
          <CampanaEsperando />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.titulo}>Avisando a tu familia</Text>
              <PuntosEnviando />
            </View>
            <Text style={styles.subtitulo}>Te mostramos acá cuando la vean</Text>
          </View>
        </View>
      ) : (
        <>
          <Animatable.View key="visto-header" animation="fadeIn" duration={400} style={styles.headerRow}>
            <View style={styles.okCircle}>
              <MaterialCommunityIcons name="check-all" size={18} color="#FFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.titulo}>{vistas.length === 1 ? 'Tu familia ya la vio' : `${vistas.length} familiares ya la vieron`}</Text>
              <Text style={styles.subtitulo}>Saben que necesitás ayuda</Text>
            </View>
          </Animatable.View>

          <View style={styles.lista}>
            {filas.map((v) => {
              const { titulo, detalle } = describirFamiliar(v);
              const nuevo = v.uid === ultimoUid;
              return (
                <Animatable.View key={v.uid} animation="fadeInUp" duration={450} style={styles.fila}>
                  <Avatar vista={v} destacado={nuevo} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.nombre} numberOfLines={1}>
                      {titulo}{detalle ? <Text style={styles.vinculo}>{`  ·  ${detalle}`}</Text> : null}
                    </Text>
                    <Text style={styles.accion}>Vio tu alerta</Text>
                  </View>
                  <Text style={styles.tiempo}>{haceCuanto(v.ms, ahora)}</Text>
                </Animatable.View>
              );
            })}
            {restantes > 0 ? <Text style={styles.mas}>y {restantes} más</Text> : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: radius.lg, padding: 14, overflow: 'hidden' },
  cardVisto: { backgroundColor: 'rgba(16,60,32,0.35)', borderColor: 'rgba(67,198,103,0.55)' },
  ripple: { backgroundColor: colors.ok, borderRadius: radius.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  titulo: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  subtitulo: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', marginTop: 1 },
  punto: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFF', marginLeft: 3, marginTop: 4 },
  okCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' },
  lista: { marginTop: 10 },
  fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  avatarWrap: { width: 36, height: 36 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  avatarDestacado: { borderWidth: 2, borderColor: colors.ok },
  avatarText: { color: colors.emergency, fontSize: 13, fontWeight: '900' },
  check: { position: 'absolute', right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.ok, borderWidth: 2, borderColor: '#3A0A0D', alignItems: 'center', justifyContent: 'center' },
  nombre: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  vinculo: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },
  accion: { color: 'rgba(255,255,255,0.65)', fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  tiempo: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'], marginLeft: 8 },
  mas: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' },
});
