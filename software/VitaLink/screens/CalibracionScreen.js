import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Dimensions, Alert, ActivityIndicator } from 'react-native';
import Svg, { Polyline, Line, Rect, Text as SvgText } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { colors, radius } from '../constants/theme';
import { getPulseraActiva, escucharPulseraActiva } from '../services/pulseraActiva';

const SERVICIO = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CALIB_DATOS = 'beb5483e-36e1-4688-b7f5-ea07361b26b0';
const CALIB_CONFIG = 'beb5483e-36e1-4688-b7f5-ea07361b26b1';

const MUESTRAS_VISIBLES = 300; // 6 segundos a 50 muestras por segundo
const G_MAX = 10;

const EVENTOS = {
  1: { nombre: 'Caída libre', color: '#4C9BE8', icono: 'arrow-down-bold' },
  2: { nombre: 'Impacto', color: '#F2A541', icono: 'flash' },
  3: { nombre: 'Caída confirmada', color: '#E04644', icono: 'alert-octagon' },
  4: { nombre: 'Descartada (siguió en movimiento)', color: '#6B7182', icono: 'close-circle-outline' },
  5: { nombre: 'Impacto demasiado rápido (gesto)', color: '#8E6BBF', icono: 'timer-sand-empty' },
};

// Parámetros editables: clave del firmware, cómo se muestran y cuánto cambia cada toque
const PARAMETROS = [
  { clave: 'libre', titulo: 'Umbral de caída libre', unidad: 'g', paso: 0.02, min: 0.10, max: 0.95, dec: 2,
    ayuda: 'Cuando la aceleración baja de este valor, la pulsera entiende que empezó una caída (el cuerpo “flota”). Más alto = más sensible.' },
  { clave: 'impacto', titulo: 'Umbral de impacto', unidad: 'g', paso: 0.1, min: 1.2, max: 9.0, dec: 1,
    ayuda: 'Pico que tiene que aparecer después de la caída libre para contar como golpe contra el piso. Más bajo = más sensible.' },
  { clave: 'vmin', titulo: 'Tiempo mínimo de caída', unidad: 'ms', paso: 50, min: 0, max: 1500, dec: 0,
    ayuda: 'Desde que empieza la caída libre, el impacto tiene que llegar después de este tiempo. Si llega antes, es un gesto brusco del brazo y se descarta.' },
  { clave: 'ventana', titulo: 'Tiempo máximo de caída', unidad: 'ms', paso: 50, min: 200, max: 2000, dec: 0,
    ayuda: 'Si el impacto no llega antes de este tiempo desde que empezó la caída libre, se descarta. Una caída desde estar parado tarda unos 400 a 700 ms.' },
  { clave: 'quieto', titulo: 'Tolerancia de “quieto”', unidad: 'g', paso: 0.02, min: 0.05, max: 1.0, dec: 2,
    ayuda: 'Después del impacto, cuánto se puede mover la muñeca (respecto de 1 g) y seguir contando como quieta.' },
  { clave: 'prop', titulo: 'Tiempo quieto necesario', unidad: '%', paso: 0.05, min: 0.30, max: 1.0, dec: 0, escala: 100,
    ayuda: 'Qué porcentaje del período de confirmación tiene que estar quieta la muñeca para confirmar la caída.' },
  { clave: 'conf', titulo: 'Período de confirmación', unidad: 'ms', paso: 250, min: 1000, max: 8000, dec: 0,
    ayuda: 'Cuánto tiempo después del impacto se observa la muñeca antes de decidir si fue una caída real.' },
];

const parsearConfig = (texto) => {
  const c = {};
  texto.split(';').forEach((par) => {
    const [k, v] = par.split('=');
    if (k && v !== undefined) c[k.trim()] = parseFloat(v);
  });
  return c;
};

const bytesDeBase64 = (b64) => {
  const bin = decodeBase64(b64);
  const out = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const formato = (p, v) => {
  if (v === undefined || isNaN(v)) return '--';
  const x = p.escala ? v * p.escala : v;
  return x.toFixed(p.dec).replace('.', ',');
};

export default function CalibracionScreen({ navigation }) {
  const ancho = Dimensions.get('window').width - 40;
  const alto = 240;
  const [conectada, setConectada] = useState(!!getPulseraActiva());
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [pausado, setPausado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [, setTick] = useState(0);
  const muestrasRef = useRef([]);       // magnitudes en g
  const totalRef = useRef(0);           // índice global de muestras
  const eventosRef = useRef([]);        // { indice, tipo, valor, hora }
  const picoRef = useRef(0);
  const pausadoRef = useRef(false);
  const envioRef = useRef(null);
  const pendienteRef = useRef({});

  const escribir = (comando) => {
    const d = getPulseraActiva();
    if (!d) return Promise.reject(new Error('sin pulsera'));
    return d.writeCharacteristicWithResponseForService(SERVICIO, CALIB_CONFIG, encodeBase64(comando));
  };

  useEffect(() => {
    let subDatos = null;
    let subConfig = null;
    let vivo = true;

    const iniciar = async () => {
      const d = getPulseraActiva();
      if (!d) { setConectada(false); return; }
      setConectada(true);
      // Leer la configuración. Si falla, Android puede tener guardada la lista vieja de servicios
      // de la pulsera (antes de actualizarla): se vuelve a descubrir y se reintenta.
      let leido = null;
      let ultimoError = null;
      for (let intento = 0; intento < 2 && !leido; intento++) {
        try {
          if (intento > 0) {
            await new Promise((r) => setTimeout(r, 400));
            await d.discoverAllServicesAndCharacteristics();
          }
          leido = await d.readCharacteristicForService(SERVICIO, CALIB_CONFIG);
        } catch (e) {
          ultimoError = e;
          console.log(`Calibración: lectura ${intento + 1} falló:`, e?.errorCode, e?.message, e?.reason);
        }
      }
      if (!leido) {
        if (!vivo) return;
        // Diagnóstico: ¿se cortó el enlace, o la pulsera realmente no tiene el canal?
        const enlazada = await d.isConnected().catch(() => false);
        if (!enlazada) {
          setError('Se cortó la conexión con la pulsera al abrir la calibración. Volvé a conectarla y probá de nuevo.');
          return;
        }
        let tieneCanal = false;
        let version = '';
        try {
          const caracts = await d.characteristicsForService(SERVICIO);
          tieneCanal = caracts.some((c) => c.uuid.toLowerCase() === CALIB_CONFIG);
          const v = await d.readCharacteristicForService(SERVICIO, 'beb5483e-36e1-4688-b7f5-ea07361b26ad');
          if (v?.value) version = decodeBase64(v.value).trim();
        } catch (e) {}
        if (!tieneCanal) {
          setError(`El teléfono no encuentra el canal de calibración${version ? ` (la pulsera informa la versión ${version})` : ''}. ` +
            'Si ya la actualizaste a la 1.0.28, desactivá y activá el Bluetooth del celular para que olvide la lista vieja de servicios, y volvé a conectar.');
        } else {
          setError(`No se pudo leer la calibración: ${ultimoError?.reason || ultimoError?.message || 'error de Bluetooth'}.`);
        }
        return;
      }
      if (vivo && leido?.value) setConfig(parsearConfig(decodeBase64(leido.value)));
      subConfig = d.monitorCharacteristicForService(SERVICIO, CALIB_CONFIG, (err, ch) => {
        if (err || !ch?.value || !vivo) return;
        setConfig(parsearConfig(decodeBase64(ch.value)));
      });
      subDatos = d.monitorCharacteristicForService(SERVICIO, CALIB_DATOS, (err, ch) => {
        if (err || !ch?.value || !vivo || pausadoRef.current) return;
        const b = bytesDeBase64(ch.value);
        const n = b[0] || 0;
        const arr = muestrasRef.current;
        for (let k = 0; k < n; k++) {
          const g = (b[1 + k * 2] | (b[2 + k * 2] << 8)) / 1000;
          arr.push(g);
          totalRef.current++;
          if (g > picoRef.current) picoRef.current = g;
        }
        if (arr.length > MUESTRAS_VISIBLES) arr.splice(0, arr.length - MUESTRAS_VISIBLES);
        const evento = b[1 + n * 2];
        if (evento) {
          const valor = b[2 + n * 2] | (b[3 + n * 2] << 8);
          eventosRef.current.unshift({ indice: totalRef.current - 1, tipo: evento, valor, hora: new Date() });
          eventosRef.current = eventosRef.current.slice(0, 12);
        }
        setTick((t) => t + 1);
      });
      escribir('STREAM 1').catch(() => {});
    };

    iniciar();
    const quitar = escucharPulseraActiva((d) => {
      setConectada(!!d);
      if (!d) setError('Se desconectó la pulsera.');
    });

    return () => {
      vivo = false;
      quitar();
      try { subDatos?.remove(); } catch (e) {}
      try { subConfig?.remove(); } catch (e) {}
      if (envioRef.current) clearTimeout(envioRef.current);
      escribir('STREAM 0').catch(() => {});
    };
  }, []);

  // Cambiar un parámetro: se ve al instante y se envía a la pulsera agrupando toques rápidos
  const cambiar = (p, signo) => {
    if (!config) return;
    const actual = config[p.clave];
    let nuevo = Math.round((actual + signo * p.paso) * 1000) / 1000;
    nuevo = Math.min(p.max, Math.max(p.min, nuevo));
    setConfig({ ...config, [p.clave]: nuevo });
    pendienteRef.current[p.clave] = nuevo;
    if (envioRef.current) clearTimeout(envioRef.current);
    envioRef.current = setTimeout(() => {
      const partes = Object.entries(pendienteRef.current).map(([k, v]) => `${k}=${v}`).join(';');
      pendienteRef.current = {};
      escribir(`SET ${partes}`).catch(() => Alert.alert('No se pudo enviar', 'Revisá la conexión con la pulsera.'));
    }, 250);
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await escribir('SAVE');
      Alert.alert('Guardado', 'La pulsera va a usar estos valores también después de apagarse.');
    } catch (e) {
      Alert.alert('No se pudo guardar', 'Revisá la conexión con la pulsera.');
    } finally {
      setGuardando(false);
    }
  };

  const restaurar = () => {
    Alert.alert('Restaurar valores de fábrica', 'Se van a reemplazar los valores actuales por los originales.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Restaurar', style: 'destructive', onPress: () => escribir('RESET').catch(() => {}) },
    ]);
  };

  // ---------- Gráfico ----------
  const mt = 10, mb = 22, ml = 34, mr = 8;
  const W = ancho, H = alto;
  const X = (i) => ml + (i / (MUESTRAS_VISIBLES - 1)) * (W - ml - mr);
  const Y = (g) => mt + (1 - Math.min(G_MAX, Math.max(0, g)) / G_MAX) * (H - mt - mb);
  const muestras = muestrasRef.current;
  const desplazamiento = MUESTRAS_VISIBLES - muestras.length;
  const puntos = muestras.map((g, i) => `${X(i + desplazamiento).toFixed(1)},${Y(g).toFixed(1)}`).join(' ');
  const primerIndice = totalRef.current - muestras.length;
  const actual = muestras.length ? muestras[muestras.length - 1] : null;

  const lineaUmbral = (g, color, etiqueta) => (
    <>
      <Line x1={ml} y1={Y(g)} x2={W - mr} y2={Y(g)} stroke={color} strokeWidth={1.4} strokeDasharray="6,4" />
      <SvgText x={W - mr - 4} y={Y(g) - 4} fill={color} fontSize={10} fontWeight="bold" textAnchor="end">{etiqueta}</SvgText>
    </>
  );

  return (
    <View style={styles.container}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.btnCirculo} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textSoft} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.kicker}>AJUSTES DE LA PULSERA</Text>
          <Text style={styles.titulo}>Calibración de caídas</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.modoPrueba}>
          <MaterialCommunityIcons name="flask-outline" size={18} color={colors.warn} style={{ marginRight: 10 }} />
          <Text style={styles.modoPruebaTexto}>
            <Text style={{ fontWeight: '800', color: colors.warn }}>Modo prueba activo. </Text>
            Mientras estés en esta pantalla podés simular caídas: se marcan en el gráfico pero no se avisa a la familia.
          </Text>
        </View>

        {!conectada || error ? (
          <View style={styles.aviso}>
            <MaterialCommunityIcons name="bluetooth-off" size={22} color={colors.danger} />
            <Text style={styles.avisoTexto}>{error || 'La pulsera no está conectada.'}</Text>
          </View>
        ) : null}

        {/* Gráfico en vivo */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitulo}>Aceleración en vivo</Text>
              <Text style={styles.cardSub}>Módulo |a| · últimos 6 segundos</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.valorActual}>{actual === null ? '--' : actual.toFixed(2).replace('.', ',')}<Text style={styles.valorUnidad}> g</Text></Text>
              <Text style={styles.pico}>pico {picoRef.current.toFixed(2).replace('.', ',')} g</Text>
            </View>
          </View>

          <Svg width={W} height={H}>
            <Rect x={ml} y={mt} width={W - ml - mr} height={H - mt - mb} fill="#0F1114" rx={6} />
            {[0, 2, 4, 6, 8, 10].map((g) => (
              <React.Fragment key={g}>
                <Line x1={ml} y1={Y(g)} x2={W - mr} y2={Y(g)} stroke="rgba(255,255,255,0.06)" />
                <SvgText x={ml - 6} y={Y(g) + 3} fill={colors.textFaint} fontSize={9} textAnchor="end">{g}</SvgText>
              </React.Fragment>
            ))}
            <Line x1={ml} y1={Y(1)} x2={W - mr} y2={Y(1)} stroke="rgba(255,255,255,0.18)" />
            <SvgText x={ml + 4} y={Y(1) - 4} fill={colors.textFaint} fontSize={9}>reposo 1 g</SvgText>
            {config ? lineaUmbral(config.impacto, '#E04644', `impacto ${formato(PARAMETROS[1], config.impacto)} g`) : null}
            {config ? lineaUmbral(config.libre, '#4C9BE8', `caída libre ${formato(PARAMETROS[0], config.libre)} g`) : null}
            {eventosRef.current.map((e, k) => {
              const pos = e.indice - primerIndice + desplazamiento;
              if (pos < 0 || pos >= MUESTRAS_VISIBLES) return null;
              const c = EVENTOS[e.tipo]?.color || '#fff';
              return <Line key={`ev${k}`} x1={X(pos)} y1={mt} x2={X(pos)} y2={H - mb} stroke={c} strokeWidth={2} opacity={0.9} />;
            })}
            {puntos ? <Polyline points={puntos} fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinejoin="round" /> : null}
            <SvgText x={(ml + W - mr) / 2} y={H - 5} fill={colors.textFaint} fontSize={9} textAnchor="middle">tiempo →</SvgText>
          </Svg>

          <View style={styles.filaBotones}>
            <TouchableOpacity style={styles.btnChico} onPress={() => { pausadoRef.current = !pausado; setPausado(!pausado); }} activeOpacity={0.8}>
              <MaterialCommunityIcons name={pausado ? 'play' : 'pause'} size={16} color={colors.textSoft} />
              <Text style={styles.btnChicoTexto}>{pausado ? 'Reanudar' : 'Pausar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnChico} onPress={() => { picoRef.current = 0; eventosRef.current = []; setTick((t) => t + 1); }} activeOpacity={0.8}>
              <MaterialCommunityIcons name="restore" size={16} color={colors.textSoft} />
              <Text style={styles.btnChicoTexto}>Reiniciar pico y eventos</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Registro de eventos */}
        <View style={styles.card}>
          <Text style={styles.cardTitulo}>Lo que detectó la pulsera</Text>
          {eventosRef.current.length === 0 ? (
            <Text style={styles.vacio}>Simulá una caída: dejá caer la mano y quedate quieto unos segundos.</Text>
          ) : eventosRef.current.slice(0, 6).map((e, k) => {
            const info = EVENTOS[e.tipo] || {};
            const detalle = e.tipo <= 2 ? `${(e.valor / 1000).toFixed(2).replace('.', ',')} g` : e.tipo === 5 ? `a los ${e.valor} ms` : `${e.valor} % quieto`;
            return (
              <Animatable.View key={`${e.indice}-${e.tipo}`} animation={k === 0 ? 'fadeInDown' : undefined} duration={300} style={styles.evento}>
                <View style={[styles.eventoIcono, { backgroundColor: `${info.color}22` }]}>
                  <MaterialCommunityIcons name={info.icono} size={16} color={info.color} />
                </View>
                <Text style={styles.eventoNombre}>{info.nombre}</Text>
                <Text style={styles.eventoDetalle}>{detalle}</Text>
                <Text style={styles.eventoHora}>{e.hora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Text>
              </Animatable.View>
            );
          })}
        </View>

        {/* Parámetros */}
        <Text style={styles.seccion}>PARÁMETROS DE DETECCIÓN</Text>
        {!config ? (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
            {error ? <Text style={styles.vacio}>{error}</Text> : <ActivityIndicator color={colors.danger} />}
          </View>
        ) : PARAMETROS.map((p) => (
          <View key={p.clave} style={styles.param}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.paramTitulo}>{p.titulo}</Text>
              <Text style={styles.paramAyuda}>{p.ayuda}</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => cambiar(p, -1)} activeOpacity={0.7}>
                <MaterialCommunityIcons name="minus" size={18} color={colors.text} />
              </TouchableOpacity>
              <View style={styles.stepValor}>
                <Text style={styles.stepNumero}>{formato(p, config[p.clave])}</Text>
                <Text style={styles.stepUnidad}>{p.unidad}</Text>
              </View>
              <TouchableOpacity style={styles.stepBtn} onPress={() => cambiar(p, 1)} activeOpacity={0.7}>
                <MaterialCommunityIcons name="plus" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={[styles.btnPrimario, (!config || guardando) && { opacity: 0.6 }]} onPress={guardar} disabled={!config || guardando} activeOpacity={0.85}>
          <MaterialCommunityIcons name="content-save-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
          <Text style={styles.btnPrimarioTexto}>{guardando ? 'Guardando...' : 'Guardar en la pulsera'}</Text>
        </TouchableOpacity>
        <Text style={styles.nota}>Los cambios se aplican al instante para que puedas probarlos. Si no los guardás, la pulsera vuelve a los valores guardados cuando se reinicia.</Text>
        <TouchableOpacity style={styles.btnSecundario} onPress={restaurar} disabled={!config} activeOpacity={0.8}>
          <MaterialCommunityIcons name="backup-restore" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <Text style={styles.btnSecundarioTexto}>Restaurar valores de fábrica</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 42, paddingBottom: 14 },
  btnCirculo: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  titulo: { color: colors.text, fontSize: 22, fontWeight: '800' },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  modoPrueba: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${colors.warn}14`, borderWidth: 1, borderColor: `${colors.warn}44`, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  modoPruebaTexto: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18, flex: 1 },
  aviso: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${colors.danger}14`, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  avisoTexto: { color: colors.textSoft, fontSize: 13, marginLeft: 10, flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  cardTitulo: { color: colors.textSoft, fontSize: 15, fontWeight: '800' },
  cardSub: { color: colors.textFaint, fontSize: 11.5, marginTop: 2 },
  valorActual: { color: colors.text, fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
  valorUnidad: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  pico: { color: colors.warn, fontSize: 11.5, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] },
  filaBotones: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnChico: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
  btnChicoTexto: { color: colors.textSoft, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  vacio: { color: colors.textMuted, fontSize: 12.5, marginTop: 8, lineHeight: 18 },
  evento: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
  eventoIcono: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  eventoNombre: { color: colors.textSoft, fontSize: 13, fontWeight: '700', flex: 1 },
  eventoDetalle: { color: colors.text, fontSize: 12.5, fontWeight: '800', marginRight: 10, fontVariant: ['tabular-nums'] },
  eventoHora: { color: colors.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  seccion: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, marginTop: 6, marginBottom: 10 },
  param: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  paramTitulo: { color: colors.text, fontSize: 14, fontWeight: '800' },
  paramAyuda: { color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', borderRadius: radius.pill, padding: 4 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  stepValor: { minWidth: 62, alignItems: 'center' },
  stepNumero: { color: colors.text, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stepUnidad: { color: colors.textFaint, fontSize: 10, fontWeight: '700' },
  btnPrimario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger, height: 54, borderRadius: radius.md, marginTop: 8 },
  btnPrimarioTexto: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  nota: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
  btnSecundario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.md, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  btnSecundarioTexto: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
});
