/* 
 * Archivo: gestion_energia.cpp
 * Descripción: Módulo de gestión de energía para la medición de batería LiPo en tiempo real
 */

#include <Arduino.h>
#include "gestion_energia.h" 

#define Maxima_Tension      4.20f   // 100% de carga
#define Cambio_de_fase_1    4.00f   // 85% de carga (fin de caída rápida inicial)
#define Cambio_de_fase_2    3.65f   // 20% de carga (inicio de caída acelerada)
#define Minima_Tension      3.20f   // 0% de carga (corte de seguridad)

#define NUM_MUESTRAS_ADC    16      // Cantidad de muestras para promediar el ADC
#define EMA_ALPHA           0.15f   // Factor de suavizado del filtro exponencial (0.0 a 1.0)

// Deteccion de carga (solo con la tension de la bateria)
#define SALTO_CARGA_V       0.040f  // Salto sostenido al enchufar o desenchufar el cargador
#define VENTANA_TENDENCIA   24      // Lecturas para ver la tendencia (24 x 5 s = 2 min)
#define TENDENCIA_CARGA_V   0.015f  // Subida sostenida en la ventana = cargando
#define TENSION_LLENA_V     4.15f   // Cerca de llena la tension casi no cambia
#define PAUSA_MAX_MS        30000UL // Si pasa mas tiempo entre lecturas se reinicia el historial
#define PERIODO_HISTORIAL_MS 5000UL // Cada cuanto se guarda una muestra para la tendencia

static float Tension_bruto         = 0.0f; // Promedio de cuentas ADC (0 - 4095)
static float Tension_pin           = 0.0f; // Tensión medida en el pin del divisor (V)
static float Tension               = 0.0f; // Tensión real filtrada de la batería LiPo (3.2V - 4.2V)
static float Porcentaje_bruto      = 0.0f; // Porcentaje continuo con decimales
static float Porcentaje_redondeado = 0.0f; // Porcentaje redondeado a múltiplos de 5%
static float Tension_frontera      = 0.0f; // Última tensión de referencia para histéresis
static float Porcentaje_final      = 0.0f; // Porcentaje final estabilizado (0 - 100%)
static bool  Primera_lectura       = true; // Bandera para inicializar filtro e histéresis
const float  Margen_V              = 0.02f; // Margen de tolerancia (20 mV) para cambiar el porcentaje

static float Tension_instantanea   = 0.0f; // Ultima tension sin filtrar
static float instantaneas[3];              // Ultimas 3 tensiones sin filtrar
static uint8_t cantInstantaneas    = 0;
static float historialTension[VENTANA_TENDENCIA];
static uint8_t cantHistorial       = 0;
static uint8_t idxHistorial        = 0;
static unsigned long ultimaLectura = 0;
static unsigned long ultimoHistorial = 0;
static bool  Cargando              = false;


void inicializarModulo(){
    pinMode(PIN_ADC, INPUT);
    analogReadResolution(12);
}

void leerVoltajeBateria(){
    long sumaMV  = 0;
    long sumaRaw = 0;

    for (int i = 0; i < NUM_MUESTRAS_ADC; i++) {
        sumaMV  += analogReadMilliVolts(PIN_ADC);
        sumaRaw += analogRead(PIN_ADC);
    }

    Tension_bruto = (float)sumaRaw / (float)NUM_MUESTRAS_ADC;
    float mvPromedio = (float)sumaMV / (float)NUM_MUESTRAS_ADC;
    Tension_pin = mvPromedio / 1000.0f;

    // Tensión instantánea de la lipo
    float tensionInstantanea = Tension_pin * FACTOR_DIVISOR_LIPO;
    Tension_instantanea = tensionInstantanea;

    // Filtro Paso-Bajo Exponencial (EMA)
    if (Primera_lectura) {
        Tension = tensionInstantanea;
    } else {
        Tension = (EMA_ALPHA * tensionInstantanea) + ((1.0f - EMA_ALPHA) * Tension);
    }
}

void conversion(float tenMax, float tenMin, int porMax, int porMin){
    Porcentaje_bruto = (float)porMin + (Tension - tenMin) * (float)(porMax - porMin) / (tenMax - tenMin);

    // Limitar (clamping) estrictamente entre 0% y 100%
    if (Porcentaje_bruto > 100.0f) {
        Porcentaje_bruto = 100.0f;
    } else if (Porcentaje_bruto < 0.0f) {
        Porcentaje_bruto = 0.0f;
    }
}

void voltajeAPorcentaje(){
    if (Tension > Cambio_de_fase_1) {
        conversion(Maxima_Tension, Cambio_de_fase_1, 100, 85);
    } else if (Tension > Cambio_de_fase_2) {
        conversion(Cambio_de_fase_1, Cambio_de_fase_2, 85, 20);
    } else {
        conversion(Cambio_de_fase_2, Minima_Tension, 20, 0);
    }
}

void redondeoPorcentaje(){
    Porcentaje_redondeado = round(Porcentaje_bruto / 5.0f) * 5.0f;

    if (Primera_lectura) {
        Porcentaje_final = Porcentaje_redondeado;
        Tension_frontera = Tension;
        Primera_lectura  = false;
        return;
    }

    if (Porcentaje_redondeado != Porcentaje_final) {
        if (fabs(Tension - Tension_frontera) >= Margen_V) {
            Porcentaje_final = Porcentaje_redondeado;
            Tension_frontera = Tension; 
        }
    }
}

// Detecta si la bateria se esta cargando mirando como cambia su tension
void actualizarEstadoCarga(){
    unsigned long ahora = millis();
    if (ultimaLectura != 0 && ahora - ultimaLectura > PAUSA_MAX_MS) {
        cantInstantaneas = 0;
        cantHistorial = 0;
    }
    ultimaLectura = ahora;

    // Salto sostenido en dos lecturas seguidas: se enchufo o se desenchufo el cargador
    instantaneas[0] = instantaneas[1];
    instantaneas[1] = instantaneas[2];
    instantaneas[2] = Tension_instantanea;
    if (cantInstantaneas < 3) cantInstantaneas++;
    if (cantInstantaneas == 3) {
        float base = instantaneas[0];
        if (instantaneas[1] - base >= SALTO_CARGA_V && instantaneas[2] - base >= SALTO_CARGA_V) Cargando = true;
        else if (base - instantaneas[1] >= SALTO_CARGA_V && base - instantaneas[2] >= SALTO_CARGA_V) Cargando = false;
    }

    // Tendencia de la tension filtrada: descargandose nunca sube
    if (cantHistorial > 0 && ahora - ultimoHistorial < PERIODO_HISTORIAL_MS) return;
    ultimoHistorial = ahora;
    historialTension[idxHistorial] = Tension;
    idxHistorial = (idxHistorial + 1) % VENTANA_TENDENCIA;
    if (cantHistorial < VENTANA_TENDENCIA) cantHistorial++;
    if (cantHistorial == VENTANA_TENDENCIA) {
        float diferencia = Tension - historialTension[idxHistorial];
        if (diferencia >= TENDENCIA_CARGA_V) Cargando = true;
        else if (diferencia <= -TENDENCIA_CARGA_V && Tension < TENSION_LLENA_V) Cargando = false;
    }
}

int llamarParaPorcentaje(){
    leerVoltajeBateria();
    voltajeAPorcentaje();
    redondeoPorcentaje();
    actualizarEstadoCarga();
    return (int)Porcentaje_final;
}

bool estaCargando(){
    return Cargando;
}

float obtenerTension(){
    return Tension_pin;
}

float obtenerTensionLipo(){
    return Tension;
}

float obtenerPorcentajeBruto(){
    return Porcentaje_bruto;
}

float obtenerTensionBruto(){
    return Tension_bruto;
}
