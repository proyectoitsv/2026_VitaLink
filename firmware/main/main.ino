#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

// Constante universal para el LED de la placa
const int PIN_LED = LED_BUILTIN; 
const int PIN_BOTON = 44; // Pin D7 en XIAO S3 para el reseteo

// --- CALIBRACIÓN DE SENSIBILIDAD ANTI-FALSOS POSITIVOS ---
const float UMBRAL_CAIDA_LIBRE = 0.25; // Umbral de ingravidez (en G)
const float UMBRAL_IMPACTO = 3.25;      // Umbral de golpe seco (en G)
const int VENTANA_TIEMPO = 500;        // Ventana de espera del impacto (en ms)

bool posibleCaidaLibre = false;
unsigned long tiempoCaidaLibre = 0;

// Variable global para "enclavar" el estado del sistema
bool estadoAlarma = false; 

void setup() {
  Serial.begin(115200);
  
  // Configuración del LED interno
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW); // Arranca apagado
  
  // Configuración del Botón con resistencia interna activada
  pinMode(PIN_BOTON, INPUT_PULLUP); 

  if (!mpu.begin()) {
    while (1) delay(10);
  }

  // Aumentamos a 8G para registrar impactos fuertes sin saturar el sensor
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
}

void loop() {
  // =========================================================
  // 1. MODO ALARMA ACTIVA (Esperando reseteo del botón)
  // =========================================================
  if (estadoAlarma == true) {
    if (digitalRead(PIN_BOTON) == HIGH) { 
      Serial.println("--- ALARMA RESETEADA POR EL USUARIO ---");
      estadoAlarma = false;           
      digitalWrite(PIN_LED, LOW);     // Se apaga el LED interno
      delay(500);                     
    }
    return; 
  }

  // =========================================================
  // 2. MODO VIGILANCIA
  // =========================================================
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Conversión a Fuerzas G
  float x_g = a.acceleration.x / 9.81;
  float y_g = a.acceleration.y / 9.81;
  float z_g = a.acceleration.z / 9.81;
  float a_res = sqrt(pow(x_g, 2) + pow(y_g, 2) + pow(z_g, 2));

  // Monitoreo en el Serial Plotter / Serial Monitor
  Serial.print("Eje_X:");     Serial.print(x_g);
  Serial.print("\tEje_Y:");   Serial.print(y_g);
  Serial.print("\tEje_Z:");   Serial.print(z_g);
  Serial.print("\tResultante_G:"); Serial.println(a_res);

  // FASE 1: Detección de caída libre (Ingravidez transitoria)
  if (a_res < UMBRAL_CAIDA_LIBRE) {
    posibleCaidaLibre = true;
    tiempoCaidaLibre = millis();
  }

  // FASE 2: Detección de Impacto dentro de la ventana de tiempo
  if (posibleCaidaLibre && (millis() - tiempoCaidaLibre < VENTANA_TIEMPO)) {
    if (a_res > UMBRAL_IMPACTO) {
      Serial.println("!!! IMPACTO CONFIRMADO - ALARMA ENCLAVADA !!!");
      estadoAlarma = true;           
      digitalWrite(PIN_LED, HIGH);   // Se prende el LED interno
      posibleCaidaLibre = false;     
    }
  }

  // Cancelar si pasó el tiempo y no hubo un golpe en el suelo
  if (posibleCaidaLibre && (millis() - tiempoCaidaLibre > VENTANA_TIEMPO)) {
    posibleCaidaLibre = false;
  }

  delay(20); 
}