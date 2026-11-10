#ifndef MAX30102_H
#define MAX30102_H

#include <Arduino.h>

bool inicializarSensorMAX();
void dormirSensorMAX();
void despertarSensorMAX();
bool verificarMunecaDestello();
bool estaSensorDormido();
bool hayPulseraPuesta();
int procesarLatidosBPM();
int procesarOxigenoSangre();

#endif // MAX30102_H
