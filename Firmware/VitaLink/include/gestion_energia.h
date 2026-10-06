/* 
 * Archivo: gestion_energia.h
 * Descripción: DECLARACIÓN de las funciones del módulo de gestión
 * de energía y háptica. Contrato público del módulo.
 */

#ifndef gestion_energia_H
#define gestion_energia_H

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
void leerVoltajeBateria();

// Convierte un voltaje real a porcentaje usando la curva LiPo.
void voltajeAPorcentaje();

// Realiza el mapeo entre voltaje y porcentaje con sus respectivos valores maximos y minimos.
void conversion ();

// Recibe el porcentaje con decimales y lo redondea al múltiplo de 10 más cercano
void redondeoPorcentaje();

// Función que llama a las funciones necesarias para obtener el porcentaje de batería.
int llamarParaPorcentaje();
#endif // FIN DEL MODULO_ENERGIA_H