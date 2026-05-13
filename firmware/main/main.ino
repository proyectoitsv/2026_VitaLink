#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

// Usamos la constante universal para el LED de la placa
const int PIN_LED = LED_BUILTIN; 
const int PIN_BOTON = 44; // Pin D7 en XIAO S3 para el reseteo

const float UMBRAL_CAIDA_LIBRE = 0.4;
const float UMBRAL_IMPACTO = 2.0;
const int VENTANA_TIEMPO = 500;

bool posibleCaidaLibre = false;
unsigned long tiempoCaidaLibre = 0;

// Variable global para "enclavar" el estado del sistema
bool estadoAlarma = false; 

void setup() {
  Serial.begin(115200);
  
  // Configuración del LED interno
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW); // Nos aseguramos de que arranque apagado
  
  // Configuración del Botón con resistencia interna activada
  pinMode(PIN_BOTON, INPUT_PULLUP); 

  if (!mpu.begin()) {
    while (1) delay(10);
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
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

  float x_g = a.acceleration.x / 9.81;
  float y_g = a.acceleration.y / 9.81;
  float z_g = a.acceleration.z / 9.81;
  float a_res = sqrt(pow(x_g, 2) + pow(y_g, 2) + pow(z_g, 2));

  Serial.print("Eje_X:");
  Serial.print(x_g);
  Serial.print("\tEje_Y:");
  Serial.print(y_g);
  Serial.print("\tEje_Z:");
  Serial.print(z_g);
  Serial.print("\tResultante_G:");
  Serial.println(a_res);

  // FASE 1: Detección de caída libre
  if (a_res < UMBRAL_CAIDA_LIBRE) {
    posibleCaidaLibre = true;
    tiempoCaidaLibre = millis();
  }

  // FASE 2: Detección de Impacto
  if (posibleCaidaLibre && (millis() - tiempoCaidaLibre < VENTANA_TIEMPO)) {
    if (a_res > UMBRAL_IMPACTO) {
      Serial.println("!!! IMPACTO CONFIRMADO - ALARMA ENCLAVADA !!!");
      estadoAlarma = true;           
      digitalWrite(PIN_LED, HIGH);   // Se prende el LED interno al máximo
      posibleCaidaLibre = false;     
    }
  }

  // Cancelar si pasó mucho tiempo
  if (posibleCaidaLibre && (millis() - tiempoCaidaLibre > VENTANA_TIEMPO)) {
    posibleCaidaLibre = false;
  }

  delay(20); 
}