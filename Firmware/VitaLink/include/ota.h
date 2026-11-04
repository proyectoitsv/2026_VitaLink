#ifndef OTA_H
#define OTA_H

#include <Arduino.h>

extern const char* VERSION_FIRMWARE;

bool iniciarActualizacionOTA(size_t tamanoTotal);
bool escribirBloqueOTA(uint8_t* datos, size_t longitud);
bool finalizarActualizacionOTA();
void cancelarActualizacionOTA();
int obtenerProgresoOTA();
bool estaActualizandoOTA();
void manejarReinicioOTA();

#endif // OTA_H
