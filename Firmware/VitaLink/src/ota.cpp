#include "ota.h"
#include <Update.h>

static bool otaEnCurso = false;
static size_t tamanoTotalEsperado = 0;
static size_t bytesRecibidos = 0;

static void resetearVariablesOTA() {
    otaEnCurso = false;
    tamanoTotalEsperado = 0;
    bytesRecibidos = 0;
}

bool iniciarActualizacionOTA(size_t tamanoTotal) {
    if (otaEnCurso) {
        Update.abort();
    }

    size_t tamano = (tamanoTotal > 0) ? tamanoTotal : UPDATE_SIZE_UNKNOWN;

    // Se abre la partición de la flash para cargar el nuevo firmware
    if (!Update.begin(tamano, U_FLASH)) {
        resetearVariablesOTA();
        return false;
    }

    otaEnCurso = true;
    tamanoTotalEsperado = tamanoTotal;
    bytesRecibidos = 0;
    return true;
}

bool escribirBloqueOTA(uint8_t* datos, size_t longitud) {
    if (!otaEnCurso || datos == NULL || longitud == 0) {
        return false;
    }

    // Se escribe el paquete recibido directamente en la partición OTA
    size_t escritos = Update.write(datos, longitud);
    if (escritos != longitud) {
        cancelarActualizacionOTA();
        return false;
    }

    bytesRecibidos += escritos;
    return true;
}

void cancelarActualizacionOTA() {
    if (otaEnCurso) {
        Update.abort();
    }
    resetearVariablesOTA();
}
