#ifndef DETECCION_CAIDAS_H
#define DETECCION_CAIDAS_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Pines
const int PIN_LED = LED_BUILTIN;
const int PIN_BOTON = 44; // D7 en XIAO ESP32 S3

// Umbrales originales de la rama
const float UMBRAL_CAIDA_LIBRE = 0.6;
const float UMBRAL_IMPACTO = 4.0;
const unsigned long VENTANA_TIEMPO = 500;

// API pública del módulo
void inicializarDetector();
void detectarCaidas();
bool hayAlertaCaida();

#endif // DETECTOR_CAIDAS_H
