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
// Variable donde se almacena el porcentaje de bateria redondeado a multiplos de 5.
static float Porcentaje_redondeado;
// Variable que fuerza la primera lectura del umbral de porcentaje de bateria.
static float Tension_frontera = 0.0;
// Variable que almacena el porcentaje final de la bateria.
static float Porcentaje_final = 0.0;
// Permite la primera lectura de la bateria para establecer el umbral de porcentaje de bateria.
static bool  Primera_lectura = true;
// Variable que define el margen de tolerancia (20 mV) para cambiar el porcentaje de batería.
const float Margen_V = 0.02;   


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
    Porcentaje_redondeado = round(Porcentaje_bruto / 5.0) * 5.0;

    if (Primera_lectura) {
        Porcentaje_final = Porcentaje_redondeado;
        Tension_frontera = Tension;
        Primera_lectura = false;
        return;
    }
    if (Porcentaje_redondeado != Porcentaje_final) {
        if (fabs(Tension - Tension_frontera) >= Margen_V) {
            Porcentaje_final = Porcentaje_redondeado;
            Tension_frontera = Tension; 
        }
    }
}


int llamarParaPorcentaje(){
leerVoltajeBateria();
voltajeAPorcentaje();
redondeoPorcentaje();
return Porcentaje_final;
}

