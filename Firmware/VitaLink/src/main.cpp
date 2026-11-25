#include <Arduino.h>
#include <Wire.h>
#include "servidor_ble.h"
#include "ota.h"
#include "gestion_energia.h"
#include "MAX30102.h"
#include "deteccion_caidas.h"
#include <esp_task_wdt.h>
#include <Preferences.h>
#include <esp_sleep.h>

#define TIEMPO_MEDICION_MAX_MS  30000   // 30 segundos midiendo BPM y SpO2
#define TIEMPO_DESCANSO_MAX_MS  15000   // 15 segundos de pausa entre mediciones
#define TIEMPO_DESCARTE_MS      15000   // Primeros 15 segundos de cada medicion se descartan
#define PIN_MOTOR               D6      // GPIO43 en XIAO ESP32-S3
// Pads tactiles (conector J1). Si en la placa estan al reves, intercambiar D9 y D10.
#define PIN_TACTIL_SOS          D9      // Pad de pedido de ayuda (S.O.S.)
#define PIN_TACTIL_CANCELAR     D10     // Pad para cancelar una alarma

// Pads tactiles: toques para pedir ayuda (SOS) y cancelar
#define TOQUES_SOS                3       // Toques seguidos en el pad S.O.S. para pedir ayuda
#define VENTANA_ENTRE_TOQUES_MS   1200    // Tiempo maximo entre un toque y el siguiente
#define MUESTRAS_TOQUE_MIN        2       // Lecturas seguidas (x15 ms) para contar un toque (antirrebote)
#define PERIODO_TACTIL_MS         15      // Cada cuanto se leen los pads
#define UMBRAL_TACTIL_TOQUE       1.10f   // Lectura > base * 1.10 = tocado
#define UMBRAL_TACTIL_SUELTA      1.05f   // Lectura < base * 1.05 = soltado (histeresis)
#define UMBRAL_TACTIL_REPOSO      1.03f   // Solo se ajusta la base con lecturas claramente sin dedo
#define TIEMPO_REINICIO_TACTIL_MS 5000    // Mantener los DOS pads 5 s seguidos reinicia la pulsera
#define DEPURAR_TACTIL            false   // true: envia el diagnostico del pad S.O.S. por Bluetooth
// Cargador: si el pad queda apretado se recalibra la base sin vibrar
#define TOQUE_MAX_MS              1500    // Un toque cuenta al soltar, si duro menos que esto
#define VENTANA_APOYO_MS          120     // Los dos pads se activan juntos: es el cargador
#define ESPERA_SOLTAR_MS          3000    // Tras vibrar el aviso de reinicio, tiempo para soltar los pads
#define ESPERA_APOYO_MS           300     // Se espera a que la lectura se asiente antes de recalibrar
#define TIEMPO_PAD_TRABADO_MS     2000    // Un solo pad apretado mas que esto se recalibra
#define CAIDA_BASE_REL            0.85f   // Lectura < base * 0.85: se saco el cargador

// Patrones del motor vibrador
#define MOTOR_NINGUNO     0
#define MOTOR_CONFIRMAR   1   // 3 pulsos cortos: alarma cancelada
#define MOTOR_ERROR       2   // 2 pulsos medios: S.O.S. sin conexion con el celular
#define MOTOR_TOQUE       3   // Pulso corto: toque registrado
#define MOTOR_SOS         4   // Pulso largo (1,5 s): S.O.S. enviado

#define WDT_TIMEOUT_S     10  // Si una tarea se cuelga mas de 10 s, la pulsera se reinicia sola

// Ahorro de bateria: sin celular duerme y se despierta cada tanto para anunciarse
#define ESPERA_PARA_DORMIR_MS     (5UL * 60UL * 1000UL)  // 5 min sin celular despues de encender
#define VENTANA_DESPIERTA_MS      15000UL                // al despertar: 15 s anunciandose
#define SUENO_PROFUNDO_S          45                     // y despues 45 s durmiendo
#define VENTANA_DESPIERTA_SOS_MS  90000UL                // si la desperto el pad S.O.S.: 90 s

// Sin la pulsera puesta no se detectan caidas
#define GRACIA_SIN_MUNECA_MS      8000UL

// S.O.S. sin celular: queda pendiente y se envia apenas el celular se conecte
#define SOS_PENDIENTE_MAX_MS      (5UL * 60UL * 1000UL)  // despues de 5 min se descarta
#define SOS_ESPERA_CONEXION_MS    3500UL                 // la app tarda en suscribirse al conectarse

// Destello de deteccion de muñeca: cada 1 s, o cada 3 s si hace rato que nadie la usa
#define DESTELLO_NORMAL_MS        1000
#define DESTELLO_LENTO_MS         3000
#define SIN_MUNECA_PARA_LENTO_MS  60000UL

// Con la muñeca moviendose mas que esto (promedio de |a - 1g|) se descartan latidos y SpO2
#define UMBRAL_MOVIMIENTO_G   0.12f

// Calibracion del tactil guardada en la memoria permanente (NVS)
#define TACTIL_GUARDAR_CADA_MS    (10UL * 60UL * 1000UL)  // Como mucho cada 10 min (cuida la flash)
#define TACTIL_CAMBIO_MIN         0.05f                  // Solo se guarda si cambio mas de 5%

const char* VERSION_FIRMWARE = "1.0.41";
const bool SENSAR_BATERIA = true;       // Cambiar a false para deshabilitar el sensado de bateria

SemaphoreHandle_t i2cMutex;
volatile bool pulseraEnMuneca = false;
volatile uint8_t patronMotor = MOTOR_NINGUNO;
volatile bool sosPendiente = false;     // S.O.S. pedido sin celular, esperando conexion
volatile float baseTactilSOS = 0;       // base del pad S.O.S. (para despertar del sueño profundo)

// Reconfigura el watchdog de tareas: si alguna tarea deja de responder, reinicia la pulsera
static void configurarWatchdog() {
    esp_task_wdt_delete(xTaskGetIdleTaskHandleForCPU(0));
    esp_task_wdt_delete(xTaskGetIdleTaskHandleForCPU(1));
    esp_task_wdt_deinit();
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
}

// Entra en sueño profundo: apaga los sensores y el motor, y programa el despertador
static void entrarEnSuenoProfundo() {
    if (xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        dormirSensorMAX();
        dormirDetector();
        xSemaphoreGive(i2cMutex);
    }
    digitalWrite(PIN_MOTOR, LOW);
    // El pad S.O.S. despierta la pulsera
    if (baseTactilSOS > 0) {
        touchSleepWakeUpEnable(PIN_TACTIL_SOS, (touch_value_t)(baseTactilSOS * (UMBRAL_TACTIL_TOQUE - 1.0f)));
    }
    esp_sleep_enable_timer_wakeup((uint64_t)SUENO_PROFUNDO_S * 1000000ULL);
    esp_deep_sleep_start();   // al despertar, la XIAO arranca de nuevo desde setup()
}

void TaskBLE(void *pvParameters) {
    unsigned long ultimoEnvioBateria = 0;
    // Si se desperto de un sueño profundo, solo se queda despierta un rato corto
    esp_sleep_wakeup_cause_t causa = esp_sleep_get_wakeup_cause();
    unsigned long esperaParaDormir = ESPERA_PARA_DORMIR_MS;
    if (causa == ESP_SLEEP_WAKEUP_TIMER) esperaParaDormir = VENTANA_DESPIERTA_MS;
    if (causa == ESP_SLEEP_WAKEUP_TOUCHPAD) esperaParaDormir = VENTANA_DESPIERTA_SOS_MS;
    unsigned long desconectadoDesde = millis();
    esp_task_wdt_add(NULL);

    while (1) {
        esp_task_wdt_reset();
        manejarDesconexionBLE();
        manejarReinicioOTA();
        procesarComandosBLE();   // cambios de calibracion enviados desde la app

        // Dormir si pasa mucho tiempo sin celular (nunca con un S.O.S. pendiente)
        if (dispositivoConectado || estaActualizandoOTA() || sosPendiente) {
            desconectadoDesde = millis();
            esperaParaDormir = ESPERA_PARA_DORMIR_MS;   // la proxima vez, esperar los 5 min completos
        } else if (millis() - desconectadoDesde >= esperaParaDormir) {
            entrarEnSuenoProfundo();
        }

        if (dispositivoConectado && !estaActualizandoOTA()) {
            if (SENSAR_BATERIA && (millis() - ultimoEnvioBateria >= 5000)) {
                ultimoEnvioBateria = millis();
                int bateria = llamarParaPorcentaje();
                enviarBateriaBLE(bateria);
            }
        } else {
            ultimoEnvioBateria = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void TaskMAX30102(void *pvParameters) {
    unsigned long ultimoDestello = 0;
    unsigned long inicioMedicion = 0;
    unsigned long inicioDescanso = 0;
    unsigned long ultimoEnvioBLE = 0;
    esp_task_wdt_add(NULL);

    while (1) {
        esp_task_wdt_reset();
        // Si no hay Bluetooth o se esta actualizando por OTA, mantener el sensor apagado
        if (!dispositivoConectado || estaActualizandoOTA()) {
            if (!estaSensorDormido()) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
            }
            pulseraEnMuneca = false;
            inicioDescanso = 0;
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        // Modo dormido: destello infrarrojo cada 1 segundo para detectar muñeca
        if (estaSensorDormido()) {
            if (millis() - ultimoDestello >= 1000) {
                ultimoDestello = millis();
                bool detectada = false;

                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    detectada = verificarMunecaDestello();
                    xSemaphoreGive(i2cMutex);
                }

                if (!detectada) {
                    if (pulseraEnMuneca) {
                        enviarLatidosBLE(0);
                        enviarOxigenoBLE(0);
                    }
                    pulseraEnMuneca = false;
                    inicioDescanso = 0; // Para que mida apenas se coloque la pulsera
                } else {
                    pulseraEnMuneca = true;
                    // Si recien se coloco la pulsera o ya cumplio el descanso de 2 min, despertar y medir
                    if (inicioDescanso == 0 || (millis() - inicioDescanso >= TIEMPO_DESCANSO_MAX_MS)) {
                        if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                            despertarSensorMAX();
                            xSemaphoreGive(i2cMutex);
                        }
                        inicioMedicion = millis();
                        ultimoEnvioBLE = millis();
                    }
                }
            }
            vTaskDelay(pdMS_TO_TICKS(100));
        } 
        // Modo despierto: midiendo activamente BPM y SpO2 durante 30 segundos
        else {
            int bpm = 0;
            int spo2 = 0;
            bool siguePuesta = true;

            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                bpm = procesarLatidosBPM();
                spo2 = procesarOxigenoSangre();
                siguePuesta = hayPulseraPuesta();
                xSemaphoreGive(i2cMutex);
            }

            // Si despues de 1000ms de despertar se detecta que se quito la pulsera, apagar al instante
            if ((millis() - inicioMedicion > 1000) && !siguePuesta) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
                pulseraEnMuneca = false;
                inicioDescanso = 0;
                enviarLatidosBLE(0);
                enviarOxigenoBLE(0);
                continue;
            }

            pulseraEnMuneca = true;

            // Enviar lecturas por BLE cada 1 segundo mientras mide
            if (millis() - ultimoEnvioBLE >= 1000) {
                ultimoEnvioBLE = millis();
                enviarLatidosBLE(bpm > 0 ? bpm : 0);
                enviarOxigenoBLE(spo2 > 0 ? spo2 : 0);
            }

            // Cumplidos los 30 segundos de medicion, volver a dormir por 2 minutos
            if (millis() - inicioMedicion >= TIEMPO_MEDICION_MAX_MS) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
                inicioDescanso = millis();
            }

            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
}

void TaskMPU6050(void *pvParameters) {
    while (1) {
        if (dispositivoConectado && !estaActualizandoOTA() && (pulseraEnMuneca || hayAlertaCaida())) {
            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                if (estaDetectorDormido()) {
                    despertarDetector();
                }
                detectarCaidas();
                xSemaphoreGive(i2cMutex);
            }
            vTaskDelay(pdMS_TO_TICKS(20));
        } else {
            if (!estaDetectorDormido()) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirDetector();
                    xSemaphoreGive(i2cMutex);
                }
            }
            vTaskDelay(pdMS_TO_TICKS(200));
        }
    }
}

void setup() {
    // Reducir frecuencia del procesador de 240MHz a 80MHz para ahorrar bateria
    setCpuFrequencyMhz(80);

    configurarWatchdog();

    // Se inicia el I2C (SDA y SCL por defecto del XIAO ESP32 S3)
    Wire.begin();

    // Al encender en frio, dar tiempo a que los sensores terminen de arrancar antes de hablarles
    delay(250);

    // Crear el Mutex para el I2C
    i2cMutex = xSemaphoreCreateMutex();
    if (i2cMutex == NULL) {
        Serial.println("Error: No se pudo crear el Mutex I2C");
        while (1); // Detener sistema si falla el RTOS
    }

    // Inicializar lectura de bateria
    inicializarModulo();

    // Inicializar sensor MAX30102 y detector de caidas MPU6050
    if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
        inicializarSensorMAX();
        inicializarDetector();
        xSemaphoreGive(i2cMutex);
    }

    // Inicializar servidor Bluetooth y servicio OTA
    inicializarBLE();

    // Crear tareas en sus respectivos nucleos
    xTaskCreatePinnedToCore(TaskBLE, "TareaBLE", 4096, NULL, 1, NULL, 0);
    xTaskCreatePinnedToCore(TaskMAX30102, "TareaMAX30102", 4096, NULL, 1, NULL, 1);
    xTaskCreatePinnedToCore(TaskMPU6050, "TareaMPU6050", 4096, NULL, 1, NULL, 1);
}

void loop() {
    vTaskDelete(NULL);
}
