import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Dimensions, Alert, ActivityIndicator } from 'react-native';
import Svg, { Polyline, Line, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { colors, radius } from '../constants/theme';
import { getPulseraActiva, escucharPulseraActiva } from '../services/pulseraActiva';

const SERVICIO = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const MAX_DATOS = 'beb5483e-36e1-4688-b7f5-ea07361b26b2';
const MAX_CONFIG = 'beb5483e-36e1-4688-b7f5-ea07361b26b3';
const VERSION_CHAR = 'beb5483e-36e1-4688-b7f5-ea07361b26ad';

const SEGUNDOS_VISIBLES = 8;
const MAX_BUFFER = 400;
const SATURACION = 262143; // el conversor del MAX30102 es de 18 bits
const PROMEDIOS = [1, 2, 4, 8, 16];

const ESTADOS = {
  0: { texto: 'Sin pulsera / sin dedo', color: colors.warn },
  1: { texto: 'Estabilizando (4 s)', color: colors.oxygen },
  2: { texto: 'Midiendo', color: colors.ok },
};

const PARAMETROS = [
  { clave: 'led', titulo: 'Intensidad del LED', paso: 10, min: 10, max: 255, dec: 0, unidad: (v) => `${(v * 0.2).toFixed(0)} mA`,
    ayuda: 'Cuánta luz emite el sensor. Si la señal es débil o la onda se ve chata, subila. Si el nivel de señal llega al tope (saturado), bajala.' },
  { clave: 'prom', titulo: 'Promedio de muestras', lista: PROMEDIOS, dec: 0, unidad: (v) => `${(100 / v).toFixed(1).replace('.', ',')} /s`,
    ayuda: 'El sensor promedia varias lecturas en una. Más promedio = onda más suave pero menos muestras por segundo.' },
  { clave: 'sens', titulo: 'Sensibilidad del latido', paso: 1, min: 1, max: 200, dec: 0, unidad: () => 'cuentas',
    ayuda: 'Cuánto tiene que bajar la onda para contar un latido. Si marca latidos de más (puntos donde no hay pulso), subila. Si se saltea latidos, bajala.' },
  { clave: 'smax', titulo: 'Sensibilidad máxima automática', paso: 5, min: 5, max: 1000, dec: 0, unidad: () => 'cuentas',
    ayuda: 'La sensibilidad se ajusta sola según el tamaño de la onda, hasta este tope. Con ondas grandes (dedo), conviene subirlo.' },
  { clave: 'amp', titulo: 'Amplitud máxima de un latido', paso: 100, min: 200, max: 20000, dec: 0, unidad: () => 'cuentas',
    ayuda: 'Una variación mayor a esto se toma como movimiento, no como latido. Si con la mano quieta no detecta nada y la onda es grande, subilo.' },
  { clave: 'pulsera', titulo: 'Umbral de pulsera puesta', paso: 5000, min: 5000, max: 250000, dec: 0, unidad: () => 'cuentas',
    ayuda: 'Nivel mínimo de señal para considerar que la pulsera está sobre la piel. Debería quedar por debajo del nivel que ves con la pulsera puesta.' },
  { clave: 'bmin', titulo: 'Pulso mínimo válido', paso: 5, min: 25, max: 80, dec: 0, unidad: () => 'BPM',
    ayuda: 'Latidos más lentos que esto se descartan.' },
  { clave: 'bmax', titulo: 'Pulso máximo válido', paso: 5, min: 100, max: 220, dec: 0, unidad: () => 'BPM',
    ayuda: 'Latidos más rápidos que esto se descartan (suelen ser ruido).' },
  { clave: 'sa', titulo: 'SpO₂: coeficiente A', paso: 0.5, min: 80, max: 130, dec: 1, unidad: () => '',
    ayuda: 'SpO₂ = A − B·R. Para calibrar, compará con un oxímetro de dedo: si la pulsera marca siempre de más, bajá A.' },
  { clave: 'sb', titulo: 'SpO₂: coeficiente B', paso: 0.25, min: 0, max: 50, dec: 2, unidad: () => '',
    ayuda: 'Cuánto cambia el SpO₂ con R. Más alto = más sensible a las variaciones del oxígeno.' },
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

const fmt = (v, dec) => (v === undefined || isNaN(v) ? '--' : Number(v).toFixed(dec).replace('.', ','));

export default function CalibracionPulsoScreen({ navigation }) {
  const ancho = Dimensions.get('window').width - 40;
  const alto = 220;
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [pausado, setPausado] = useState(false);
  const [filtrada, setFiltrada] = useState(true);
  const [invertida, setInvertida] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [, setTick] = useState(0);
  const muestrasRef = useRef([]);   // { v, det, acc }
  const infoRef = useRef({ bpm: 0, spo2: 0, estado: 0, r: 0 });
  const pausadoRef = useRef(false);
  const envioRef = useRef(null);
  const pendienteRef = useRef({});

  const escribir = (comando) => {
    const d = getPulseraActiva();
    if (!d) return Promise.reject(new Error('sin pulsera'));
    return d.writeCharacteristicWithResponseForService(SERVICIO, MAX_CONFIG, encodeBase64(comando));
  };

  useEffect(() => {
    let subDatos = null;
    let subConfig = null;
    let vivo = true;

    const iniciar = async () => {
      const d = getPulseraActiva();
      if (!d) { setError('La pulsera no está conectada.'); return; }
      let leido = null;
      for (let intento = 0; intento < 2 && !leido; intento++) {
        try {
          if (intento > 0) { await new Promise((r) => setTimeout(r, 400)); await d.discoverAllServicesAndCharacteristics(); }
          leido = await d.readCharacteristicForService(SERVICIO, MAX_CONFIG);
        } catch (e) {}
      }
      if (!leido) {
        if (!vivo) return;
        let version = '';
        try {
          const v = await d.readCharacteristicForService(SERVICIO, VERSION_CHAR);
          if (v?.value) version = decodeBase64(v.value).trim();
        } catch (e) {}
        setError(`No se encuentra la calibración del sensor de pulso${version ? ` (la pulsera tiene la versión ${version})` : ''}. ` +
          'Necesita el firmware 1.0.32 o superior. Si ya lo cargaste, apagá y prendé el Bluetooth del celular y volvé a conectar.');
        return;
      }
      if (vivo) setConfig(parsearConfig(decodeBase64(leido.value)));
      subConfig = d.monitorCharacteristicForService(SERVICIO, MAX_CONFIG, (err, ch) => {
        if (err || !ch?.value || !vivo) return;
        setConfig(parsearConfig(decodeBase64(ch.value)));
      });
      subDatos = d.monitorCharacteristicForService(SERVICIO, MAX_DATOS, (err, ch) => {
        if (err || !ch?.value || !vivo) return;
        const b = bytesDeBase64(ch.value);
        const n = b[0] || 0;
        const base = 1 + n * 3;
        const mascara = b[base];
        infoRef.current = { bpm: b[base + 1], spo2: b[base + 2], estado: b[base + 3], r: (b[base + 4] | (b[base + 5] << 8)) / 1000 };
        if (pausadoRef.current) { setTick((t) => t + 1); return; }
        const arr = muestrasRef.current;
        for (let k = 0; k < n; k++) {
          const v = b[1 + k * 3] | (b[2 + k * 3] << 8) | (b[3 + k * 3] << 16);
          arr.push({ v, det: !!(mascara & (1 << k)), acc: !!(mascara & (1 << (4 + k))) });
        }
        if (arr.length > MAX_BUFFER) arr.splice(0, arr.length - MAX_BUFFER);
        setTick((t) => t + 1);
      });
      escribir('STREAM 1').catch(() => {});
    };

    iniciar();
    const quitar = escucharPulseraActiva((d) => { if (!d) setError('Se desconectó la pulsera.'); });
    return () => {
      vivo = false;
      quitar();
      try { subDatos?.remove(); } catch (e) {}
      try { subConfig?.remove(); } catch (e) {}
      if (envioRef.current) clearTimeout(envioRef.current);
      escribir('STREAM 0').catch(() => {});
    };
  }, []);

  const enviarCambio = (clave, valor) => {
    pendienteRef.current[clave] = valor;
    if (envioRef.current) clearTimeout(envioRef.current);
    envioRef.current = setTimeout(() => {
      const partes = Object.entries(pendienteRef.current).map(([k, v]) => `${k}=${v}`).join(';');
      pendienteRef.current = {};
      escribir(`SET ${partes}`).catch(() => Alert.alert('No se pudo enviar', 'Revisá la conexión con la pulsera.'));
    }, 250);
  };

  const cambiar = (p, signo) => {
    if (!config) return;
    let nuevo;
    if (p.lista) {
      const i = Math.max(0, p.lista.indexOf(config[p.clave]));
      nuevo = p.lista[Math.min(p.lista.length - 1, Math.max(0, i + signo))];
    } else {
      nuevo = Math.round((config[p.clave] + signo * p.paso) * 100) / 100;
      nuevo = Math.min(p.max, Math.max(p.min, nuevo));
    }
    setConfig({ ...config, [p.clave]: nuevo });
    enviarCambio(p.clave, nuevo);
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

  // ---------- Gráfico de la onda ----------
  const prom = config?.prom || 8;
  const visibles = Math.min(MAX_BUFFER, Math.round((SEGUNDOS_VISIBLES * 100) / prom));
  const todas = muestrasRef.current;
  const ventana = todas.slice(-visibles);
  const crudos = ventana.map((m) => m.v);
  const nivel = crudos.length ? crudos.reduce((a, b) => a + b, 0) / crudos.length : 0;

  // Señal filtrada: se le resta un promedio móvil (~1,2 s) para quitar la deriva lenta
  let valores = crudos;
  if (filtrada && crudos.length) {
    const k = Math.max(3, Math.round(120 / prom));
    valores = crudos.map((_, i) => {
      const desde = Math.max(0, i - k);
      const hasta = Math.min(crudos.length - 1, i + k);
      let s = 0;
      for (let j = desde; j <= hasta; j++) s += crudos[j];
      return crudos[i] - s / (hasta - desde + 1);
    });
  }
  if (invertida) valores = valores.map((v) => -v);
  const minV = valores.length ? Math.min(...valores) : 0;
  const maxV = valores.length ? Math.max(...valores) : 1;
  const rango = Math.max(1, maxV - minV);
  const mt = 10, mb = 18, ml = 8, mr = 8;
  const W = ancho, H = alto;
  const offset = visibles - valores.length;
  const X = (i) => ml + ((i + offset) / Math.max(1, visibles - 1)) * (W - ml - mr);
  const Y = (v) => mt + (1 - (v - minV) / rango) * (H - mt - mb);
  const puntos = valores.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');

  const info = infoRef.current;
  const estado = ESTADOS[info.estado] || ESTADOS[0];
  const saturado = nivel > SATURACION * 0.95;
  const debil = config && nivel > 0 && nivel < config.pulsera;
  const amplitud = crudos.length ? Math.max(...crudos) - Math.min(...crudos) : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.btnCirculo} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textSoft} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.kicker}>AJUSTES DE LA PULSERA</Text>
          <Text style={styles.titulo}>Calibrar sensor de pulso</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.modoPrueba}>
          <MaterialCommunityIcons name="flask-outline" size={18} color={colors.warn} style={{ marginRight: 10 }} />
          <Text style={styles.modoPruebaTexto}>
            <Text style={{ fontWeight: '800', color: colors.warn }}>Modo prueba: </Text>
            el sensor mide sin pausas mientras estés en esta pantalla. Mantené la mano quieta y apoyada.
          </Text>
        </View>

        {error ? (
          <View style={styles.aviso}>
            <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.danger} />
            <Text style={styles.avisoTexto}>{error}</Text>
          </View>
        ) : null}

        {/* Valores en vivo */}
        <View style={styles.resumen}>
          <View style={styles.dato}>
            <MaterialCommunityIcons name="cards-heart" size={18} color={colors.heart} />
            <Text style={styles.datoValor}>{info.bpm || '--'}</Text>
            <Text style={styles.datoEtiqueta}>BPM</Text>
          </View>
          <View style={styles.dato}>
            <MaterialCommunityIcons name="water" size={18} color={colors.oxygen} />
            <Text style={styles.datoValor}>{info.spo2 || '--'}</Text>
            <Text style={styles.datoEtiqueta}>SpO₂ %</Text>
          </View>
          <View style={styles.dato}>
            <MaterialCommunityIcons name="sigma" size={18} color={colors.textMuted} />
            <Text style={styles.datoValor}>{info.r ? fmt(info.r, 2) : '--'}</Text>
            <Text style={styles.datoEtiqueta}>valor R</Text>
          </View>
        </View>

        {/* Gráfico */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitulo}>Onda del pulso</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                <View style={[styles.punto, { backgroundColor: estado.color }]} />
                <Text style={[styles.cardSub, { color: estado.color }]}>{estado.texto}</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.leyenda}><Text style={{ color: colors.heart }}>●</Text> latido contado</Text>
              <Text style={styles.leyenda}><Text style={{ color: colors.textFaint }}>●</Text> descartado</Text>
            </View>
          </View>

          <Svg width={W} height={H}>
            <Rect x={0} y={0} width={W} height={H} fill="#0F1114" rx={8} />
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={ml} y1={mt + f * (H - mt - mb)} x2={W - mr} y2={mt + f * (H - mt - mb)} stroke="rgba(255,255,255,0.05)" />
            ))}
            {puntos ? <Polyline points={puntos} fill="none" stroke={colors.heart} strokeWidth={2} strokeLinejoin="round" /> : null}
            {ventana.map((m, i) => (m.det ? (
              <Circle key={i} cx={X(i)} cy={Y(valores[i])} r={m.acc ? 5 : 4}
                fill={m.acc ? colors.heart : '#0F1114'} stroke={m.acc ? '#FFF' : colors.textFaint} strokeWidth={1.5} />
            ) : null))}
            <SvgText x={W / 2} y={H - 5} fill={colors.textFaint} fontSize={9} textAnchor="middle">
              últimos {SEGUNDOS_VISIBLES} s · escala automática
            </SvgText>
          </Svg>

          {/* Nivel de señal */}
          <View style={styles.nivelFila}>
            <Text style={styles.nivelTitulo}>Nivel de señal</Text>
            <Text style={[styles.nivelValor, saturado && { color: colors.danger }, debil && { color: colors.warn }]}>
              {Math.round(nivel).toLocaleString('es-AR')} {saturado ? '· SATURADO, bajá el LED' : debil ? '· débil' : ''}
            </Text>
          </View>
          <View style={styles.barra}>
            <View style={[styles.barraRelleno, { width: `${Math.min(100, (nivel / SATURACION) * 100)}%`, backgroundColor: saturado ? colors.danger : colors.ok }]} />
            {config ? <View style={[styles.marcaUmbral, { left: `${Math.min(100, (config.pulsera / SATURACION) * 100)}%` }]} /> : null}
          </View>
          <Text style={styles.nivelNota}>La marca blanca es el umbral de pulsera puesta. Amplitud de la onda: {Math.round(amplitud).toLocaleString('es-AR')} cuentas.</Text>

          <View style={styles.filaBotones}>
            <TouchableOpacity style={[styles.btnChico, filtrada && styles.btnChicoActivo]} onPress={() => setFiltrada(!filtrada)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="sine-wave" size={15} color={colors.textSoft} />
              <Text style={styles.btnChicoTexto}>{filtrada ? 'Filtrada' : 'Cruda'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnChico, invertida && styles.btnChicoActivo]} onPress={() => setInvertida(!invertida)} activeOpacity={0.8}>
              <MaterialCommunityIcons name="swap-vertical" size={15} color={colors.textSoft} />
              <Text style={styles.btnChicoTexto}>Invertir</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnChico} onPress={() => { pausadoRef.current = !pausado; setPausado(!pausado); }} activeOpacity={0.8}>
              <MaterialCommunityIcons name={pausado ? 'play' : 'pause'} size={15} color={colors.textSoft} />
              <Text style={styles.btnChicoTexto}>{pausado ? 'Seguir' : 'Pausar'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Parámetros */}
        <Text style={styles.seccion}>PARÁMETROS DEL SENSOR</Text>
        {!config ? (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
            {error ? <Text style={styles.vacio}>Sin conexión con la calibración.</Text> : <ActivityIndicator color={colors.danger} />}
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
                <Text style={styles.stepNumero}>{fmt(config[p.clave], p.dec)}</Text>
                <Text style={styles.stepUnidad}>{p.unidad(config[p.clave])}</Text>
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
        <Text style={styles.nota}>Los cambios se aplican al instante. Si no los guardás, la pulsera vuelve a los valores guardados cuando se reinicia.</Text>
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
  avisoTexto: { color: colors.textSoft, fontSize: 13, marginLeft: 10, flex: 1, lineHeight: 18 },
  resumen: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  dato: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  datoValor: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] },
  datoEtiqueta: { color: colors.textFaint, fontSize: 11, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardTitulo: { color: colors.textSoft, fontSize: 15, fontWeight: '800' },
  cardSub: { fontSize: 12, fontWeight: '700' },
  punto: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  leyenda: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  nivelFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 12 },
  nivelTitulo: { color: colors.textSoft, fontSize: 13, fontWeight: '700' },
  nivelValor: { color: colors.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  barra: { height: 8, borderRadius: 4, backgroundColor: '#0F1114', marginTop: 6, overflow: 'hidden' },
  barraRelleno: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  marcaUmbral: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#FFF' },
  nivelNota: { color: colors.textFaint, fontSize: 11, marginTop: 6, lineHeight: 16 },
  filaBotones: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btnChico: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent' },
  btnChicoActivo: { borderColor: `${colors.heart}88` },
  btnChicoTexto: { color: colors.textSoft, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  vacio: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  seccion: { color: colors.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 0.9, marginTop: 6, marginBottom: 10 },
  param: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  paramTitulo: { color: colors.text, fontSize: 14, fontWeight: '800' },
  paramAyuda: { color: colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1114', borderRadius: radius.pill, padding: 4 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  stepValor: { minWidth: 70, alignItems: 'center' },
  stepNumero: { color: colors.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stepUnidad: { color: colors.textFaint, fontSize: 9.5, fontWeight: '700' },
  btnPrimario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger, height: 54, borderRadius: radius.md, marginTop: 8 },
  btnPrimarioTexto: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  nota: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 8, textAlign: 'center' },
  btnSecundario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.md, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  btnSecundarioTexto: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
});
