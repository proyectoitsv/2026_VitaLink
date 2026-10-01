#include <Arduino.h>
#include <Wire.h>

SemaphoreHandle_t i2cMutex;

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
}

void loop() {
    vTaskDelete(NULL); 
}