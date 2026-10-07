/*
 * Archivo: adquisicion_movimiento_filtrado.cpp
 * Descripcion: IMPLEMENTACION. Lectura del MPU6050 (solo acelerometro) con Wire,
 * calibracion de gravedad (|a| = 1G en reposo) y filtro pasa-bajos exponencial.
 * Todo sin delay(): el muestreo se controla con millis().
 */

#include "adquisicion_movimiento_filtrado.h"
#include <Wire.h>
#include <math.h>

// ---------------------------------------------------------
// CONSTANTES (nada de numeros sueltos en el codigo)
// ---------------------------------------------------------

// --- I2C ---
#define PIN_I2C_SDA                 SDA        // Pines por defecto de la XIAO. Cambiar si la PCB usa otros
#define PIN_I2C_SCL                 SCL
#define I2C_FRECUENCIA_HZ           400000UL

// --- Registros del MPU6050 ---
#define MPU_DIRECCION_I2C           0x68
#define MPU_REG_CONFIG              0x1A
#define MPU_REG_ACCEL_CONFIG        0x1C
#define MPU_REG_ACCEL_XOUT_H        0x3B
#define MPU_REG_PWR_MGMT_1          0x6B
#define MPU_REG_WHO_AM_I            0x75
#define MPU_WHO_AM_I_ESPERADO       0x68
#define MPU_VALOR_DESPERTAR         0x01       // Sale de sleep y usa el reloj del giroscopio
#define MPU_VALOR_DLPF_94HZ         0x02       // Filtro por hardware, ancho de banda 94 Hz
#define MPU_VALOR_RANGO_8G          0x10       // Rango +-8G (con +-2G el impacto se satura)
#define MPU_LSB_POR_G               4096.0f    // Sensibilidad en +-8G
#define MPU_BYTES_ACELERACION       6          // 2 bytes por eje (X, Y, Z)
#define MPU_TIEMPO_ARRANQUE_MS      100        // Espera (sin bloquear) despues de despertarlo
#define BITS_POR_BYTE               8

// --- Muestreo y filtro ---
#define INTERVALO_MUESTREO_MS       10         // 100 Hz
#define FILTRO_ALFA                 0.25f      // 0 a 1. Mas chico = mas suave pero mas lento (~5 Hz de corte a 100 Hz)
#define FALLAS_LECTURA_MAX          5          // Lecturas seguidas fallidas antes de dar el sensor por caido

// --- Calibracion de gravedad ---
#define CAL_MUESTRAS                100        // 1 segundo quieto a 100 Hz
#define CAL_RUIDO_MAX_G             0.15f      // Si |a| varia mas que esto, se estaba moviendo: reinicia
#define CAL_DESVIO_MAX_G            0.20f      // Si |a| promedio se aleja mas que esto de 1G, algo anda mal
#define GRAVEDAD_OBJETIVO_G         1.0f

// ---------------------------------------------------------
// VARIABLES PRIVADAS
// ---------------------------------------------------------
typedef enum {
    CAL_EN_CURSO,
    CAL_LISTA
} EstadoCalibracion;

static bool              sensor_ok            = false;
static uint32_t          proxima_lectura_ms   = 0;
static uint8_t           fallas_consecutivas  = 0;

static EstadoCalibracion estado_calibracion   = CAL_EN_CURSO;
static float             factor_escala        = 1.0f;
static uint16_t          cal_contador         = 0;
static float             cal_suma             = 0.0f;
static float             cal_minimo           = 0.0f;
static float             cal_maximo           = 0.0f;

static bool              filtro_inicializado  = false;
static float             filtro_x             = 0.0f;
static float             filtro_y             = 0.0f;
static float             filtro_z             = 0.0f;

static DatosMovimiento   ultimo_dato          = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false, false, false};

// ---------------------------------------------------------
// FUNCIONES PRIVADAS (hardware y calibracion)
// ---------------------------------------------------------

static bool escribirRegistro(uint8_t registro, uint8_t valor) {
    Wire.beginTransmission(MPU_DIRECCION_I2C);
    Wire.write(registro);
    Wire.write(valor);
    return (Wire.endTransmission() == 0);
}

static bool leerRegistro(uint8_t registro, uint8_t* valor) {
    Wire.beginTransmission(MPU_DIRECCION_I2C);
    Wire.write(registro);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom((uint8_t)MPU_DIRECCION_I2C, (uint8_t)1) != 1) {
        return false;
    }
    *valor = Wire.read();
    return true;
}

// Configura el MPU6050. Devuelve true si respondio y quedo configurado.
static bool configurarSensor() {
    uint8_t quien_soy = 0;

    if (!leerRegistro(MPU_REG_WHO_AM_I, &quien_soy) || quien_soy != MPU_WHO_AM_I_ESPERADO) {
        return false;
    }
    if (!escribirRegistro(MPU_REG_PWR_MGMT_1, MPU_VALOR_DESPERTAR)) { return false; }
    if (!escribirRegistro(MPU_REG_CONFIG, MPU_VALOR_DLPF_94HZ))     { return false; }
    if (!escribirRegistro(MPU_REG_ACCEL_CONFIG, MPU_VALOR_RANGO_8G)) { return false; }

    // El sensor necesita un rato para estabilizarse: en vez de delay, se posterga la primera lectura.
    proxima_lectura_ms  = millis() + MPU_TIEMPO_ARRANQUE_MS;
    fallas_consecutivas = 0;
    return true;
}

// Lee X, Y, Z en G (sin calibrar). Devuelve false si fallo la comunicacion.
static bool leerAceleracionG(float* x, float* y, float* z) {
    Wire.beginTransmission(MPU_DIRECCION_I2C);
    Wire.write(MPU_REG_ACCEL_XOUT_H);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom((uint8_t)MPU_DIRECCION_I2C, (uint8_t)MPU_BYTES_ACELERACION) != MPU_BYTES_ACELERACION) {
        return false;
    }

    int16_t crudo_x = (int16_t)(((uint16_t)Wire.read() << BITS_POR_BYTE) | Wire.read());
    int16_t crudo_y = (int16_t)(((uint16_t)Wire.read() << BITS_POR_BYTE) | Wire.read());
    int16_t crudo_z = (int16_t)(((uint16_t)Wire.read() << BITS_POR_BYTE) | Wire.read());

    *x = crudo_x / MPU_LSB_POR_G;
    *y = crudo_y / MPU_LSB_POR_G;
    *z = crudo_z / MPU_LSB_POR_G;
    return true;
}

static void reiniciarAcumuladoresCalibracion() {
    cal_contador = 0;
    cal_suma     = 0.0f;
    cal_minimo   = 0.0f;
    cal_maximo   = 0.0f;
}

// Va juntando muestras en reposo. Al terminar calcula el factor que deja |a| = 1G exacto.
// Se usa la magnitud (no cada eje) para que no importe como este puesta la muneca.
static void procesarCalibracion(float magnitud) {
    if (cal_contador == 0) {
        cal_minimo = magnitud;
        cal_maximo = magnitud;
    }
    cal_suma += magnitud;
    cal_contador++;
    if (magnitud < cal_minimo) { cal_minimo = magnitud; }
    if (magnitud > cal_maximo) { cal_maximo = magnitud; }

    // Se movio durante la calibracion: se descarta y se empieza de nuevo.
    if ((cal_maximo - cal_minimo) > CAL_RUIDO_MAX_G) {
        reiniciarAcumuladoresCalibracion();
        return;
    }

    if (cal_contador >= CAL_MUESTRAS) {
        float promedio = cal_suma / cal_contador;
        if (fabsf(promedio - GRAVEDAD_OBJETIVO_G) <= CAL_DESVIO_MAX_G) {
            factor_escala       = GRAVEDAD_OBJETIVO_G / promedio;
            estado_calibracion  = CAL_LISTA;
        } else {
            reiniciarAcumuladoresCalibracion();
        }
    }
}

// ---------------------------------------------------------
// FUNCIONES MATEMATICAS PURAS
// ---------------------------------------------------------

float calcularMagnitud(float x, float y, float z) {
    return sqrtf((x * x) + (y * y) + (z * z));
}

// Filtro exponencial: salida = alfa * nueva + (1 - alfa) * anterior
float aplicarFiltroExponencial(float muestra_nueva, float valor_anterior, float alfa) {
    return (alfa * muestra_nueva) + ((1.0f - alfa) * valor_anterior);
}

// ---------------------------------------------------------
// FUNCIONES PUBLICAS
// ---------------------------------------------------------

bool inicializarMovimiento() {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setClock(I2C_FRECUENCIA_HZ);

    filtro_inicializado = false;
    sensor_ok           = configurarSensor();
    iniciarCalibracionMovimiento();
    return sensor_ok;
}

void iniciarCalibracionMovimiento() {
    estado_calibracion = CAL_EN_CURSO;
    reiniciarAcumuladoresCalibracion();
}

DatosMovimiento actualizarMovimiento() {
    ultimo_dato.muestra_nueva = false;

    uint32_t ahora = millis();
    // Resta con signo para que siga andando cuando millis() da la vuelta (~49 dias).
    if ((int32_t)(ahora - proxima_lectura_ms) < 0) {
        return ultimo_dato;
    }
    proxima_lectura_ms = ahora + INTERVALO_MUESTREO_MS;

    // Si el sensor estaba caido, se reintenta configurarlo en vez de leer.
    if (!sensor_ok) {
        sensor_ok = configurarSensor();
        ultimo_dato.sensor_ok = sensor_ok;
        return ultimo_dato;
    }

    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    if (!leerAceleracionG(&x, &y, &z)) {
        fallas_consecutivas++;
        if (fallas_consecutivas >= FALLAS_LECTURA_MAX) {
            sensor_ok = false;
        }
        ultimo_dato.sensor_ok = sensor_ok;
        return ultimo_dato;
    }
    fallas_consecutivas = 0;

    // La calibracion se hace con el dato sin corregir.
    if (estado_calibracion == CAL_EN_CURSO) {
        procesarCalibracion(calcularMagnitud(x, y, z));
    }

    // Correccion de escala: deja la gravedad en 1G exacto.
    x *= factor_escala;
    y *= factor_escala;
    z *= factor_escala;

    // Filtro pasa-bajos (la primera muestra arranca el filtro para que no parta desde 0).
    if (!filtro_inicializado) {
        filtro_x = x;
        filtro_y = y;
        filtro_z = z;
        filtro_inicializado = true;
    } else {
        filtro_x = aplicarFiltroExponencial(x, filtro_x, FILTRO_ALFA);
        filtro_y = aplicarFiltroExponencial(y, filtro_y, FILTRO_ALFA);
        filtro_z = aplicarFiltroExponencial(z, filtro_z, FILTRO_ALFA);
    }

    ultimo_dato.x                 = filtro_x;
    ultimo_dato.y                 = filtro_y;
    ultimo_dato.z                 = filtro_z;
    ultimo_dato.magnitud_cruda    = calcularMagnitud(x, y, z);
    ultimo_dato.magnitud_filtrada = calcularMagnitud(filtro_x, filtro_y, filtro_z);
    ultimo_dato.muestra_nueva     = true;
    ultimo_dato.calibrado         = (estado_calibracion == CAL_LISTA);
    ultimo_dato.sensor_ok         = sensor_ok;
    return ultimo_dato;
}
