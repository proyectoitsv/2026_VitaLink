/* 
 * Archivo: gestion_energia.cpp
 * Descripción: 
 */

#include <Arduino.h>
#include "gestion_energia.h" 


#define Maxima_Tension 2.1 // Valor de tensión maxima de la bateria.
#define Cambio_de_fase_1 1.95 // Variable que define cuando hacer el primer cambio de fase.
#define Cambio_de_fase_2 1.9 // Variable que define cuando hacer el segundo cambio de fase.
#define Minima_Tension 1.6 //Valor de tensión minimo de la bateria.

// Variable donde se almacena el valor de tensión entrante.
static float Tension_bruto;
// Variable donde se almacena el valor de tensión despues de un calculo (dando un valores entre 4.2 y 3.2).
static float Tension; 
// Variable donde se almacena el porcentaje de bateria.
static float Porcentaje_bruto;
// Variable donde se almacena el porcentaje de bateria redondeado a multiplos de 10.
static float Porcentaje_redondeado;

void inicializarModulo(){
 pinMode(PIN_ADC, INPUT);
}

void leerVoltajeBateria(){
Tension_bruto = analogRead (PIN_ADC);
Tension = ((Tension_bruto/4095.0) * 3.3);
}

void conversion(float tenMax, float tenMin, int porMax, int porMin){
Porcentaje_bruto = porMin + (Tension - tenMin) * (porMax - porMin) / (tenMax - tenMin);
}

void voltajeAPorcentaje(){
if (Cambio_de_fase_1 < Tension) conversion (Maxima_Tension,Cambio_de_fase_1, 100, 70);
if (Tension > Cambio_de_fase_2 && Tension <= Cambio_de_fase_1) conversion (Cambio_de_fase_1, Cambio_de_fase_2, 69, 55);
if (Tension <= Cambio_de_fase_2) conversion (Cambio_de_fase_2, Minima_Tension, 54, 0);
}

void redondeoPorcentaje(){
Porcentaje_redondeado = round (Porcentaje_bruto/10) * 10;
}

int llamarParaPorcentaje(){
leerVoltajeBateria();
voltajeAPorcentaje();
redondeoPorcentaje();
return Porcentaje_redondeado;
}

