import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../constants/theme';

/**
 * Transición compartida: el avatar del paciente "vuela" desde su tarjeta en la lista
 * hasta el encabezado del panel, describiendo un arco y agrandándose.
 * - origen / destino: { x, y, size } en coordenadas de ventana (measureInWindow)
 * - Se dibuja en el origen apenas se monta (tapa el hueco mientras se mide el destino)
 *   y arranca el vuelo cuando llega el destino.
 */
export default function AvatarVolador({ origen, destino, foto, icono, onFin }) {
  const p = useRef(new Animated.Value(0)).current;
  const iniciado = useRef(false);

  useEffect(() => {
    if (!destino || iniciado.current) return;
    iniciado.current = true;
    Animated.timing(p, {
      toValue: 1,
      duration: 560,
      delay: 90, // dejar que la pantalla nueva termine de aparecer
      easing: Easing.bezier(0.22, 0.9, 0.24, 1),
      useNativeDriver: true,
    }).start(() => onFin && onFin());
  }, [destino]);

  const s0 = origen.size;
  const s1 = destino ? destino.size : s0;
  const dx = destino ? (destino.x + s1 / 2) - (origen.x + s0 / 2) : 0;
  const dy = destino ? (destino.y + s1 / 2) - (origen.y + s0 / 2) : 0;
  const escalaFinal = s1 / s0;

  // X avanza rápido al principio e Y más tarde: el recorrido queda en arco, no en línea recta
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [0, dx], easing: Easing.out(Easing.quad) });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [0, dy], easing: Easing.in(Easing.sin) });
  const scale = p.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, escalaFinal * 1.14, escalaFinal] });
  const halo = p.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.55, 0] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: 'absolute',
          left: origen.x,
          top: origen.y,
          width: s0,
          height: s0,
          transform: [{ translateX }, { translateY }, { scale }],
        }}
      >
        <Animated.View style={[styles.halo, { width: s0 + 18, height: s0 + 18, borderRadius: (s0 + 18) / 2, left: -9, top: -9, opacity: halo }]} />
        <View style={[styles.circulo, { width: s0, height: s0, borderRadius: s0 / 2 }]}>
          {foto
            ? <Image source={{ uri: foto }} style={{ width: '100%', height: '100%' }} />
            : <MaterialCommunityIcons name={icono || 'account'} size={s0 * 0.62} color="#374151" />}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  circulo: { backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  halo: { position: 'absolute', backgroundColor: colors.ok },
});
