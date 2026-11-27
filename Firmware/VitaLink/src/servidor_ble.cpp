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

// Intervalo de conexion segun lo que este pasando: lento en reposo, rapido con alertas o calibracion
#define REPOSO_INTERVALO_MIN     320   // x1,25 ms = 400 ms
#define REPOSO_INTERVALO_MAX     400   // x1,25 ms = 500 ms
#define REPOSO_LATENCIA          2
#define REPOSO_TIMEOUT           600   // x10 ms = 6 s (mas que 2 x 3 x 500 ms)
#define ACTIVA_AL_CONECTAR_MS    20000UL   // la app descubre servicios y se suscribe
#define ACTIVA_DESPUES_MS        10000UL   // sigue rapida un rato despues de una alerta o calibracion
enum ModoConexion { CONEXION_SIN_PEDIR, CONEXION_ACTIVA, CONEXION_REPOSO };
static ModoConexion modoConexion = CONEXION_SIN_PEDIR;
static esp_bd_addr_t direccionCelular;
static unsigned long ultimoMotivoActiva = 0;

static void pedirModoConexion(ModoConexion modo) {
    if (modo == modoConexion || pServer == NULL) return;
    if (modo == CONEXION_ACTIVA) {
        pServer->updateConnParams(direccionCelular, CONEXION_INTERVALO_MIN, CONEXION_INTERVALO_MAX,
                                  CONEXION_LATENCIA, CONEXION_TIMEOUT);
    } else {
        pServer->updateConnParams(direccionCelular, REPOSO_INTERVALO_MIN, REPOSO_INTERVALO_MAX,
                                  REPOSO_LATENCIA, REPOSO_TIMEOUT);
    }
    modoConexion = modo;
}

static void actualizarModoConexion() {
    if (!dispositivoConectado) return;
    // Durante la OTA la app pide prioridad alta: no pisarla
    if (estaActualizandoOTA()) {
        modoConexion = CONEXION_SIN_PEDIR;
        return;
    }
    unsigned long ahora = millis();
    bool motivo = hayAvisoActivo() || enModoCalibracion() || enCalibracionMAX();
    if (motivo) ultimoMotivoActiva = ahora;
    bool activa = motivo || ahora - instanteConexionBLE < ACTIVA_AL_CONECTAR_MS ||
                  (ultimoMotivoActiva != 0 && ahora - ultimoMotivoActiva < ACTIVA_DESPUES_MS);
    pedirModoConexion(activa ? CONEXION_ACTIVA : CONEXION_REPOSO);
}

class MisCallbacksServidor: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer, esp_ble_gatts_cb_param_t *param) {
        instanteConexionBLE = millis();
        versionInicialEnviadaBLE = false;
        dispositivoConectado = true;
        // Al conectar, intervalo normal; despues de un rato sin nada pasa a reposo
        memcpy(direccionCelular, param->connect.remote_bda, sizeof(esp_bd_addr_t));
        modoConexion = CONEXION_SIN_PEDIR;
        ultimoMotivoActiva = 0;
        pedirModoConexion(CONEXION_ACTIVA);
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
        modoConexion = CONEXION_SIN_PEDIR;
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

// Comandos de la app en el canal de caida: V = visto, X = cancelada, R = reiniciar
class CallbacksCaida: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        uint8_t* pData = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();
        if (pData == NULL || len == 0) return;
        if (pData[0] == 'V') {
            detenerVibracionAlarma();
        } else if (pData[0] == 'X') {
            cancelarAlarmaCaida();
        } else if (pData[0] == 'R') {
            // No se reinicia aca: primero hay que responderle a la app que la escritura llego
            pedirReinicioPulsera();
        }
    }
};

// Comandos de calibracion: se encolan y los procesa TaskBLE
#define LARGO_COMANDO_CALIB 128
static QueueHandle_t colaComandosCalib = NULL;

class CallbacksCalibConfig: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        uint8_t* pData = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();
        if (pData == NULL || len == 0 || colaComandosCalib == NULL) return;
        char cmd[LARGO_COMANDO_CALIB];
        size_t n = len < sizeof(cmd) - 1 ? len : sizeof(cmd) - 1;
        memcpy(cmd, pData, n);
        cmd[n] = '\0';
        xQueueSend(colaComandosCalib, cmd, 0); // si la cola esta llena, se descarta (llega otro enseguida)
    }
};

// Comandos del sensor de pulso (con el prefijo M)
class CallbacksMaxConfig: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        uint8_t* pData = pCharacteristic->getData();
        size_t len = pCharacteristic->getLength();
        if (pData == NULL || len == 0 || colaComandosCalib == NULL) return;
        char cmd[LARGO_COMANDO_CALIB];
        size_t n = len < sizeof(cmd) - 2 ? len : sizeof(cmd) - 2;
        cmd[0] = 'M';
        memcpy(cmd + 1, pData, n);
        cmd[n + 1] = '\0';
        xQueueSend(colaComandosCalib, cmd, 0);
    }
};

static void procesarComandoMax(char* cmd) {
    if (strncmp(cmd, "SET ", 4) == 0) {
        ConfigMAX c = obtenerConfigMAX();
        char* par = strtok(cmd + 4, ";");
        while (par != NULL) {
            char* igual = strchr(par, '=');
            if (igual != NULL) {
                *igual = '\0';
                float v = atof(igual + 1);
                if (strcmp(par, "led") == 0) c.led = (uint8_t)v;
                else if (strcmp(par, "prom") == 0) c.promedio = (uint8_t)v;
                else if (strcmp(par, "sens") == 0) c.sensBase = v;
                else if (strcmp(par, "smax") == 0) c.sensMax = v;
                else if (strcmp(par, "amp") == 0) c.amplitudMax = v;
                else if (strcmp(par, "pulsera") == 0) c.umbralPulsera = (uint32_t)v;
                else if (strcmp(par, "bmin") == 0) c.bpmMin = (uint8_t)v;
                else if (strcmp(par, "bmax") == 0) c.bpmMax = (uint8_t)v;
                else if (strcmp(par, "sa") == 0) c.spo2A = v;
                else if (strcmp(par, "sb") == 0) c.spo2B = v;
            }
            par = strtok(NULL, ";");
        }
        aplicarConfigMAX(c);
    } else if (strcmp(cmd, "SAVE") == 0) {
        guardarConfigMAX();
    } else if (strcmp(cmd, "RESET") == 0) {
        restaurarConfigMAX();
    } else if (strcmp(cmd, "STREAM 1") == 0) {
        activarCalibracionMAX(true);
    } else if (strcmp(cmd, "STREAM 0") == 0) {
        activarCalibracionMAX(false);
    }
    publicarConfigMax(true);
}

// Se llama desde TaskBLE: procesa los comandos de calibracion pendientes
void procesarComandosBLE() {
    actualizarModoConexion();
    if (colaComandosCalib == NULL) return;
    char cmd[LARGO_COMANDO_CALIB];
    while (xQueueReceive(colaComandosCalib, cmd, 0) == pdTRUE) {
        if (cmd[0] == 'M') {          // comando del sensor de pulso
            procesarComandoMax(cmd + 1);
            continue;
        }
        if (strncmp(cmd, "SET ", 4) == 0) {
            ConfigCaidas c = obtenerConfigCaidas();
            char* resto = cmd + 4;
            char* par = strtok(resto, ";");
            while (par != NULL) {
                char* igual = strchr(par, '=');
                if (igual != NULL) {
                    *igual = '\0';
                    float v = atof(igual + 1);
                    if (strcmp(par, "libre") == 0) c.caidaLibreG = v;
                    else if (strcmp(par, "impacto") == 0) c.impactoG = v;
                    else if (strcmp(par, "vmin") == 0) c.ventanaMinMs = (uint16_t)v;
                    else if (strcmp(par, "ventana") == 0) c.ventanaMs = (uint16_t)v;
                    else if (strcmp(par, "quieto") == 0) c.quietoG = v;
                    else if (strcmp(par, "prop") == 0) c.proporcionQuieto = v;
                    else if (strcmp(par, "conf") == 0) c.confirmacionMs = (uint16_t)v;
                }
                par = strtok(NULL, ";");
            }
            aplicarConfigCaidas(c);
        } else if (strcmp(cmd, "SAVE") == 0) {
            guardarConfigCaidas();
        } else if (strcmp(cmd, "RESET") == 0) {
            restaurarConfigCaidas();
        } else if (strcmp(cmd, "STREAM 1") == 0) {
            activarModoCalibracion(true);
        } else if (strcmp(cmd, "STREAM 0") == 0) {
            activarModoCalibracion(false);
        }
        publicarConfigCaidas(true); // la app recibe los valores efectivamente aplicados
    }
}

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
    if (pedidoReinicioEn != 0 && millis() - pedidoReinicioEn >= 500) {
        ESP.restart();
    }
    if (!dispositivoConectado && dispositivoDesconectandose) {
        delay(500); // Pequeño tiempo para que el hardware se acomode
        configurarAnuncio(false);   // anuncio rapido para reconectar enseguida
        dispositivoDesconectandose = false;
    }
    // S.O.S. esperando celular: volver al anuncio rapido para que se conecte cuanto antes
    if (pedidoAnuncioRapido) {
        pedidoAnuncioRapido = false;
        if (!dispositivoConectado) configurarAnuncio(false);
    }
    // Sin celular durante un minuto: anunciar mas espaciado para gastar menos
    if (!dispositivoConectado && !anuncioLento && millis() - inicioAnuncio >= ANUNCIO_RAPIDO_MS) {
        configurarAnuncio(true);
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

// Formato: "porcentaje;cargando" (por ejemplo "85;1")
void enviarBateriaBLE(int porcentaje, bool cargando) {
    if (dispositivoConectado && (millis() - instanteConexionBLE >= 3000)) {
        char buffer[12];
        snprintf(buffer, sizeof(buffer), "%d;%d", porcentaje, cargando ? 1 : 0);
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
