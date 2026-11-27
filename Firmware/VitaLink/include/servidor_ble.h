#ifndef SERVIDOR_BLE_H
#define SERVIDOR_BLE_H

#include <Arduino.h>

extern bool dispositivoConectado;
extern bool dispositivoDesconectandose;

void inicializarBLE();
void manejarDesconexionBLE();

void enviarLatidosBLE(int bpm);
void enviarOxigenoBLE(int spo2);
void enviarBateriaBLE(int porcentaje, bool cargando);
void enviarAlertaCaidaBLE(bool hayCaida);
void enviarAlertaSOSBLE(bool presionado);
void enviarCancelacionCaidaBLE();
unsigned long tiempoConectadoBLE();   // ms desde que se conecto el celular (0 si no hay)
void anunciarRapidoBLE();                // Volver a anunciarse rapido (hay un S.O.S. esperando celular)
void pedirReinicioPulsera();             // Reinicia la pulsera (en ~0,5 s)
void enviarCalibracionBLE(const uint8_t* datos, size_t longitud);
void procesarComandosBLE();   // Comandos de calibracion recibidos (llamar desde TaskBLE)
void enviarCalibracionMaxBLE(const uint8_t* datos, size_t longitud);   // Onda del pulso para la app
void enviarDiagnosticoTactilBLE(const char* texto);                     // Lecturas del pad S.O.S. (diagnostico)

#endif
