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

#endif // DETECCION_CAIDAS_H
