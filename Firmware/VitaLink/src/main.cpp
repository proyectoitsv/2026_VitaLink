#include <Arduino.h>
#include "servidor_ble.h"

unsigned long tiempoAnterior = 0;
unsigned long tiempoConexion = 0;
bool estadoAlterno = false;
bool estabaConectado = false;

void setup() {
  Serial.begin(115200);
  inicializarBLE();
}

void loop() {
  manejarDesconexionBLE();

  if (dispositivoConectado) {
    if (!estabaConectado) {
      estabaConectado = true;
      tiempoConexion = millis();
    }

    // Esperar 4 segundos despues de conectar antes de mandar notificaciones 
    // para dejar que el celular negocie el MTU y descubra los servicios sin saturarse.
    if (millis() - tiempoConexion > 4000) {
      if (millis() - tiempoAnterior >= 2000) { // Mandar cada 2 segundos para no saturar
        tiempoAnterior = millis();
        
        int bpm_test = random(60, 100);
        int spo2_test = random(95, 100);
        int bateria_test = random(10, 100);
        
        enviarLatidosBLE(bpm_test);
        enviarOxigenoBLE(spo2_test);
        enviarBateriaBLE(bateria_test);
        
        estadoAlterno = !estadoAlterno;
        enviarAlertaCaidaBLE(estadoAlterno);
        enviarAlertaSOSBLE(!estadoAlterno);
      }
    }
  } else {
    estabaConectado = false;
  }
}