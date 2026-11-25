#include "deteccion_caidas.h"
#include "servidor_ble.h"
#include <math.h>
#include <Preferences.h>

// Direcciones I2C posibles del GY-521 (AD0=GND -> 0x68, AD0=VCC -> 0x69)
#define MPU_ADDR_PRIMARIA     0x68
#define MPU_ADDR_SECUNDARIA   0x69

// Registros internos del MPU6050 / MPU6500 (compatibles con clones GY-521 sin restriccion de WHO_AM_I)
#define REG_CONFIG            0x1A
#define REG_ACCEL_CONFIG      0x1C
#define REG_ACCEL_XOUT_H      0x3B
#define REG_PWR_MGMT_1        0x6B
#define REG_PWR_MGMT_2        0x6C
#define REG_SMPLRT_DIV        0x19
#define REG_INT_PIN_CFG       0x37
#define REG_INT_ENABLE        0x38

// Pin INT del MPU6050 (avisa cada muestra nueva, 50 por segundo)
#define PIN_INT_MPU           D0

// Confirmacion de caida: despues del impacto la persona tiene que quedar quieta
#define TIEMPO_REBOTE_MS          500     // Se ignoran los primeros 500 ms despues del impacto

// Valores de fabrica de los parametros (se pueden cambiar desde la app)
static const ConfigCaidas CONFIG_FABRICA = {
  0.66f,   // caidaLibreG
  7.70f,   // impactoG
  400,     // ventanaMinMs: un impacto antes de esto es un gesto del brazo, no una caida
  750,     // ventanaMs (maximo)
  0.10f,   // quietoG
  0.95f,   // proporcionQuieto
  2000     // confirmacionMs
};
static ConfigCaidas cfg = CONFIG_FABRICA;
static bool cfg_cargada = false;

// Rango del acelerometro: +-8 g por eje (4096 cuentas por g). Permite ver golpes de hasta ~10 g.
#define CUENTAS_POR_G         4096.0f

// Modo calibracion: se envian las muestras a la app y las caidas detectadas NO generan alertas reales
#define CALIB_MUESTRAS_POR_PAQUETE  5
#define CALIB_MAX_MS                (10UL * 60UL * 1000UL)  // se apaga solo a los 10 minutos
#define EVENTO_NINGUNO        0
#define EVENTO_CAIDA_LIBRE    1   // valor: aceleracion minima en mg
#define EVENTO_IMPACTO        2   // valor: aceleracion del impacto en mg
#define EVENTO_CONFIRMADA     3   // valor: % de muestras quietas
#define EVENTO_DESCARTADA     4   // valor: % de muestras quietas
#define EVENTO_MUY_RAPIDO     5   // valor: ms desde la caida libre (impacto antes del minimo)
static volatile bool modo_calibracion = false;
static unsigned long inicio_calibracion = 0;
static uint16_t calib_muestras[CALIB_MUESTRAS_POR_PAQUETE];
static uint8_t calib_cantidad = 0;
static uint8_t calib_evento = EVENTO_NINGUNO;
static uint16_t calib_valor = 0;

// Nivel de movimiento de la muñeca (promedio movil de |a - 1g|), lo usa el MAX30102
#define ALFA_MOVIMIENTO           0.10f

static uint8_t mpu_addr = MPU_ADDR_PRIMARIA;
static bool mpu_iniciado = false;
static bool detector_dormido = false;

static bool posible_caida_libre = false;
static unsigned long tiempo_caida_libre = 0;   // momento en que EMPEZO la caida libre
static bool posible_impacto_previo = false;
static unsigned long tiempo_impacto_previo = 0;
static float a_res_anterior = 1.0f;
static bool primera_muestra = true;

// Estado de confirmacion despues de un impacto
static bool confirmando_caida = false;
static unsigned long tiempo_impacto = 0;
static float g_impacto = 0.0f;
static int muestras_confirmacion = 0;
static int muestras_quietas = 0;

static volatile float nivel_movimiento = 0.0f;

static SemaphoreHandle_t sem_muestra_mpu = NULL;
static bool interrupcion_mpu_activa = false;

static bool estado_alarma = false;

// Vibracion de la alarma mientras haya un aviso en curso
static volatile bool aviso_visto = false;

// Aviso en curso (caida o S.O.S.), dura como maximo 30 minutos
#define AVISO_MAX_MS  (30UL * 60UL * 1000UL)
static volatile bool aviso_activo = false;
static unsigned long inicio_aviso = 0;
static unsigned long tiempo_inicio_alarma = 0;
static unsigned long ultimo_intento_init = 0;

static bool escribirRegistroMPU(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return (Wire.endTransmission() == 0);
}

static bool probarDireccionMPU(uint8_t addr) {
  Wire.beginTransmission(addr);
  return (Wire.endTransmission() == 0);
}

static bool configurarHardwareMPU(uint8_t addr) {
  // Despertar chip y usar oscilador interno de 8MHz (0x00 funciona en originales y clones)
  if (!escribirRegistroMPU(addr, REG_PWR_MGMT_1, 0x00)) return false;
  delay(10);
  // Acelerometro activo y giroscopio apagado para ahorrar bateria
  if (!escribirRegistroMPU(addr, REG_PWR_MGMT_2, 0x07)) return false;
  // Filtro pasa-bajos en 44Hz (0x03) para conservar picos de impacto
  escribirRegistroMPU(addr, REG_CONFIG, 0x03);
  // Rango del acelerometro en +-8G (0x10 -> 4096 LSB/g): los golpes fuertes no se saturan
  escribirRegistroMPU(addr, REG_ACCEL_CONFIG, 0x10);
  // 50 muestras por segundo: 1 kHz / (1 + 19)
  escribirRegistroMPU(addr, REG_SMPLRT_DIV, 19);
  // INT activo en alto, push-pull, se mantiene hasta leer cualquier registro (0x30)
  escribirRegistroMPU(addr, REG_INT_PIN_CFG, 0x30);
  // Interrupcion de "dato listo"
  escribirRegistroMPU(addr, REG_INT_ENABLE, 0x01);
  return true;
}

static void IRAM_ATTR isrMuestraMPU() {
  BaseType_t despertar = pdFALSE;
  if (sem_muestra_mpu) xSemaphoreGiveFromISR(sem_muestra_mpu, &despertar);
  if (despertar) portYIELD_FROM_ISR();
}

static void prepararInterrupcionMPU() {
  if (sem_muestra_mpu == NULL) sem_muestra_mpu = xSemaphoreCreateBinary();
  if (!interrupcion_mpu_activa && sem_muestra_mpu != NULL) {
    pinMode(PIN_INT_MPU, INPUT_PULLDOWN);
    attachInterrupt(digitalPinToInterrupt(PIN_INT_MPU), isrMuestraMPU, RISING);
    interrupcion_mpu_activa = true;
  }
}

// Espera la proxima muestra del acelerometro
bool esperarMuestraMPU(uint32_t timeoutMs) {
  if (!interrupcion_mpu_activa || sem_muestra_mpu == NULL) {
    vTaskDelay(pdMS_TO_TICKS(timeoutMs));
    return false;
  }
  return xSemaphoreTake(sem_muestra_mpu, pdMS_TO_TICKS(timeoutMs)) == pdTRUE;
}

float obtenerNivelMovimiento() {
  return detector_dormido ? 0.0f : nivel_movimiento;
}

static bool leerAceleracionG(float &x_g, float &y_g, float &z_g) {
  Wire.beginTransmission(mpu_addr);
  Wire.write(REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  uint8_t recibidos = Wire.requestFrom(mpu_addr, (uint8_t)6, (uint8_t)true);
  if (recibidos != 6) {
    return false;
  }

  int16_t rawX = (int16_t)((Wire.read() << 8) | Wire.read());
  int16_t rawY = (int16_t)((Wire.read() << 8) | Wire.read());
  int16_t rawZ = (int16_t)((Wire.read() << 8) | Wire.read());

  // En rango +-8G la sensibilidad es 4096 LSB/g
  x_g = (float)rawX / CUENTAS_POR_G;
  y_g = (float)rawY / CUENTAS_POR_G;
  z_g = (float)rawZ / CUENTAS_POR_G;
  return true;
}

void dormirDetector() {
  if (mpu_iniciado && !detector_dormido) {
    escribirRegistroMPU(mpu_addr, REG_PWR_MGMT_1, 0x40); // Bit 6 = SLEEP
    posible_caida_libre = false;
    confirmando_caida = false;
    nivel_movimiento = 0.0f;
    posible_impacto_previo = false;
    detector_dormido = true;
  }
}

void despertarDetector() {
  if (mpu_iniciado && detector_dormido) {
    configurarHardwareMPU(mpu_addr);
    posible_caida_libre = false;
    posible_impacto_previo = false;
    primera_muestra = true;
    detector_dormido = false;
  }
}

bool estaDetectorDormido() {
  return detector_dormido;
}

void inicializarDetector() {
  if (!mpu.begin()) {
    Serial.println("Aviso: Sensor MPU6050 no detectado en el bus I2C");
    mpu_iniciado = false;
    return;
  }

  if (!configurarHardwareMPU(mpu_addr)) {
    mpu_iniciado = false;
    return;
  }

  prepararInterrupcionMPU();
  mpu_iniciado = true;
  detector_dormido = false;
  posible_caida_libre = false;
  posible_impacto_previo = false;
  primera_muestra = true;
}

bool hayAlertaCaida() {
  return estado_alarma;
}

void detectarCaidas() {
  if (!mpu_iniciado || detector_dormido) return;

  unsigned long ahora = millis();

  // 1. MODO ALARMA ACTIVA (se resetea automáticamente tras 15s para volver a vigilar)
  if (estado_alarma) {
    if (ahora - tiempo_inicio_alarma >= 15000) {
      estado_alarma = false;
      enviarAlertaCaidaBLE(false);
    }
    return;
  }

  // 2. MODO VIGILANCIA
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  float x_g = a.acceleration.x / 9.81;
  float y_g = a.acceleration.y / 9.81;
  float z_g = a.acceleration.z / 9.81;
  float a_res = sqrt(pow(x_g, 2) + pow(y_g, 2) + pow(z_g, 2));

  // FASE 1: detección de inicio de caída libre (ingravidez < 0.6g)
  if (a_res < UMBRAL_CAIDA_LIBRE) {
    if (!posible_caida_libre) {
      posible_caida_libre = true;
      tiempo_caida_libre = ahora;
    }
  }

  // FASE 2: detección de impacto dentro de la ventana real [250ms, 700ms]
  if (posible_caida_libre) {
    unsigned long tiempoTranscurrido = ahora - tiempo_caida_libre;

    if (a_res > UMBRAL_IMPACTO) {
      if (tiempoTranscurrido >= VENTANA_MIN_TIEMPO && tiempoTranscurrido <= VENTANA_MAX_TIEMPO) {
        estado_alarma = true;
        tiempo_inicio_alarma = ahora;
        enviarAlertaCaidaBLE(true);
        Serial.printf("[Caidas] !!! CAIDA DETECTADA (%.2fg en %lums) - ALARMA ACTIVADA !!!\n", a_res, tiempoTranscurrido);
      }
      // Si el golpe ocurrió antes del tiempo mínimo (sacudida rápida de muñeca), se descarta
      posible_caida_libre = false;
    } else if (tiempoTranscurrido > VENTANA_MAX_TIEMPO) {
      // Cancelar si pasó el tiempo máximo sin impacto
      posible_caida_libre = false;
    }
  }
}
