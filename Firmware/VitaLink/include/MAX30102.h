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
bool iniciarDestelloMAX();   // Enciende el LED de deteccion (luego esperar ~170 ms sin tomar el I2C)
bool leerDestelloMAX();      // Lee la muestra, apaga los LEDs y devuelve si la pulsera esta puesta
uint16_t tiempoDestelloMAX(); // Cuanto esperar con el LED encendido (ms)
bool estaSensorDormido();
bool hayPulseraPuesta();
bool sensorMAXDisponible();   // false si el MAX30102 no responde
int procesarLatidosBPM();
void informarMovimientoMAX(bool enMovimiento);  // El acelerometro avisa si la muñeca se esta moviendo
bool esperarDatoMAX(uint32_t timeoutMs);        // Espera la interrupcion de muestra nueva (o el tiempo maximo)
int procesarOxigenoSangre();

// Calibracion
ConfigMAX obtenerConfigMAX();
void aplicarConfigMAX(const ConfigMAX &c);  // Se aplica al sensor en el proximo ciclo de la tarea del MAX
void guardarConfigMAX();
void restaurarConfigMAX();
void activarCalibracionMAX(bool activo);    // Modo prueba: mide sin pausas y envia la onda a la app
bool enCalibracionMAX();

#endif // MAX30102_H
