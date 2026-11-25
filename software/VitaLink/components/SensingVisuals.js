import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '../constants/theme';

// Valor animado 0 (gris) -> 1 (color) con transición suave entre estados
export function useEncendido(encendido, duracion = 650) {
  const v = useRef(new Animated.Value(encendido ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: encendido ? 1 : 0, duration: duracion, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
  }, [encendido]);
  return v;
}

/**
 * Ícono con anillos.
 * - active: midiendo (anillos que se expanden + latido)
 * - lit: con color (en la pausa entre mediciones queda con color y "respira" despacio)
 * Al pasar a gris lo hace con un fundido, no de golpe.
 */
export function PulseRings({ active, lit = active, color, size = 64, icon, iconSize = 36, beatMs = 900 }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  const beat = useRef(new Animated.Value(0)).current;
  const encendido = useEncendido(lit);
  const reposo = lit && !active;

  useEffect(() => {
    if (!active && !reposo) {
      rings.forEach((r) => r.stopAnimation());
      beat.stopAnimation();
      Animated.timing(beat, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      return undefined;
    }
    if (reposo) {
      // Pausa: respiración lenta y suave, sin anillos
      rings.forEach((r) => { r.stopAnimation(); r.setValue(0); });
      const breath = Animated.loop(Animated.sequence([
        Animated.timing(beat, { toValue: 0.45, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      breath.start();
      return () => breath.stop();
    }
    const ringLoops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(r, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    const beatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: beatMs * 0.15, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0.35, duration: beatMs * 0.15, useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0.8, duration: beatMs * 0.12, useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: beatMs * 0.58, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    ringLoops.forEach((l) => l.start());
    beatLoop.start();
    return () => {
      ringLoops.forEach((l) => l.stop());
      beatLoop.stop();
    };
  }, [active, reposo, beatMs]);

  const iconScale = beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const circulo = { position: 'absolute', width: size, height: size, borderRadius: size / 2 };

  return (
    <View style={{ width: size * 1.9, height: size * 1.9, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            ...circulo,
            borderWidth: 2,
            borderColor: color,
            opacity: active ? r.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] }) : 0,
            transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
          }}
        />
      ))}
      <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ scale: iconScale }] }}>
        {/* Capa gris y capa de color: se funden entre sí */}
        <View style={[circulo, { backgroundColor: colors.surfaceRaised }]} />
        <Animated.View style={[circulo, { backgroundColor: `${color}26`, borderWidth: 1, borderColor: `${color}40`, opacity: encendido }]} />
        <MaterialCommunityIcons name={icon} size={iconSize} color={colors.textFaint} style={{ position: 'absolute' }} />
        <Animated.View style={{ position: 'absolute', opacity: encendido }}>
          <MaterialCommunityIcons name={icon} size={iconSize} color={color} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// Trazo de ECG: se desplaza mientras mide, queda quieto y con color en la pausa, y se apaga en gris
export function EcgSweep({ active, lit = active, width = 150, height = 64, tint = colors.heart }) {
  const x = useRef(new Animated.Value(0)).current;
  const encendido = useEncendido(lit);

  useEffect(() => {
    if (!active) {
      x.stopAnimation();
      return undefined;
    }
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1700, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [0, -width] });
  const trazo = (color) => (
    <Animated.View style={{ flexDirection: 'row', width: width * 2, transform: [{ translateX }] }}>
      <Image source={require('../assets/ecg_wave.png')} style={{ width, height, tintColor: color }} resizeMode="stretch" />
      <Image source={require('../assets/ecg_wave.png')} style={{ width, height, tintColor: color }} resizeMode="stretch" />
    </Animated.View>
  );

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <View style={[StyleSheet.absoluteFill, { opacity: 0.22 }]}>{trazo(colors.textFaint)}</View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(encendido, active ? 1 : 0.75) }]}>{trazo(tint)}</Animated.View>
      {active && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          <View style={{ flex: 1, backgroundColor: 'transparent' }} />
          <View style={{ width: 18, backgroundColor: 'rgba(23,25,30,0.55)' }} />
          <View style={{ width: 10, backgroundColor: 'rgba(23,25,30,0.85)' }} />
        </View>
      )}
    </View>
  );
}

// Barra indeterminada que recorre el ancho mientras hay medición en curso
export function ScanBar({ active, color = colors.oxygen }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
    );
    loop.start();
    return () => { loop.stop(); v.setValue(0); };
  }, [active]);

  if (!active) return <View style={styles.scanTrack} />;
  return (
    <View style={styles.scanTrack}>
      <Animated.View
        style={[
          styles.scanFill,
          { backgroundColor: color, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-120, 320] }) }] },
        ]}
      />
    </View>
  );
}

// Tres puntos que "saltan" en lugar del número mientras el sensor se estabiliza
export function MeasuringDots({ color = colors.text, size = 12 }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((2 - i) * 160 + 200),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: size * 3.2, paddingBottom: size * 0.4 }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: size, height: size, borderRadius: size / 2, backgroundColor: color, marginRight: size * 0.55,
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 1.1] }) }],
          }}
        />
      ))}
    </View>
  );
}

// Barra que se llena durante los segundos de estabilización del sensor (si se conoce el inicio)
export function CalibrationBar({ inicioMs, duracionMs = 15000, color = colors.heart }) {
  const [now, setNow] = React.useState(Date.now());
  useEffect(() => {
    if (!inicioMs) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [inicioMs]);

  if (!inicioMs) return <ScanBar active color={color} />;
  const pct = Math.max(0.04, Math.min(1, (now - inicioMs) / duracionMs));
  const restante = Math.max(0, Math.ceil((duracionMs - (now - inicioMs)) / 1000));
  return (
    <View>
      <View style={styles.scanTrack}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={styles.calibText}>{restante > 0 ? `Estabilizando el sensor · ${restante} s` : 'Calculando resultado...'}</Text>
    </View>
  );
}

// Píldora de estado del sensor: midiendo / en pausa / sin pulsera puesta
export function SensorStatusChip({ estado }) {
  const dot = useRef(new Animated.Value(0)).current;
  const midiendo = estado === 'midiendo' || estado === 'calibrando';

  useEffect(() => {
    if (!midiendo) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { loop.stop(); dot.setValue(0); };
  }, [midiendo]);

  const cfg = {
    calibrando: { color: colors.warn, icon: 'pulse', text: 'MIDIENDO · MANTENÉ LA MUÑECA QUIETA' },
    midiendo: { color: colors.ok, icon: 'pulse', text: 'MIDIENDO PULSO Y OXÍGENO' },
    pausa: { color: colors.oxygen, icon: 'timer-sand', text: 'EN PAUSA · PRÓXIMA MEDICIÓN EN BREVE' },
    sin_muneca: { color: colors.warn, icon: 'watch-variant', text: 'PULSERA FUERA DE LA MUÑECA' },
    esperando: { color: colors.textMuted, icon: 'dots-horizontal', text: 'ESPERANDO DATOS DE LA PULSERA' },
  }[estado] || { color: colors.textMuted, icon: 'dots-horizontal', text: 'ESPERANDO DATOS' };

  return (
    <View style={[styles.chip, midiendo && { borderColor: `${cfg.color}55`, backgroundColor: `${cfg.color}14` }]}>
      {midiendo ? (
        <Animated.View style={[styles.chipDot, { backgroundColor: cfg.color, opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) }] }]} />
      ) : (
        <MaterialCommunityIcons name={cfg.icon} size={14} color={cfg.color} style={{ marginRight: 7 }} />
      )}
      <Text style={[styles.chipText, { color: cfg.color }]} numberOfLines={1}>{cfg.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scanTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden', width: '100%' },
  scanFill: { position: 'absolute', top: 0, bottom: 0, width: 110, borderRadius: 2, opacity: 0.9 },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  calibText: { color: colors.textMuted, fontSize: 11.5, fontWeight: '700', marginTop: 7, letterSpacing: 0.2 },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  chipText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6 },
});
