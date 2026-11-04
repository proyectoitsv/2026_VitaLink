#include "deteccion_caidas.h"

static Adafruit_MPU6050 mpu;

// Estado privado del módulo
static bool posible_caida_libre = false;
static unsigned long tiempo_caida_libre = 0;
static bool estado_alarma = false;

void inicializarDetector() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_BOTON, INPUT_PULLUP);

  if (!mpu.begin()) {
    while (1) {
      delay(10);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
}
void detectarCaidas() {
  // 1. MODO ALARMA ACTIVA (esperando reseteo del botón)
  if (estado_alarma) {
    if (digitalRead(PIN_BOTON) == HIGH) {
      estado_alarma = false;
      digitalWrite(PIN_LED, LOW);
      delay(500);
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

  // FASE 1: detección de caída libre
  if (a_res < UMBRAL_CAIDA_LIBRE) {
    posible_caida_libre = true;
    tiempo_caida_libre = millis();
  }

  // FASE 2: detección de impacto
  if (posible_caida_libre && (millis() - tiempo_caida_libre < VENTANA_TIEMPO)) {
    if (a_res > UMBRAL_IMPACTO) {
      estado_alarma = true;
      digitalWrite(PIN_LED, HIGH);
      posible_caida_libre = false;
    }
  }

  // Cancelar si pasó demasiado tiempo
  if (posible_caida_libre && (millis() - tiempo_caida_libre > VENTANA_TIEMPO)) {
    posible_caida_libre = false;
  }

  delay(20);
}
