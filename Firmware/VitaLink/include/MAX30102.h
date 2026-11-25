#ifndef MAX30102_H
#define MAX30102_H

#include <Arduino.h>

// Parametros del sensor de pulso (se cambian desde la app)
struct ConfigMAX {
  uint8_t led;            // Intensidad de los LED (0-255, ~0,2 mA por paso)
  uint8_t promedio;       // Muestras promediadas por el sensor: 1, 2, 4, 8 o 16
  float sensBase;         // Caida minima de la señal para contar un latido (cuentas)
  float sensMax;          // Tope de la sensibilidad automatica (cuentas)
  float amplitudMax;      // Una variacion mayor a esto es movimiento, no un latido (cuentas)
  uint32_t umbralPulsera; // Señal infrarroja minima para considerar la pulsera puesta (cuentas)
  uint8_t bpmMin;         // Pulso minimo valido (BPM)
  uint8_t bpmMax;         // Pulso maximo valido (BPM)
  float spo2A;            // SpO2 = A - B * R
  float spo2B;
};

bool inicializarSensorMAX();
void dormirSensorMAX();
void despertarSensorMAX();
bool verificarMunecaDestello();
bool estaSensorDormido();
bool hayPulseraPuesta();
int procesarLatidosBPM();
int procesarOxigenoSangre();

#endif // MAX30102_H
