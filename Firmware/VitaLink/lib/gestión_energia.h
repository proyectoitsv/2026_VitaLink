/* 
 * Archivo: gestión_energia.h
 * Descripción: DECLARACIÓN de las funciones del módulo de gestión
 * de energía y háptica. Contrato público del módulo.
 */

#ifndef gestión_energia_H
#define gestión_energia_H

#include <Arduino.h>

// ---------------------------------------------------------
// CONSTANTES PÚBLICAS 
// ---------------------------------------------------------
#define PIN_ADC     29   // Pin del divisor de voltaje 

// ---------------------------------------------------------
// DECLARACIÓN DE FUNCIONES PÚBLICAS
// ---------------------------------------------------------

// Inicializa pines, variables y configuración del módulo.
void inicializarModulo();

// Lee el ADC y convierte el valor entrante a uno apto para trabajar.
float leerVoltajeBateria();

// Convierte un voltaje real a porcentaje usando la curva LiPo.
float voltajeAPorcentaje(float tenMax, float tenMin, int porMax, int porMin);

// Recibe el porcentaje con decimales y lo redondea al múltiplo de 10 más cercano
float redondePorcentaje();

#endif // FIN DEL MODULO_ENERGIA_H