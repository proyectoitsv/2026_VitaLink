#include "ota.h"
#include <Update.h>

#define TIEMPO_ESPERA_REINICIO_MS 1000

static bool otaEnCurso = false;
static bool reinicioPendiente = false;
static unsigned long tiempoFinOTA = 0;
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
    reinicioPendiente = false;
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

bool finalizarActualizacionOTA() {
    if (!otaEnCurso) {
        return false;
    }

    // Se cierra la escritura y se valida que el archivo esté completo
    if (!Update.end(true)) {
        resetearVariablesOTA();
        return false;
    }

    otaEnCurso = false;
    reinicioPendiente = true;
    tiempoFinOTA = millis();
    return true;
}

void cancelarActualizacionOTA() {
    if (otaEnCurso) {
        Update.abort();
    }
    resetearVariablesOTA();
}

int obtenerProgresoOTA() {
    if (tamanoTotalEsperado == 0) return 0;

    int porcentaje = (int)((bytesRecibidos * 100ULL) / tamanoTotalEsperado);
    if (porcentaje > 100) porcentaje = 100;
    return porcentaje;
}

bool estaActualizandoOTA() {
    return otaEnCurso;
}

void manejarReinicioOTA() {
    // Le damos un segundo de margen antes de reiniciar para no cortar la respuesta BLE
    if (reinicioPendiente && (millis() - tiempoFinOTA >= TIEMPO_ESPERA_REINICIO_MS)) {
        reinicioPendiente = false;
        ESP.restart();
    }
}
