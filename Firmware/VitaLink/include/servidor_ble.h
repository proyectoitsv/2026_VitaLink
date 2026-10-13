#ifndef SERVIDOR_BLE_H
#define SERVIDOR_BLE_H

#include <Arduino.h>

void inicializarBLE();
void manejarDesconexionBLE();

extern bool dispositivoConectado;
extern bool dispositivoDesconectandose;

void inicializarBLE();
void manejarDesconexionBLE();

void enviarLatidosBLE(int bpm);
void enviarOxigenoBLE(int spo2);
void enviarBateriaBLE(int porcentaje);
void enviarAlertaCaidaBLE(bool hayCaida);
void enviarAlertaSOSBLE(bool presionado);

#endif
