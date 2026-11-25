import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Image, TouchableOpacity, Linking, Pressable, Dimensions, Vibration } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../constants/theme';
import { formatearDuracion, infoTipoAlerta } from '../constants/alertas';

const { width: W, height: H } = Dimensions.get('window');
const DIAGONAL = Math.sqrt(W * W + H * H);
const ORIGEN_Y = H * 0.3; // la "onda" de la transición nace a la altura del ícono

/**
 * Fondo de emergencia. Al activarse, una onda roja se expande desde el ícono
 * hasta cubrir toda la pantalla; después queda un resplandor que respira lento.
 */
export function EmergencyBackdrop({ visible }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      reveal.setValue(0);
      flash.setValue(0);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(reveal, { toValue: 1, duration: 750, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 140, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ]).start();
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(fade, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    return undefined;
  }, [visible]);

  const tam = DIAGONAL * 2.1;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade, overflow: 'hidden' }]}>
      <Animated.View
        style={{
          position: 'absolute',
          width: tam,
          height: tam,
          borderRadius: tam / 2,
          left: W / 2 - tam / 2,
          top: ORIGEN_Y - tam / 2,
          backgroundColor: colors.emergencyDeep,
          transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.01, 1] }) }],
        }}
      />
      {/* Resplandor superior que respira */}
      <Animated.View
        style={[styles.glow, {
          opacity: Animated.multiply(reveal, glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] })),
          transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.08] }) }],
        }]}
      />
      <View style={styles.bottomShade} />
      {/* Destello blanco breve al entrar */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFF', opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) }]} />
    </Animated.View>
  );
}

// Cronómetro "hace mm:ss" que se actualiza cada segundo
export function useElapsed(inicioMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!inicioMs) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [inicioMs]);
  return inicioMs ? Math.max(0, now - inicioMs) : 0;
}

// Píldora "● EMERGENCIA ACTIVA · 01:23"
export function EmergencyStatusPill({ inicioMs }) {
  const elapsed = useElapsed(inicioMs);
  const blink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.statusPill}>
      <Animated.View style={[styles.statusDot, { opacity: blink.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
      <Text style={styles.statusText}>EMERGENCIA ACTIVA</Text>
      <View style={styles.statusSep} />
      <Text style={styles.statusTimer}>{formatearDuracion(elapsed)}</Text>
    </View>
  );
}

// Ícono central con anillos, título y subtítulo
export function EmergencyHero({ tipo, subtitulo, compact = false }) {
  const info = infoTipoAlerta(tipo);
  const waves = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  const beat = useRef(new Animated.Value(0)).current;
  const size = compact ? 96 : 124;

  useEffect(() => {
    const loops = waves.map((w, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 650),
          Animated.timing(w, { toValue: 1, duration: 1950, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(w, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    const beatLoop = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0.6, duration: 140, useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: 400, useNativeDriver: true }),
      Animated.delay(500),
    ]));
    loops.forEach((l) => l.start());
    beatLoop.start();
    return () => { loops.forEach((l) => l.stop()); beatLoop.stop(); };
  }, []);

  return (
    <View style={styles.heroWrap}>
      <View style={{ width: size * 2.1, height: size * 2.1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={[styles.staticRing, { width: size * 1.75, height: size * 1.75, borderRadius: size }]} />
        <View style={[styles.staticRing, { width: size * 1.38, height: size * 1.38, borderRadius: size, borderColor: 'rgba(255,255,255,0.14)' }]} />
        {waves.map((w, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: '#FFF',
              opacity: w.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] }),
              transform: [{ scale: w.interpolate({ inputRange: [0, 1], outputRange: [1, 2.05] }) }],
            }}
          />
        ))}
        <Animated.View style={[styles.heroIconCircle, {
          width: size, height: size, borderRadius: size / 2,
          transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }],
        }]}>
          <MaterialCommunityIcons name={info.icono} size={size * 0.52} color={colors.emergency} />
        </Animated.View>
      </View>

      <Text style={[styles.heroTitle, compact && { fontSize: 30 }]}>{info.tituloLargo}</Text>
      {subtitulo ? <Text style={styles.heroSubtitle}>{subtitulo}</Text> : null}
    </View>
  );
}

// Fila de signos vitales en tarjetas translúcidas
export function EmergencyVitals({ items }) {
  return (
    <View style={styles.tilesRow}>
      {items.map((it) => (
        <View key={it.label} style={styles.tile}>
          <MaterialCommunityIcons name={it.icon} size={18} color="rgba(255,255,255,0.85)" />
          <View style={styles.tileValueRow}>
            <Text style={styles.tileValue}>{it.value}</Text>
            <Text style={styles.tileUnit}>{it.unit}</Text>
          </View>
          <Text style={styles.tileLabel}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Botón de "mantener presionado": evita cancelar la alerta por un toque accidental.
 * Se llena mientras se presiona; si se suelta antes, vuelve a cero.
 */
export function HoldToConfirm({ label, holdingLabel = 'Seguí presionando...', icon = 'gesture-tap-hold', onConfirm, durationMs = 1500, disabled }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const animRef = useRef(null);

  const empezar = () => {
    if (disabled) return;
    setHolding(true);
    try { Vibration.vibrate(20); } catch (e) {}
    progress.stopAnimation((actual) => {
      animRef.current = Animated.timing(progress, { toValue: 1, duration: durationMs * (1 - actual), easing: Easing.linear, useNativeDriver: false });
      animRef.current.start(({ finished }) => {
        if (!finished) return;
        try { Vibration.vibrate([0, 40, 60, 40]); } catch (e) {}
        setHolding(false);
        progress.setValue(0);
        onConfirm && onConfirm();
      });
    });
  };
  const soltar = () => {
    setHolding(false);
    if (animRef.current) animRef.current.stop();
    Animated.timing(progress, { toValue: 0, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  };

  return (
    <Pressable onPressIn={empezar} onPressOut={soltar} disabled={disabled} style={[styles.hold, disabled && { opacity: 0.6 }]}>
      <Animated.View style={[styles.holdFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      <MaterialCommunityIcons name={holding ? 'check-circle-outline' : icon} size={22} color={colors.emergency} style={{ marginRight: 10 }} />
      <Text style={styles.holdText}>{holding ? holdingLabel : label}</Text>
    </Pressable>
  );
}

// Botón grande para acciones de emergencia
export function EmergencyButton({ icon, label, onPress, variant = 'solid', disabled }) {
  const solid = variant === 'solid';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[styles.btn, solid ? styles.btnSolid : styles.btnGhost, disabled && { opacity: 0.6 }]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={solid ? colors.emergency : '#FFF'} style={{ marginRight: 10 }} />
      <Text style={[styles.btnText, { color: solid ? colors.emergency : '#FFF' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Mapa de la ubicación del paciente que entra con una transición al empezar la emergencia
export function EmergencyMap({ visible, lat, lng, delay = 250 }) {
  const anim = useRef(new Animated.Value(0)).current;
  const pin = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 650 : 300,
      delay: visible ? delay : 0,
      easing: visible ? Easing.out(Easing.back(1.1)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !visible) setMounted(false); });
  }, [visible]);

  useEffect(() => {
    if (!mounted) return undefined;
    const loop = Animated.loop(
      Animated.timing(pin, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => { loop.stop(); pin.setValue(0); };
  }, [mounted]);

  if (!mounted) return null;

  const hasCoords = !!(lat && lng);
  const mapUrl = hasCoords
    ? `https://static-maps.yandex.ru/1.x/?lang=es_ES&ll=${lng},${lat}&z=16&l=map&size=600,320`
    : null;

  return (
    <Animated.View
      style={[styles.mapCard, {
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) },
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
      }]}
    >
      <View style={styles.mapHeader}>
        <View style={styles.mapHeaderIcon}>
          <MaterialCommunityIcons name="map-marker-alert" size={18} color={colors.emergency} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mapTitle}>Ubicación del paciente</Text>
          <Text style={styles.mapSubtitle}>{hasCoords ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : 'Esperando señal GPS del teléfono...'}</Text>
        </View>
      </View>

      {hasCoords ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)}>
          <View style={styles.mapImageWrap}>
            <Image source={{ uri: mapUrl }} style={styles.mapImage} resizeMode="cover" />
            <View style={styles.pinCenter} pointerEvents="none">
              <Animated.View style={[styles.pinWave, {
                opacity: pin.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
                transform: [{ scale: pin.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] }) }],
              }]} />
              <View style={styles.pinDot} />
            </View>
          </View>
          <View style={styles.mapCta}>
            <MaterialCommunityIcons name="navigation-variant" size={18} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.mapCtaText}>Cómo llegar con Google Maps</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[styles.mapImageWrap, { alignItems: 'center', justifyContent: 'center' }]}>
          <MaterialCommunityIcons name="crosshairs-question" size={42} color={colors.textFaint} />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', width: W * 1.5, height: W * 1.5, borderRadius: W * 0.75, left: -W * 0.25, top: ORIGEN_Y - W * 0.75, backgroundColor: colors.emergency },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: H * 0.45, backgroundColor: 'rgba(0,0,0,0.28)' },

  statusPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 14, height: 36, borderRadius: radius.pill },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF', marginRight: 8 },
  statusText: { color: '#FFF', fontSize: 11.5, fontWeight: '900', letterSpacing: 1.2 },
  statusSep: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.35)', marginHorizontal: 10 },
  statusTimer: { color: '#FFF', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },

  heroWrap: { alignItems: 'center', paddingHorizontal: 20 },
  staticRing: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  heroIconCircle: { backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', ...shadow },
  heroTitle: { color: '#FFF', fontSize: 36, fontWeight: '900', textAlign: 'center', letterSpacing: -0.5 },
  heroSubtitle: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '600', textAlign: 'center', marginTop: 8, lineHeight: 21, maxWidth: 300 },

  tilesRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  tile: { flex: 1, maxWidth: 120, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 12 },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  tileValue: { color: '#FFF', fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tileUnit: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginLeft: 3 },
  tileLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700', marginTop: 2, letterSpacing: 0.3 },

  hold: { height: 62, borderRadius: radius.pill, backgroundColor: '#FFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadow },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#C9F2D6' },
  holdText: { color: colors.emergency, fontSize: 16, fontWeight: '900', letterSpacing: 0.2 },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 58, borderRadius: radius.md, marginTop: 12 },
  btnSolid: { backgroundColor: '#FFF', ...shadow },
  btnGhost: { backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)' },
  btnText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  mapCard: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)', ...shadow },
  mapHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  mapHeaderIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  mapTitle: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  mapSubtitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 1, fontVariant: ['tabular-nums'] },
  mapImageWrap: { height: 200, backgroundColor: colors.surfaceAlt },
  mapImage: { width: '100%', height: '100%' },
  pinCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pinWave: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.emergencyBright },
  pinDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.emergency, borderWidth: 3, borderColor: '#FFF' },
  mapCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: colors.emergency },
  mapCtaText: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
});
