#ifndef DETECCION_CAIDAS_H
#define DETECCION_CAIDAS_H

#include <Arduino.h>
#include <Wire.h>

// Parametros de la deteccion de caidas (se cambian desde la app)
struct ConfigCaidas {
  float caidaLibreG;        // Por debajo de esto se considera caida libre (g)
  float impactoG;           // Por encima de esto, despues de la caida libre, es un impacto (g)
  uint16_t ventanaMinMs;    // Tiempo minimo desde el inicio de la caida libre hasta el impacto (ms)
  uint16_t ventanaMs;       // Tiempo maximo desde el inicio de la caida libre hasta el impacto (ms)
  float quietoG;            // Despues del impacto, |a - 1g| menor a esto cuenta como "quieto" (g)
  float proporcionQuieto;   // Fraccion de muestras quietas necesaria para confirmar (0 a 1)
  uint16_t confirmacionMs;  // Cuanto se observa despues del impacto antes de decidir (ms)
};

// API pública del módulo
void inicializarDetector();
void dormirDetector();
void despertarDetector();
bool estaDetectorDormido();
void detectarCaidas();
bool hayAlertaCaida();
void cancelarAlarmaCaida();
bool alarmaVibrando();          // true mientras haya un aviso en curso
void detenerVibracionAlarma();  // Un familiar vio la alerta: los pulsos se espacian (no se cortan)
bool avisoVisto();              // true si un familiar ya vio el aviso en curso
void marcarAvisoActivo();       // Se envio un S.O.S.: hay un aviso en curso
bool hayAvisoActivo();          // Hay una caida o un S.O.S. sin cerrar
bool esperarMuestraMPU(uint32_t timeoutMs);   // Espera la interrupcion de muestra nueva (o el tiempo maximo)
uint32_t esperaSugeridaMPU();                 // Corta mientras se mide, larga mientras el MPU vigila solo
float obtenerNivelMovimiento();               // Movimiento de la muñeca en g (promedio de |a - 1g|)

// Calibracion
ConfigCaidas obtenerConfigCaidas();
void aplicarConfigCaidas(const ConfigCaidas &c);  // Aplica al instante (con limites de seguridad)
void guardarConfigCaidas();                       // Guarda en la memoria permanente
void restaurarConfigCaidas();                     // Vuelve a los valores de fabrica
void activarModoCalibracion(bool activo);         // Modo prueba: grafica y no dispara alertas reales
bool enModoCalibracion();

#endif // DETECCION_CAIDAS_H
