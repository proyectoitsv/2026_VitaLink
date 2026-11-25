import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { colors, radius } from '../constants/theme';
import { PulseRings, EcgSweep, ScanBar, SensorStatusChip, MeasuringDots, CalibrationBar, useEncendido } from './SensingVisuals';

export const mostrarValor = (v) => {
  if (v === undefined || v === null) return '--';
  const s = String(v).trim();
  if (s === '' || s === '0' || s === '--') return '--';
  if (s === '-1') return '...';
  return s;
};

const BatteryIcon = ({ value }) => {
  const n = parseInt(value, 10);
  const valid = !isNaN(n) && n >= 0;
  const pct = valid ? Math.max(0, Math.min(100, n)) : 0;
  const color = !valid ? colors.textFaint : pct <= 20 ? colors.danger : pct <= 40 ? colors.warn : colors.ok;
  return (
    <View style={styles.batWrap}>
      <View style={[styles.batBody, { borderColor: color }]}>
        <View style={[styles.batFill, { width: `${Math.max(pct, valid ? 6 : 0)}%`, backgroundColor: color }]} />
      </View>
      <View style={[styles.batCap, { backgroundColor: color }]} />
    </View>
  );
};

// Tarjeta que reemplaza la vista cuando la pulsera no está colocada:
// una pulsera que "baja" hacia la muñeca, invitando a ponérsela
function PulseraFueraCard() {
  const baja = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(baja, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(baja, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(300),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animatable.View animation="zoomIn" duration={500} easing="ease-out-back" style={styles.offCard}>
      <View style={styles.offIllustration}>
        <Animatable.View animation="pulse" iterationCount="infinite" duration={1800} style={styles.offTarget} />
        <MaterialCommunityIcons name="hand-back-left-outline" size={64} color={colors.textFaint} style={{ position: 'absolute', bottom: 6 }} />
        <Animated.View style={{
          position: 'absolute', top: 6,
          opacity: baja.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.4, 1, 1] }),
          transform: [{ translateY: baja.interpolate({ inputRange: [0, 1], outputRange: [-6, 30] }) }],
        }}>
          <MaterialCommunityIcons name="watch-variant" size={44} color={colors.warn} />
        </Animated.View>
      </View>
      <Text style={styles.offTitle}>La pulsera no está en la muñeca</Text>
      <Text style={styles.offText}>Para medir el pulso y el oxígeno, la pulsera tiene que estar bien ajustada sobre la piel.</Text>
      <View style={styles.offHint}>
        <MaterialCommunityIcons name="shield-check-outline" size={16} color={colors.ok} style={{ marginRight: 6 }} />
        <Text style={styles.offHintText}>La detección de caídas sigue activa</Text>
      </View>
    </Animatable.View>
  );
}

/**
 * Panel de signos vitales con animación de medición.
 * estado: 'calibrando' | 'midiendo' | 'pausa' | 'sin_muneca' | 'esperando'
 * calibInicioMs: cuándo empezó la estabilización (para la barra de progreso de 15 s)
 */
export default function VitalsPanel({ bpm, spo2, bateria, estado, compact = false, calibInicioMs = null }) {
  const calibrando = estado === 'calibrando';
  const midiendo = estado === 'midiendo' || calibrando;
  // En la pausa entre mediciones todo conserva sus colores; solo se apaga a gris sin medición
  const conColor = midiendo || estado === 'pausa';
  const sinPulsera = estado === 'sin_muneca';
  const visible = useEncendido(!sinPulsera, 500);
  const bpmMidiendo = calibrando || String(bpm).trim() === '-1';
  const spo2Midiendo = calibrando || String(spo2).trim() === '-1';
  const bpmTxt = mostrarValor(bpm);
  const spo2Txt = mostrarValor(spo2);
  const bpmNum = parseInt(bpm, 10);
  const beatMs = !isNaN(bpmNum) && bpmNum > 30 ? Math.max(380, 60000 / bpmNum) : 900;
  const etiquetaValor = estado === 'pausa' ? 'Última medición' : calibrando ? 'Midiendo...' : midiendo ? 'En vivo' : null;

  const batNum = parseInt(bateria, 10);
  const bateriaBaja = !isNaN(batNum) && batNum > 0 && batNum <= 20;

  return (
    <View>
      <SensorStatusChip estado={estado} />

      {bateriaBaja && (
        <Animatable.View animation="fadeInDown" duration={400} style={[styles.batBanner, batNum <= 10 && styles.batBannerCritical]}>
          <Animatable.View animation="pulse" iterationCount="infinite" duration={1400}>
            <MaterialCommunityIcons name={batNum <= 10 ? 'battery-alert-variant-outline' : 'battery-low'} size={22} color={batNum <= 10 ? colors.danger : colors.warn} />
          </Animatable.View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[styles.batBannerTitle, { color: batNum <= 10 ? colors.danger : colors.warn }]}>
              {batNum <= 10 ? 'Batería crítica' : 'Batería baja'} · {batNum}%
            </Text>
            <Text style={styles.batBannerText}>Cargá la pulsera pronto para no perder el monitoreo.</Text>
          </View>
        </Animatable.View>
      )}

      {sinPulsera && <PulseraFueraCard />}

      {/* Con la pulsera sacada las tarjetas se achican y apagan con una transición */}
      <Animated.View style={{
        opacity: visible.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        transform: [{ scale: visible.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}>
      {/* Frecuencia cardíaca */}
      <Animatable.View animation="fadeInUp" duration={450} style={[styles.card, styles.heroCard, midiendo ? styles.cardLiveHeart : conColor && styles.cardRestHeart]}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Frecuencia cardíaca</Text>
          {etiquetaValor ? <Text style={[styles.tag, conColor && { color: colors.heart }]}>{etiquetaValor.toUpperCase()}</Text> : null}
        </View>
        <View style={styles.heroRow}>
          <PulseRings active={midiendo} lit={conColor} color={colors.heart} icon="cards-heart" size={compact ? 50 : 58} iconSize={compact ? 28 : 32} beatMs={beatMs} />
          <View style={styles.heroValueCol}>
            <View style={styles.valueRow}>
              {bpmMidiendo ? (
                <MeasuringDots color={colors.heart} size={compact ? 10 : 12} />
              ) : (
                <Text style={styles.bigValue} numberOfLines={1}>{bpmTxt}</Text>
              )}
              <Text style={styles.unit}>LPM</Text>
            </View>
            <EcgSweep active={midiendo} lit={conColor} width={compact ? 120 : 140} height={compact ? 40 : 46} tint={colors.heart} />
          </View>
        </View>
        <View style={{ marginTop: 14 }}>
          {calibrando ? <CalibrationBar inicioMs={calibInicioMs} color={colors.heart} /> : <ScanBar active={midiendo} color={colors.heart} />}
        </View>
      </Animatable.View>

      <View style={styles.row}>
        {/* Oxígeno en sangre */}
        <Animatable.View animation="fadeInUp" delay={80} duration={450} style={[styles.card, styles.smallCard, { marginRight: 7 }, midiendo ? styles.cardLiveOxygen : conColor && styles.cardRestOxygen]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Oxígeno</Text>
            <Text style={styles.tagSmall}>SpO₂</Text>
          </View>
          <View style={styles.smallIcon}>
            <PulseRings active={midiendo} lit={conColor} color={colors.oxygen} icon="water" size={compact ? 40 : 46} iconSize={compact ? 22 : 26} beatMs={2200} />
          </View>
          <View style={styles.valueRow}>
            {spo2Midiendo ? <MeasuringDots color={colors.oxygen} size={compact ? 8 : 10} /> : <Text style={styles.midValue}>{spo2Txt}</Text>}
            <Text style={styles.unitSmall}>%</Text>
          </View>
          <View style={{ marginTop: 10 }}>
            <ScanBar active={midiendo} color={colors.oxygen} />
          </View>
        </Animatable.View>

        {/* Batería */}
        <Animatable.View animation="fadeInUp" delay={160} duration={450} style={[styles.card, styles.smallCard, { marginLeft: 7 }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Batería</Text>
          </View>
          <View style={[styles.smallIcon, { height: compact ? 76 : 87 }]}>
            <BatteryIcon value={bateria} />
          </View>
          <View style={styles.valueRow}>
            <Text style={styles.midValue}>{mostrarValor(bateria)}</Text>
            <Text style={styles.unitSmall}>%</Text>
          </View>
          <View style={{ marginTop: 10 }}>
            <ScanBar active={false} />
          </View>
        </Animatable.View>
      </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  batBanner: { flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 14, borderRadius: radius.md, backgroundColor: `${colors.warn}14`, borderWidth: 1, borderColor: `${colors.warn}55` },
  batBannerCritical: { backgroundColor: `${colors.danger}18`, borderColor: `${colors.danger}66` },
  batBannerTitle: { fontSize: 14, fontWeight: '800' },
  batBannerText: { color: colors.textMuted, fontSize: 12, fontWeight: '500', marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.border },
  heroCard: { marginTop: 14 },
  cardLiveHeart: { borderColor: `${colors.heart}55` },
  cardLiveOxygen: { borderColor: `${colors.oxygen}55` },
  cardRestHeart: { borderColor: `${colors.heart}2E` },
  cardRestOxygen: { borderColor: `${colors.oxygen}2E` },
  offCard: { marginTop: 14, alignItems: 'center', backgroundColor: `${colors.warn}0F`, borderWidth: 1, borderColor: `${colors.warn}40`, borderRadius: radius.lg, paddingVertical: 22, paddingHorizontal: 20 },
  offIllustration: { width: 120, height: 110, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 },
  offTarget: { position: 'absolute', bottom: 22, width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderStyle: 'dashed', borderColor: `${colors.warn}88` },
  offTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  offText: { color: colors.textMuted, fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 19, marginTop: 6, maxWidth: 290 },
  offHint: { flexDirection: 'row', alignItems: 'center', marginTop: 14, backgroundColor: `${colors.ok}14`, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  offHintText: { color: colors.ok, fontSize: 12, fontWeight: '700' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: colors.textSoft, fontSize: 16, fontWeight: '700' },
  tag: { color: colors.textFaint, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },
  tagSmall: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  heroValueCol: { flex: 1, marginLeft: 6, alignItems: 'flex-start' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },
  bigValue: { color: colors.text, fontSize: 46, fontWeight: '800', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -1 },
  unit: { color: colors.textMuted, fontSize: 16, fontWeight: '700', marginLeft: 6 },
  midValue: { color: colors.text, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'], includeFontPadding: false, letterSpacing: -0.5 },
  unitSmall: { color: colors.textMuted, fontSize: 18, fontWeight: '700', marginLeft: 4 },
  row: { flexDirection: 'row', marginTop: 14 },
  smallCard: { flex: 1 },
  smallIcon: { alignItems: 'flex-start', marginLeft: -12, marginVertical: 2 },
  batWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 16, marginTop: 28 },
  batBody: { width: 58, height: 28, borderRadius: 7, borderWidth: 2.5, padding: 3, justifyContent: 'center' },
  batFill: { height: '100%', borderRadius: 3 },
  batCap: { width: 4, height: 12, borderTopRightRadius: 2, borderBottomRightRadius: 2, marginLeft: 2 },
});
