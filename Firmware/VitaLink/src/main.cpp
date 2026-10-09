#include <Arduino.h>
#include "servidor_ble.h"

unsigned long tiempoAnterior = 0;
bool estadoAlterno = false;

void setup() {
  Serial.begin(115200);
  inicializarBLE();
  Serial.println("Servidor BLE Iniciado. Esperando conexion...");
}

void loop() {
  manejarDesconexionBLE();

  if (dispositivoConectado) {
    if (millis() - tiempoAnterior >= 1000) {
      tiempoAnterior = millis();
      
      int bpm_test = random(60, 100);
      int spo2_test = random(95, 100);
      int bateria_test = random(10, 100);
      
      // Enviamos datos de salud cada segundo
      enviarLatidosBLE(bpm_test);
      enviarOxigenoBLE(spo2_test);
      enviarBateriaBLE(bateria_test);
      
      // Simulamos que hay una caida o SOS alternando valores para probar los 5 buzones
      estadoAlterno = !estadoAlterno;
      enviarAlertaCaidaBLE(estadoAlterno);
      enviarAlertaSOSBLE(!estadoAlterno);
      
      Serial.printf("Enviando -> BPM:%d | SpO2:%d | Bat:%d | Caida:%d | SOS:%d\n", 
                    bpm_test, spo2_test, bateria_test, estadoAlterno, !estadoAlterno);
    }
  }
}