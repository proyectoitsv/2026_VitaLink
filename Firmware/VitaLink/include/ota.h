#ifndef OTA_H
#define OTA_H

#include <Arduino.h>

#define VERSION_FIRMWARE "1.0.0"

bool iniciarActualizacionOTA(size_t tamanoTotal);
bool escribirBloqueOTA(uint8_t* datos, size_t longitud);
void cancelarActualizacionOTA();

#endif // OTA_H
