#include <Arduino.h>
#include <Wire.h>
#include "servidor_ble.h"
#include "ota.h"

const char* VERSION_FIRMWARE = "1.0.2";

SemaphoreHandle_t i2cMutex;

void TaskBLE(void *pvParameters) {
    while (1) {
        manejarDesconexionBLE();
        manejarReinicioOTA();
        vTaskDelay(pdMS_TO_TICKS(100));
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

    // Inicializar servidor Bluetooth y servicio OTA
    inicializarBLE();

    // Crear tarea de Bluetooth y OTA en el Core 0
    xTaskCreatePinnedToCore(TaskBLE, "TareaBLE", 4096, NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelete(NULL); 
}
