#include <Arduino.h>
#include "gestión_energia.h" 

// Variable donde se almacena el valor de tensión entrante.
static float Tensión_bruto;
// Variable donde se almacena el valor de tensión despues de un calculo (dando un valores entre 4.2 y 3.2)
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
return Tensión;
}

