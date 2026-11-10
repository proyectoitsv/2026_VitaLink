#include <Arduino.h>
#include <Wire.h>
#include "servidor_ble.h"
#include "ota.h"
#include "gestion_energia.h"
#include "MAX30102.h"

#define TIEMPO_MEDICION_MAX_MS  30000   // 30 segundos midiendo BPM y SpO2
#define TIEMPO_DESCANSO_MAX_MS  120000  // 2 minutos dormido entre mediciones

const char* VERSION_FIRMWARE = "1.0.2";

SemaphoreHandle_t i2cMutex;
volatile bool pulseraEnMuneca = false;

void TaskBLE(void *pvParameters) {
    unsigned long ultimoEnvioBateria = 0;

    while (1) {
        manejarDesconexionBLE();
        manejarReinicioOTA();

        if (dispositivoConectado && !estaActualizandoOTA()) {
            if (millis() - ultimoEnvioBateria >= 5000) {
                ultimoEnvioBateria = millis();
                int bateria = llamarParaPorcentaje();
                enviarBateriaBLE(bateria);
            }
        } else {
            ultimoEnvioBateria = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void TaskMAX30102(void *pvParameters) {
    unsigned long ultimoDestello = 0;
    unsigned long inicioMedicion = 0;
    unsigned long inicioDescanso = 0;
    unsigned long ultimoEnvioBLE = 0;

    while (1) {
        // Si no hay Bluetooth o se esta actualizando por OTA, mantener el sensor apagado
        if (!dispositivoConectado || estaActualizandoOTA()) {
            if (!estaSensorDormido()) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
            }
            pulseraEnMuneca = false;
            inicioDescanso = 0;
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        // Modo dormido: destello infrarrojo de 15ms cada 1 segundo para detectar muñeca
        if (estaSensorDormido()) {
            if (millis() - ultimoDestello >= 1000) {
                ultimoDestello = millis();
                bool detectada = false;

                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    detectada = verificarMunecaDestello();
                    xSemaphoreGive(i2cMutex);
                }

                if (!detectada) {
                    if (pulseraEnMuneca) {
                        enviarLatidosBLE(0);
                        enviarOxigenoBLE(0);
                    }
                    pulseraEnMuneca = false;
                    inicioDescanso = 0; // Para que mida apenas se coloque la pulsera
                } else {
                    pulseraEnMuneca = true;
                    // Si recien se coloco la pulsera o ya cumplio el descanso de 2 min, despertar y medir
                    if (inicioDescanso == 0 || (millis() - inicioDescanso >= TIEMPO_DESCANSO_MAX_MS)) {
                        if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                            despertarSensorMAX();
                            xSemaphoreGive(i2cMutex);
                        }
                        inicioMedicion = millis();
                        ultimoEnvioBLE = millis();
                    }
                }
            }
            vTaskDelay(pdMS_TO_TICKS(100));
        } 
        // Modo despierto: midiendo activamente BPM y SpO2 durante 30 segundos
        else {
            int bpm = 0;
            int spo2 = 0;
            bool siguePuesta = true;

            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                bpm = procesarLatidosBPM();
                spo2 = procesarOxigenoSangre();
                siguePuesta = hayPulseraPuesta();
                xSemaphoreGive(i2cMutex);
            }

            // Si despues de 500ms de despertar se detecta que se quito la pulsera, apagar al instante
            if ((millis() - inicioMedicion > 500) && !siguePuesta) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
                pulseraEnMuneca = false;
                inicioDescanso = 0;
                enviarLatidosBLE(0);
                enviarOxigenoBLE(0);
                continue;
            }

            pulseraEnMuneca = true;

            // Enviar lecturas por BLE cada 1 segundo mientras mide
            if (millis() - ultimoEnvioBLE >= 1000) {
                ultimoEnvioBLE = millis();
                if (bpm > 0) enviarLatidosBLE(bpm);
                if (spo2 > 0) enviarOxigenoBLE(spo2);
            }

            // Cumplidos los 30 segundos de medicion, volver a dormir por 2 minutos
            if (millis() - inicioMedicion >= TIEMPO_MEDICION_MAX_MS) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
                inicioDescanso = millis();
            }

            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
}

void setup() {
    Serial.begin(115200);
    
    // Se inicia el I2C (SDA y SCL por defecto del XIAO ESP32 S3)
    Wire.begin();

    // Crear el Mutex para el I2C
    i2cMutex = xSemaphoreCreateMutex();
    if (i2cMutex == NULL) {
        Serial.println("Error: No se pudo crear el Mutex I2C");
        while (1); // Detener sistema si falla el RTOS
    }

    // Inicializar lectura de bateria
    inicializarModulo();

    // Inicializar sensor MAX30102 (queda dormido por defecto)
    if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
        inicializarSensorMAX();
        xSemaphoreGive(i2cMutex);
    }

    // Inicializar servidor Bluetooth y servicio OTA
    inicializarBLE();

    // Crear tareas en sus respectivos nucleos
    xTaskCreatePinnedToCore(TaskBLE, "TareaBLE", 4096, NULL, 1, NULL, 0);
    xTaskCreatePinnedToCore(TaskMAX30102, "TareaMAX30102", 4096, NULL, 1, NULL, 1);
}

void loop() {
    vTaskDelete(NULL); 
}
