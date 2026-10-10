/*
 * Archivo: adquisicion_movimiento_filtrado.cpp
 * Descripcion: IMPLEMENTACION. Lectura del MPU6050 (solo acelerometro) con Wire,
 * y calibracion de gravedad (|a| = 1G en reposo).
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
#define FALLAS_LECTURA_MAX          5          // Lecturas seguidas fallidas antes de dar el sensor por caido


// ---------------------------------------------------------
// VARIABLES PRIVADAS
// ---------------------------------------------------------
static bool              sensor_ok            = false;
static uint32_t          proxima_lectura_ms   = 0;
static uint8_t           fallas_consecutivas  = 0;

static DatosMovimiento   ultimo_dato          = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false, false};

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

// ---------------------------------------------------------
// FUNCIONES MATEMATICAS PURAS
// ---------------------------------------------------------

float calcularMagnitud(float x, float y, float z) {
    return sqrtf((x * x) + (y * y) + (z * z));
}

// ---------------------------------------------------------
// FUNCIONES PUBLICAS
// ---------------------------------------------------------

bool inicializarMovimiento() {
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    Wire.setClock(I2C_FRECUENCIA_HZ);

    sensor_ok           = configurarSensor();
    return sensor_ok;
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

    ultimo_dato.x                 = x;
    ultimo_dato.y                 = y;
    ultimo_dato.z                 = z;
    ultimo_dato.magnitud_cruda    = calcularMagnitud(x, y, z);
    ultimo_dato.magnitud_filtrada = calcularMagnitud(x, y, z);
    ultimo_dato.muestra_nueva     = true;
    ultimo_dato.sensor_ok         = sensor_ok;
    return ultimo_dato;
}
