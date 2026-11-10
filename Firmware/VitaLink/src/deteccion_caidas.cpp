#include "deteccion_caidas.h"
#include "servidor_ble.h"

static Adafruit_MPU6050 mpu;

// Estado privado del módulo
static bool mpu_iniciado = false;
static bool posible_caida_libre = false;
static unsigned long tiempo_caida_libre = 0;
static bool estado_alarma = false;
static unsigned long tiempo_inicio_alarma = 0;

void inicializarDetector() {
  if (!mpu.begin()) {
    Serial.println("Aviso: Sensor MPU6050 no detectado en el bus I2C");
    mpu_iniciado = false;
    return;
  }

  // Configuración original: Rango 4G y filtro de 21Hz
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  mpu_iniciado = true;
  Serial.println("Sensor MPU6050 inicializado (4G, 21Hz)");
}

bool hayAlertaCaida() {
  return estado_alarma;
}

void detectarCaidas() {
  if (!mpu_iniciado) return;

  unsigned long ahora = millis();

  // 1. MODO ALARMA ACTIVA (se resetea automáticamente tras 15s para volver a vigilar)
  if (estado_alarma) {
    if (ahora - tiempo_inicio_alarma >= 15000) {
      estado_alarma = false;
      enviarAlertaCaidaBLE(false);
      Serial.println("[Caidas] Alarma reseteada");
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
