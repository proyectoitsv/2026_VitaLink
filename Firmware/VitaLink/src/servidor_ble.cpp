#include "servidor_ble.h"
#include "ota.h"
#include "deteccion_caidas.h"
#include "MAX30102.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_mac.h>
#include <stdlib.h>
#include <string.h>

// UUIDs personalizados para VitaLink
#define SERVICIO_VITALINK_UUID          "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CARACTERISTICA_BPM_UUID         "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CARACTERISTICA_SPO2_UUID        "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define CARACTERISTICA_BAT_UUID         "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define CARACTERISTICA_CAIDA_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26ab"
#define CARACTERISTICA_SOS_UUID         "beb5483e-36e1-4688-b7f5-ea07361b26ac"
#define CARACTERISTICA_OTA_VERSION_UUID "beb5483e-36e1-4688-b7f5-ea07361b26ad"
#define CARACTERISTICA_OTA_CONTROL_UUID "beb5483e-36e1-4688-b7f5-ea07361b26ae"
#define CARACTERISTICA_OTA_DATOS_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26af"
#define CARACTERISTICA_CALIB_DATOS_UUID "beb5483e-36e1-4688-b7f5-ea07361b26b0"  // aceleracion en vivo
#define CARACTERISTICA_CALIB_CONFIG_UUID "beb5483e-36e1-4688-b7f5-ea07361b26b1" // parametros de caidas
#define CARACTERISTICA_MAX_DATOS_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26b2" // onda del pulso en vivo
#define CARACTERISTICA_MAX_CONFIG_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26b3" // parametros del sensor de pulso
#define CARACTERISTICA_TACTIL_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26b4" // diagnostico del pad S.O.S. (texto)

// Potencia de transmision normal (+6 dBm)
#define POTENCIA_BLE_NORMAL ESP_PWR_LVL_P6

bool dispositivoConectado = false;
bool dispositivoDesconectandose = false;

static BLEServer* pServer = NULL;
static BLECharacteristic* pCharBPM = NULL;
static BLECharacteristic* pCharSpO2 = NULL;
static BLECharacteristic* pCharBat = NULL;
static BLECharacteristic* pCharCaida = NULL;
static BLECharacteristic* pCharSOS = NULL;
static BLECharacteristic* pCharOTAVersion = NULL;
static BLECharacteristic* pCharOTAControl = NULL;
static BLECharacteristic* pCharOTADatos = NULL;
static BLECharacteristic* pCharCalibDatos = NULL;
static BLECharacteristic* pCharCalibConfig = NULL;
static BLECharacteristic* pCharMaxDatos = NULL;
static BLECharacteristic* pCharMaxConfig = NULL;
static BLECharacteristic* pCharTactil = NULL;

// Diagnostico del pad S.O.S. (texto corto, entra en un paquete BLE de 20 bytes)
void enviarDiagnosticoTactilBLE(const char* texto) {
    if (pCharTactil == NULL) return;
    pCharTactil->setValue((uint8_t*)texto, strlen(texto));
    if (dispositivoConectado) pCharTactil->notify();
}

// Texto con los parametros del sensor de pulso
static void publicarConfigMax(bool notificar) {
    if (pCharMaxConfig == NULL) return;
    ConfigMAX c = obtenerConfigMAX();
    char texto[160];
    snprintf(texto, sizeof(texto), "led=%u;prom=%u;sens=%.1f;smax=%.1f;amp=%.0f;pulsera=%lu;bmin=%u;bmax=%u;sa=%.1f;sb=%.2f;cal=%d",
             c.led, c.promedio, c.sensBase, c.sensMax, c.amplitudMax, (unsigned long)c.umbralPulsera,
             c.bpmMin, c.bpmMax, c.spo2A, c.spo2B, enCalibracionMAX() ? 1 : 0);
    pCharMaxConfig->setValue((uint8_t*)texto, strlen(texto));
    if (notificar && dispositivoConectado) pCharMaxConfig->notify();
}

// Texto con los parametros actuales: "libre=0.82;impacto=2.00;ventana=800;quieto=0.30;prop=0.70;conf=3000"
static void publicarConfigCaidas(bool notificar) {
    if (pCharCalibConfig == NULL) return;
    ConfigCaidas c = obtenerConfigCaidas();
    char texto[140];
    snprintf(texto, sizeof(texto), "libre=%.2f;impacto=%.2f;vmin=%u;ventana=%u;quieto=%.2f;prop=%.2f;conf=%u;cal=%d",
             c.caidaLibreG, c.impactoG, c.ventanaMinMs, c.ventanaMs, c.quietoG, c.proporcionQuieto, c.confirmacionMs,
             enModoCalibracion() ? 1 : 0);
    pCharCalibConfig->setValue((uint8_t*)texto, strlen(texto));
    if (notificar && dispositivoConectado) pCharCalibConfig->notify();
}

static int ultimoPorcentajeOTA = -1;

// Ahorro de bateria en la radio: conexion lenta y anuncio lento sin celular
#define CONEXION_INTERVALO_MIN   40    // x1,25 ms = 50 ms
#define CONEXION_INTERVALO_MAX   80    // x1,25 ms = 100 ms
#define CONEXION_LATENCIA        3
#define CONEXION_TIMEOUT         600   // x10 ms = 6 s
#define ANUNCIO_RAPIDO_MS        60000UL
static unsigned long inicioAnuncio = 0;
static bool anuncioLento = false;
static volatile bool pedidoAnuncioRapido = false;
static volatile unsigned long pedidoReinicioEn = 0;   // 0 = sin pedido de reinicio

static void configurarAnuncio(bool lento) {
    BLEAdvertising* adv = BLEDevice::getAdvertising();
    adv->stop();
    adv->setMinInterval(lento ? 1600 : 160);   // x0,625 ms: 1 s o 100 ms
    adv->setMaxInterval(lento ? 1760 : 240);
    adv->start();
    anuncioLento = lento;
    if (!lento) inicioAnuncio = millis();
}
static unsigned long instanteConexionBLE = 0;
static bool versionInicialEnviadaBLE = false;

static void enviarEstadoOTABLE(const char* estado) {
    if (dispositivoConectado && pCharOTAControl != NULL) {
        pCharOTAControl->setValue((uint8_t*)estado, strlen(estado));
        pCharOTAControl->notify();
    }
}

class MisCallbacksServidor: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t *param) {
        instanteConexionBLE = millis();
        versionInicialEnviadaBLE = false;
        dispositivoConectado = true;
        // Pedir un intervalo de conexion que gaste menos bateria (el celular puede ajustarlo)
        pServer->updateConnParams(param->connect.remote_bda, CONEXION_INTERVALO_MIN, CONEXION_INTERVALO_MAX,
                                  CONEXION_LATENCIA, CONEXION_TIMEOUT);
        if (pCharOTAVersion != NULL) {
            pCharOTAVersion->setValue((uint8_t*)VERSION_FIRMWARE, strlen(VERSION_FIRMWARE));
        }
        if (pCharOTAControl != NULL) {
            pCharOTAControl->setValue((uint8_t*)"IDLE", 4);
        }
    }
    void onDisconnect(BLEServer* pServer) {
        activarModoCalibracion(false); // si se corta el enlace, la pulsera vuelve al modo normal
        activarCalibracionMAX(false);
        dispositivoConectado = false;
        dispositivoDesconectandose = true;
        if (estaActualizandoOTA()) {
            cancelarActualizacionOTA();
            BLEDevice::setPower(POTENCIA_BLE_NORMAL);
        }
    }
};

class CallbacksOTAControl: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        uint8_t* pData = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();
        if (pData == NULL || len == 0) return;

        char comando[32];
        size_t copiaLen = (len < sizeof(comando) - 1) ? len : (sizeof(comando) - 1);
        memcpy(comando, pData, copiaLen);
        comando[copiaLen] = '\0';

        if (strncmp(comando, "OPEN:", 5) == 0) {
            size_t tamano = (size_t)atol(comando + 5);
            ultimoPorcentajeOTA = 0;
            if (iniciarActualizacionOTA(tamano)) {
                BLEDevice::setPower(ESP_PWR_LVL_P9);
                enviarEstadoOTABLE("READY");
            } else {
                enviarEstadoOTABLE("ERR_BEGIN");
            }
        }
        else if (strncmp(comando, "DONE", 4) == 0) {
            if (finalizarActualizacionOTA()) {
                enviarEstadoOTABLE("OK");
            } else {
                BLEDevice::setPower(POTENCIA_BLE_NORMAL);
                enviarEstadoOTABLE("ERR_END");
            }
        }
        else if (strncmp(comando, "ABORT", 5) == 0) {
            cancelarActualizacionOTA();
            BLEDevice::setPower(POTENCIA_BLE_NORMAL);
            enviarEstadoOTABLE("ABORTED");
        }
    }
};

class CallbacksOTADatos: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        uint8_t* pData = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();

        if (!escribirBloqueOTA(pData, len)) {
            enviarEstadoOTABLE("ERR_WRITE");
            return;
        }

        int progreso = obtenerProgresoOTA();
        if (progreso - ultimoPorcentajeOTA >= 10 || progreso == 100) {
            ultimoPorcentajeOTA = progreso;
            char buffer[16];
            snprintf(buffer, sizeof(buffer), "PROG:%d", progreso);
            enviarEstadoOTABLE(buffer);
        }
    }
};

void inicializarBLE() {
    uint8_t macBase[6];
    if (esp_efuse_mac_get_default(macBase) == ESP_OK) {
        macBase[5] = (uint8_t)(macBase[5] + 2);
        esp_base_mac_addr_set(macBase);
    }

    // Cola para los comandos de la pantalla de calibracion (se procesan en TaskBLE)
    if (colaComandosCalib == NULL) colaComandosCalib = xQueueCreate(6, LARGO_COMANDO_CALIB);

    BLEDevice::init("VitaLink");
    BLEDevice::setPower(POTENCIA_BLE_NORMAL);
    BLEDevice::setMTU(517);

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MisCallbacksServidor());

    // Se reservan 40 handles para soportar todos los buzones de sensores y los 3 de OTA
    BLEService *pService = pServer->createService(BLEUUID(SERVICIO_VITALINK_UUID), 60); // 12 canales: hacen falta ~36

    // Crear los 5 buzones con permisos de Lectura (READ) y Notificación Push (NOTIFY)
    pCharBPM = pService->createCharacteristic(CARACTERISTICA_BPM_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharBPM->addDescriptor(new BLE2902());

    pCharSpO2 = pService->createCharacteristic(CARACTERISTICA_SPO2_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharSpO2->addDescriptor(new BLE2902());

    pCharBat = pService->createCharacteristic(CARACTERISTICA_BAT_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharBat->addDescriptor(new BLE2902());

    pCharCaida = pService->createCharacteristic(CARACTERISTICA_CAIDA_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_WRITE);
    pCharCaida->setCallbacks(new CallbacksCaida());
    pCharCaida->addDescriptor(new BLE2902());

    pCharSOS = pService->createCharacteristic(CARACTERISTICA_SOS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharSOS->addDescriptor(new BLE2902());

    // Buzones para consultar versión y recibir actualización OTA por BLE
    pCharOTAVersion = pService->createCharacteristic(CARACTERISTICA_OTA_VERSION_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharOTAVersion->addDescriptor(new BLE2902());

    pCharOTAControl = pService->createCharacteristic(CARACTERISTICA_OTA_CONTROL_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    pCharOTAControl->addDescriptor(new BLE2902());
    pCharOTAControl->setCallbacks(new CallbacksOTAControl());

    pCharOTADatos = pService->createCharacteristic(CARACTERISTICA_OTA_DATOS_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pCharOTADatos->setCallbacks(new CallbacksOTADatos());

    // Calibracion de la deteccion de caidas (pantalla de la app)
    pCharCalibDatos = pService->createCharacteristic(CARACTERISTICA_CALIB_DATOS_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    pCharCalibDatos->addDescriptor(new BLE2902());
    pCharCalibConfig = pService->createCharacteristic(CARACTERISTICA_CALIB_CONFIG_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    pCharCalibConfig->addDescriptor(new BLE2902());
    pCharCalibConfig->setCallbacks(new CallbacksCalibConfig());

    // Calibracion del sensor de pulso (onda en vivo y parametros)
    pCharMaxDatos = pService->createCharacteristic(CARACTERISTICA_MAX_DATOS_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    pCharMaxDatos->addDescriptor(new BLE2902());
    pCharMaxConfig = pService->createCharacteristic(CARACTERISTICA_MAX_CONFIG_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    pCharMaxConfig->addDescriptor(new BLE2902());
    pCharMaxConfig->setCallbacks(new CallbacksMaxConfig());

    // Diagnostico del tactil: se lee con cualquier app BLE (por ejemplo nRF Connect)
    pCharTactil = pService->createCharacteristic(CARACTERISTICA_TACTIL_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharTactil->addDescriptor(new BLE2902());

    pService->start(); // Abrimos el edificio

    // Asignar los valores iniciales una vez iniciado el servicio y registrados los handles
    pCharOTAVersion->setValue((uint8_t*)VERSION_FIRMWARE, strlen(VERSION_FIRMWARE));
    pCharOTAControl->setValue((uint8_t*)"IDLE", 4);
    publicarConfigCaidas(false);
    publicarConfigMax(false);

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICIO_VITALINK_UUID);
    pAdvertising->setAppearance(192); // Generic Watch
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMaxPreferred(0x12);
    configurarAnuncio(false);
}

void pedirReinicioPulsera() {
    if (pedidoReinicioEn == 0) pedidoReinicioEn = millis() | 1;
}

void manejarDesconexionBLE() {
    if (!dispositivoConectado && dispositivoDesconectandose) {
        delay(500); // Pequeño tiempo para que el hardware se acomode
        pServer->startAdvertising(); 
        dispositivoDesconectandose = false;
    }
    if (dispositivoConectado && !versionInicialEnviadaBLE && (millis() - instanteConexionBLE >= 2500)) {
        versionInicialEnviadaBLE = true;
        if (pCharOTAVersion != NULL) {
            pCharOTAVersion->setValue((uint8_t*)VERSION_FIRMWARE, strlen(VERSION_FIRMWARE));
            pCharOTAVersion->notify();
        }
    }
}

void enviarLatidosBLE(int bpm) {
    if (dispositivoConectado && (millis() - instanteConexionBLE >= 3000)) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", bpm);
        pCharBPM->setValue((uint8_t*)buffer, strlen(buffer));
        pCharBPM->notify(); // Dispara la notificación al celular
    }
}

void enviarOxigenoBLE(int spo2) {
    if (dispositivoConectado && (millis() - instanteConexionBLE >= 3000)) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", spo2);
        pCharSpO2->setValue((uint8_t*)buffer, strlen(buffer));
        pCharSpO2->notify();
    }
}

void enviarBateriaBLE(int porcentaje) {
    if (dispositivoConectado && (millis() - instanteConexionBLE >= 3000)) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", porcentaje);
        pCharBat->setValue((uint8_t*)buffer, strlen(buffer));
        pCharBat->notify();
    }
}

void enviarAlertaCaidaBLE(bool hayCaida) {
    if (dispositivoConectado) {
        char buffer[2];
        snprintf(buffer, sizeof(buffer), "%d", hayCaida ? 1 : 0);
        pCharCaida->setValue((uint8_t*)buffer, strlen(buffer));
        pCharCaida->notify();
    }
}

// "C" = el paciente cancelo la alerta de caida tocando la pulsera
// Paquete de muestras de aceleracion para el grafico en vivo de la app
void enviarCalibracionBLE(const uint8_t* datos, size_t longitud) {
    if (dispositivoConectado && pCharCalibDatos != NULL) {
        pCharCalibDatos->setValue((uint8_t*)datos, longitud);
        pCharCalibDatos->notify();
    }
}

// Paquete con la onda del pulso para el grafico de la app
void enviarCalibracionMaxBLE(const uint8_t* datos, size_t longitud) {
    if (dispositivoConectado && pCharMaxDatos != NULL) {
        pCharMaxDatos->setValue((uint8_t*)datos, longitud);
        pCharMaxDatos->notify();
    }
}

void enviarCancelacionCaidaBLE() {
    if (dispositivoConectado) {
        pCharCaida->setValue((uint8_t*)"C", 1);
        pCharCaida->notify();
    }
}

unsigned long tiempoConectadoBLE() {
    return dispositivoConectado ? millis() - instanteConexionBLE : 0;
}

void anunciarRapidoBLE() {
    pedidoAnuncioRapido = true;   // se aplica en la tarea del Bluetooth
}

void enviarAlertaSOSBLE(bool presionado) {
    if (dispositivoConectado) {
        char buffer[2];
        snprintf(buffer, sizeof(buffer), "%d", presionado ? 1 : 0);
        pCharSOS->setValue((uint8_t*)buffer, strlen(buffer));
        pCharSOS->notify();
    }
}
