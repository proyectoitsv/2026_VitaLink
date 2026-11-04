#include "deteccion_caidas.h"

static Adafruit_MPU6050 mpu;

// Estado privado del módulo
static bool posible_caida_libre = false;
static unsigned long tiempo_caida_libre = 0;
static bool estado_alarma = false;

void inicializarDetector() {
  Serial.begin(115200);

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
