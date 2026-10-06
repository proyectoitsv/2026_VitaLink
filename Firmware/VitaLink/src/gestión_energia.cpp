/* 
 * Archivo: gestión_energia.cpp
 * Descripción: 
 */

#include <Arduino.h>
#include "gestión_energia.h" 


#define Maxima_Tensión 2.1 // Valor de tensión maxima de la bateria.
#define Cambio_de_fase_1 1.95 // Variable que define cuando hacer el primer cambio de fase.
#define Cambio_de_fase_2 1.9 // Variable que define cuando hacer el segundo cambio de fase.
#define Minima_Tensión 1.6 //Valor de tensión minimo de la bateria.

// Variable donde se almacena el valor de tensión entrante.
static float Tensión_bruto;
// Variable donde se almacena el valor de tensión despues de un calculo (dando un valores entre 4.2 y 3.2).
static float Tensión; 
// Variable donde se almacena el porcentaje de bateria.
static float Porcentaje_bruto;
// Variable donde se almacena el porcentaje de bateria redondeado a multiplos de 10.
static float Porcentaje_redondeado;

void inicializarModulo(){
 pinMode(PIN_ADC, INPUT);
}

float leerVoltajeBateria(){
Tensión_bruto = analogRead (PIN_ADC);
Tensión = ((Tensión_bruto/4095.0) * 3.3);
}

float conversión(float tenMax, float tenMin, int porMax, int porMin){
Porcentaje_bruto = porMin + (Tensión - tenMin) * (porMax - porMin) / (tenMax - tenMin);
}

float voltajeAPorcentaje(){
if (Cambio_de_fase_1 < Tensión) return conversión (Maxima_Tensión,Cambio_de_fase_1, 100, 70);
if (Tensión > Cambio_de_fase_2 && Tensión <= Cambio_de_fase_1) return conversión (Cambio_de_fase_1, Cambio_de_fase_2, 69, 55);
if (Tensión <= Cambio_de_fase_2) return conversión (Cambio_de_fase_2, Minima_Tensión, 54, 0);
}

float redondeoPorcentaje(){
Porcentaje_redondeado = round (Porcentaje_bruto/10) * 10;
}

float llamarParaPorcentaje(){
leerVoltajeBateria();
voltajeAPorcentaje();
redondeoPorcentaje();
return Porcentaje_redondeado;
}

