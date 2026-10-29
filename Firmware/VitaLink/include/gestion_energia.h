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
#define PIN_ADC               A3      // Pin del divisor de voltaje 
#define FACTOR_DIVISOR_LIPO   2.005f  // 2 resistencias de 10k calibradas a 4.19V reales

// ---------------------------------------------------------
// DECLARACIÓN DE FUNCIONES PÚBLICAS
// ---------------------------------------------------------

// Inicializa pines, variables y configuración del módulo.
void inicializarModulo();

// Lee el ADC con calibración de fábrica eFuse, sobremuestreo y filtro EMA.
void leerVoltajeBateria();

// Convierte el voltaje real a porcentaje usando la curva LiPo.
void voltajeAPorcentaje();

// Realiza el mapeo entre voltaje y porcentaje con sus respectivos valores máximos y mínimos.
void conversion(float tenMax, float tenMin, int porMax, int porMin);

// Recibe el porcentaje con decimales y lo redondea al múltiplo de 5 más cercano con histéresis.
void redondeoPorcentaje();

// Función que llama a las funciones necesarias para obtener el porcentaje de batería.
int llamarParaPorcentaje();

// Retorna la tensión en voltios medida en el pin ADC.
float obtenerTension();

// Retorna la tensión estimada y filtrada de la celda LiPo (en voltios).
float obtenerTensionLipo();

// Retorna el porcentaje continuo con decimales (0.0% - 100.0%) antes de redondear.
float obtenerPorcentajeBruto();

// Retorna el promedio bruto de cuentas ADC (0 - 4095).
float obtenerTensionBruto();

#endif // FIN DEL MODULO_ENERGIA_H