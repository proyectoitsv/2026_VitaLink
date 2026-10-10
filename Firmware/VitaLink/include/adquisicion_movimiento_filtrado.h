/*
 * Archivo: adquisicion_movimiento_filtrado.h
 * Descripcion: DECLARACION del modulo de adquisicion de movimiento.
 * Lee el MPU6050 por I2C, calibra la gravedad y filtra el ruido.
 * Entrega la aceleracion en G lista para el algoritmo de caidas.
 */

#ifndef ADQUISICION_MOVIMIENTO_FILTRADO_H
#define ADQUISICION_MOVIMIENTO_FILTRADO_H

#include <Arduino.h>

// Paquete de datos que devuelve el modulo (todo en G, en reposo |a| = 1G).
typedef struct {
    float x;                  // Aceleracion filtrada eje X
    float y;                  // Aceleracion filtrada eje Y
    float z;                  // Aceleracion filtrada eje Z
    float magnitud_cruda;     // |a| SIN filtrar (sirve para detectar el pico del impacto)
    float magnitud_filtrada;  // |a| filtrada (sirve para caida libre e inmovilidad)
    bool  muestra_nueva;      // true solo si en esta llamada se leyo una muestra nueva
    bool  calibrado;          // true cuando la calibracion de gravedad termino
    bool  sensor_ok;          // false si el MPU6050 no responde por I2C
} DatosMovimiento;

// ---------------------------------------------------------
// FUNCIONES PUBLICAS
// ---------------------------------------------------------

// Inicia I2C, despierta el MPU6050 y arranca la calibracion. Devuelve true si el sensor respondio.
// Si devuelve false no pasa nada grave: actualizarMovimiento() reintenta sola.
bool inicializarMovimiento();

// Reinicia la calibracion de gravedad. La pulsera tiene que estar quieta ~1 segundo.
// (Ej: llamarla cuando esta en el cargador.)
void iniciarCalibracionMovimiento();

// Se llama seguido desde la tarea. No bloquea: si todavia no toca muestrear,
// devuelve el ultimo dato con muestra_nueva = false.
DatosMovimiento actualizarMovimiento();

// Funciones matematicas puras (no tocan hardware, se pueden probar en un compilador online).
float calcularMagnitud(float x, float y, float z);
float aplicarFiltroExponencial(float muestra_nueva, float valor_anterior, float alfa);

#endif // ADQUISICION_MOVIMIENTO_FILTRADO_H
