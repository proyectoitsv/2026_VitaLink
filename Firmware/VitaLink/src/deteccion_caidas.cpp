#include "deteccion_caidas.h"
#include "servidor_ble.h"

static Adafruit_MPU6050 mpu;

// Estado privado del módulo
static bool mpu_iniciado = false;
static bool posible_caida_libre = false;
static unsigned long tiempo_caida_libre = 0;
static bool estado_alarma = false;
static unsigned long tiempo_inicio_alarma = 0;
static int estado_reposo_boton = HIGH;

void inicializarDetector() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  pinMode(PIN_BOTON, INPUT_PULLUP);
  delay(10);
  estado_reposo_boton = digitalRead(PIN_BOTON);

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

  // 1. MODO ALARMA ACTIVA (esperando reseteo del botón o timeout de 15s)
  if (estado_alarma) {
    bool botonPresionado = (ahora - tiempo_inicio_alarma > 400) && (digitalRead(PIN_BOTON) != estado_reposo_boton);
    bool timeoutAlarma = (ahora - tiempo_inicio_alarma >= 15000);

    if (botonPresionado || timeoutAlarma) {
      estado_alarma = false;
      digitalWrite(PIN_LED, LOW);
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

  // FASE 1: detección de caída libre (ingravidez < 0.6g)
  if (a_res < UMBRAL_CAIDA_LIBRE) {
    posible_caida_libre = true;
    tiempo_caida_libre = ahora;
  }

  // FASE 2: detección de impacto (solo si hubo caída libre previa dentro de los 500ms)
  if (posible_caida_libre && (ahora - tiempo_caida_libre < VENTANA_TIEMPO)) {
    if (a_res > UMBRAL_IMPACTO) {
      estado_alarma = true;
      tiempo_inicio_alarma = ahora;
      digitalWrite(PIN_LED, HIGH);
      enviarAlertaCaidaBLE(true);
      Serial.printf("[Caidas] !!! CAIDA DETECTADA (%.2fg) - ALARMA ACTIVADA !!!\n", a_res);
      posible_caida_libre = false;
    }
  }

  // Cancelar si pasó demasiado tiempo
  if (posible_caida_libre && (ahora - tiempo_caida_libre > VENTANA_TIEMPO)) {
    posible_caida_libre = false;
  }
}
