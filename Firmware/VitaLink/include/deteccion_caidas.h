#ifndef DETECCION_CAIDAS_H
#define DETECCION_CAIDAS_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Umbrales y ventana de tiempo real (en ms)
const float UMBRAL_CAIDA_LIBRE = 0.6;
const float UMBRAL_IMPACTO = 4.0;
const unsigned long VENTANA_MIN_TIEMPO = 250;
const unsigned long VENTANA_MAX_TIEMPO = 700;

// API pública del módulo
void inicializarDetector();
void dormirDetector();
void despertarDetector();
bool estaDetectorDormido();
void detectarCaidas();
bool hayAlertaCaida();

#endif // DETECCION_CAIDAS_H
