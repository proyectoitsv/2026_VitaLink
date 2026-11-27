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

const char* VERSION_FIRMWARE = "1.0.44";
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
    unsigned long ultimaLecturaBateria = 0;
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
            // La bateria se lee cada 1 s para notar rapido el cargador; se envia cada 5 s
            // o al instante si se enchufo o se desenchufo
            if (SENSAR_BATERIA && (millis() - ultimaLecturaBateria >= 1000)) {
                ultimaLecturaBateria = millis();
                bool cargabaAntes = estaCargando();
                int bateria = llamarParaPorcentaje();
                if (estaCargando() != cargabaAntes || ultimoEnvioBateria == 0 || millis() - ultimoEnvioBateria >= 5000) {
                    ultimoEnvioBateria = millis();
                    enviarBateriaBLE(bateria, estaCargando());
                }
            }
        } else {
            ultimoEnvioBateria = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void TaskMAX30102(void *pvParameters) {
    unsigned long ultimoDestello = 0;
    unsigned long sinMunecaDesde = millis();
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

        // Modo calibracion (pantalla de la app): el sensor mide sin pausas
        if (estaSensorDormido() && enCalibracionMAX()) {
            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                despertarSensorMAX();
                xSemaphoreGive(i2cMutex);
            }
            inicioMedicion = millis();
            ultimoEnvioBLE = millis();
        }

        // Modo dormido: destello infrarrojo cada 1 segundo para detectar muñeca
        if (estaSensorDormido()) {
            // Si hace mas de un minuto que nadie tiene puesta la pulsera, revisar cada 3 s
            unsigned long periodoDestello = (!pulseraEnMuneca && millis() - sinMunecaDesde > SIN_MUNECA_PARA_LENTO_MS)
                                            ? DESTELLO_LENTO_MS : DESTELLO_NORMAL_MS;
            if (millis() - ultimoDestello >= periodoDestello) {
                ultimoDestello = millis();
                bool detectada = false;
                bool destelloEncendido = false;

                // Encender el LED y liberar el I2C durante la espera
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    destelloEncendido = iniciarDestelloMAX();
                    xSemaphoreGive(i2cMutex);
                }
                if (destelloEncendido) {
                    vTaskDelay(pdMS_TO_TICKS(tiempoDestelloMAX()));   // LED encendido solo lo necesario
                    if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                        detectada = leerDestelloMAX();
                        xSemaphoreGive(i2cMutex);
                    }
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
                    sinMunecaDesde = millis();
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

            // El acelerometro avisa si la muñeca se mueve: esas muestras se descartan
            informarMovimientoMAX(obtenerNivelMovimiento() > UMBRAL_MOVIMIENTO_G);

            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                bpm = procesarLatidosBPM();
                spo2 = procesarOxigenoSangre();
                siguePuesta = hayPulseraPuesta();
                xSemaphoreGive(i2cMutex);
            }

            // Si despues de 1000ms de despertar se detecta que se quito la pulsera, apagar al instante
            if ((millis() - inicioMedicion > 1000) && !siguePuesta && !enCalibracionMAX()) {
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

            // Enviar lecturas por BLE cada 1 segundo (-1 mientras se estabiliza)
            if (millis() - ultimoEnvioBLE >= 1000) {
                ultimoEnvioBLE = millis();
                bool descartando = (millis() - inicioMedicion < TIEMPO_DESCARTE_MS);
                enviarLatidosBLE((descartando || bpm <= 0) ? -1 : bpm);
                enviarOxigenoBLE((descartando || spo2 <= 0) ? -1 : spo2);
            }

            // Cumplidos los 30 segundos de medicion, volver a dormir por 2 minutos
            if (millis() - inicioMedicion >= TIEMPO_MEDICION_MAX_MS && !enCalibracionMAX()) {
                if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                    dormirSensorMAX();
                    xSemaphoreGive(i2cMutex);
                }
                inicioDescanso = millis();
            }

            // Esperar la proxima muestra del sensor (interrupcion en D1) en vez de preguntar cada 20 ms
            esperarDatoMAX(40);
        }
    }
}

void TaskMPU6050(void *pvParameters) {
    unsigned long munecaVistaEn = 0;
    esp_task_wdt_add(NULL);
    while (1) {
        esp_task_wdt_reset();
        // Solo detectar caidas con el celular conectado y la pulsera puesta
        if (pulseraEnMuneca || !sensorMAXDisponible()) munecaVistaEn = millis();
        bool puesta = munecaVistaEn != 0 && millis() - munecaVistaEn < GRACIA_SIN_MUNECA_MS;
        if (dispositivoConectado && !estaActualizandoOTA() && (puesta || enModoCalibracion())) {
            // Esperar la interrupcion del MPU en D0: muestra nueva (50 por segundo) o caida libre si esta vigilando solo
            esperarMuestraMPU(esperaSugeridaMPU());
            if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
                if (estaDetectorDormido()) {
                    despertarDetector();
                }
                detectarCaidas();
                xSemaphoreGive(i2cMutex);
            }
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

static void pulsoMotor(int encendidoMs, int apagadoMs) {
    digitalWrite(PIN_MOTOR, HIGH);
    vTaskDelay(pdMS_TO_TICKS(encendidoMs));
    digitalWrite(PIN_MOTOR, LOW);
    vTaskDelay(pdMS_TO_TICKS(apagadoMs));
}

// Pulso de la alarma: se corta antes si llega otro patron
static void pulsoAlarma(int encendidoMs, int apagadoMs) {
    digitalWrite(PIN_MOTOR, HIGH);
    vTaskDelay(pdMS_TO_TICKS(encendidoMs));
    digitalWrite(PIN_MOTOR, LOW);
    for (int t = 0; t < apagadoMs; t += 50) {
        if (patronMotor != MOTOR_NINGUNO || !alarmaVibrando() || estaActualizandoOTA()) return;
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void TaskMotor(void *pvParameters) {
    esp_task_wdt_add(NULL);
    while (1) {
        esp_task_wdt_reset();

        if (estaActualizandoOTA()) {
            digitalWrite(PIN_MOTOR, LOW);
            patronMotor = MOTOR_NINGUNO;
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }

        uint8_t patron = patronMotor;
        patronMotor = MOTOR_NINGUNO;

        // Los avisos de los toques tienen prioridad (son cortos)
        if (patron == MOTOR_TOQUE) {
            pulsoMotor(45, 40);
        } else if (patron == MOTOR_SOS) {
            pulsoMotor(1500, 150);
        } else if (patron == MOTOR_CONFIRMAR) {
            for (int i = 0; i < 3; i++) pulsoMotor(110, 110);
        } else if (patron == MOTOR_ERROR) {
            pulsoMotor(400, 200);
            pulsoMotor(400, 100);
        } else if (alarmaVibrando()) {
            // Aviso en curso: vibrar en pulsos hasta que se cancele
            if (avisoVisto()) pulsoAlarma(200, 2800);
            else pulsoAlarma(400, 600);
        } else {
            digitalWrite(PIN_MOTOR, LOW);
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }
}

// Estado de un pad tactil con su calibracion
struct PadTactil {
    uint8_t pin;
    const char* clave;      // nombre en la memoria permanente
    float base;
    float ultimaGuardada;
    bool tocado;
    uint8_t muestrasArriba; // lecturas seguidas por encima del umbral (antirrebote)
    float baseLibre;        // base sin cargador (de ella salen los umbrales)
    unsigned long tocadoDesde;
    unsigned long ultimoLog; // diagnostico (DEPURAR_TACTIL)
    float maxRel;            // subida maxima desde el ultimo diagnostico
};

// Devuelve true al soltar un toque corto
static bool leerPad(PadTactil &pad, unsigned long &sinTocarDesde, unsigned long ahora, bool enCargador) {
    float v = (float)touchRead(pad.pin);
    // Se saco el cargador: la lectura cae muy por debajo de la base y la base baja de golpe
    if (pad.base > 0 && v < pad.base * CAIDA_BASE_REL) {
        pad.base = v;
        pad.tocado = false;
        pad.muestrasArriba = 0;
        return false;
    }
    float escala = pad.baseLibre > 0 ? pad.baseLibre : pad.base;
    float rel = escala > 0 ? 1.0f + (v - pad.base) / escala : 1.0f;
    // La base sigue lentamente a la humedad y la temperatura
    if (!pad.tocado && rel < UMBRAL_TACTIL_REPOSO) pad.base = pad.base * 0.995f + v * 0.005f;
    if (!enCargador) pad.baseLibre = pad.base;
    // Diagnostico: 5 veces por segundo, lectura, base actual, base sin cargador y cuanto subio
    if (rel > pad.maxRel) pad.maxRel = rel;
    if (DEPURAR_TACTIL && ahora - pad.ultimoLog >= 200) {
        pad.ultimoLog = ahora;
        // Diagnostico del pad S.O.S. por Bluetooth
        if (pad.pin == PIN_TACTIL_SOS) {
            char diag[24];
            float b = escala > 0 ? (pad.base / escala - 1.0f) * 100.0f : 0;
            snprintf(diag, sizeof(diag), "%+.0f/%+.0f B%+.0f T%dC%d", (rel - 1.0f) * 100.0f, (pad.maxRel - 1.0f) * 100.0f,
                     b, pad.tocado ? 1 : 0, enCargador ? 1 : 0);
            enviarDiagnosticoTactilBLE(diag);
        }
        pad.maxRel = 0;
    }

    if (!pad.tocado) {
        pad.muestrasArriba = rel > UMBRAL_TACTIL_TOQUE ? pad.muestrasArriba + 1 : 0;
        if (pad.muestrasArriba >= MUESTRAS_TOQUE_MIN) {
            pad.tocado = true;
            pad.tocadoDesde = ahora;
            pad.muestrasArriba = 0;
        }
    } else if (rel < UMBRAL_TACTIL_SUELTA) {
        pad.tocado = false;
        sinTocarDesde = ahora;
        if (ahora - pad.tocadoDesde <= TOQUE_MAX_MS) return true;
    }
    return false;
}

// Toma la lectura actual como nueva base (cargador recien apoyado). No toca baseLibre.
static void rebasearPad(PadTactil &pad) {
    float suma = 0;
    for (int i = 0; i < 5; i++) {
        suma += touchRead(pad.pin);
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    pad.base = suma / 5.0f;
    pad.tocado = false;
    pad.muestrasArriba = 0;
}

static void calibrarPad(PadTactil &pad, Preferences &prefs) {
    float medida = 0;
    for (int i = 0; i < 20; i++) {
        medida += touchRead(pad.pin);
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    medida /= 20.0f;
    float guardada = prefs.getFloat(pad.clave, 0.0f);
    // Si al encender alguien esta tocando el pad, la medicion sale alta: se usa la guardada
    pad.base = (guardada > 0 && medida > guardada * UMBRAL_TACTIL_TOQUE) ? guardada : medida;
    pad.ultimaGuardada = guardada;
}

void TaskTactil(void *pvParameters) {
    Preferences prefs;
    prefs.begin("tactil", false);

    PadTactil sos = { PIN_TACTIL_SOS, "base_sos", 0, 0, false, 0 };
    PadTactil cancelar = { PIN_TACTIL_CANCELAR, "base_cancelar", 0, 0, false, 0 };
    calibrarPad(sos, prefs);
    calibrarPad(cancelar, prefs);
    sos.baseLibre = sos.base;
    cancelar.baseLibre = cancelar.base;
    baseTactilSOS = sos.base;
    bool enCargador = false;   // el cargador esta apoyado sobre los pads

    unsigned long ultimoGuardado = 0;
    unsigned long sinTocarDesde = millis();
    int toquesSOS = 0;
    unsigned long ultimoToqueSOS = 0;
    unsigned long sosEnviadoEn = 0;
    unsigned long sosPendienteDesde = 0;
    unsigned long ambosTocadosDesde = 0;   // para el reinicio manteniendo los dos pads
    bool reinicioPedido = false;
    unsigned long reinicioArmadoEn = 0;    // vibro avisando el reinicio: se espera que suelten los pads
    // Si la desperto un toque en el pad S.O.S., ese toque cuenta como el primero de los tres
    if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TOUCHPAD) {
        toquesSOS = 1;
        ultimoToqueSOS = millis();
        patronMotor = MOTOR_TOQUE;
        // El dedo que la desperto puede seguir apoyado: al soltarlo no tiene que contar otra vez
        sos.tocado = true;
        sos.tocadoDesde = millis() - TOQUE_MAX_MS - 1;
    }
    esp_task_wdt_add(NULL);

    while (1) {
        esp_task_wdt_reset();
        unsigned long ahora = millis();

        bool toqueSOS = leerPad(sos, sinTocarDesde, ahora, enCargador);
        bool toqueCancelar = leerPad(cancelar, sinTocarDesde, ahora, enCargador);

        // ---- Cargador apoyado: los dos pads suben casi a la vez y no se sueltan ----
        if (sos.tocado && cancelar.tocado) {
            unsigned long primero = min(sos.tocadoDesde, cancelar.tocadoDesde);
            unsigned long ultimo = max(sos.tocadoDesde, cancelar.tocadoDesde);
            if (ultimo - primero <= VENTANA_APOYO_MS && ahora - ultimo >= ESPERA_APOYO_MS) {
                rebasearPad(sos);
                rebasearPad(cancelar);
                enCargador = true;
                ambosTocadosDesde = 0;   // no es el gesto de reinicio
                toqueSOS = toqueCancelar = false;
            }
        }
        // Un solo pad apretado mas de 2 s: es el cargador, no un dedo
        PadTactil* padsTrabados[2] = { &sos, &cancelar };
        for (PadTactil* pad : padsTrabados) {
            if (pad->tocado && !(sos.tocado && cancelar.tocado) && ahora - pad->tocadoDesde >= TIEMPO_PAD_TRABADO_MS) {
                rebasearPad(*pad);
                enCargador = true;
            }
        }
        // Se saco el cargador: las bases volvieron a la normalidad
        if (enCargador && sos.base < sos.baseLibre * 1.05f && cancelar.base < cancelar.baseLibre * 1.05f) {
            enCargador = false;
        }

        if (!estaActualizandoOTA()) {
            // ---- Pad CANCELAR: corta la vibracion y cancela la alerta (pulsera y app) ----
            if (toqueCancelar) {
                // Sin un aviso en curso (caida o S.O.S.), el boton no hace nada: ni vibra ni avisa
                if (hayAvisoActivo()) {
                    cancelarAlarmaCaida();
                    enviarCancelacionCaidaBLE();   // la app cierra la alerta activa
                    patronMotor = MOTOR_CONFIRMAR;
                }
                toquesSOS = 0;
            }

            // ---- Pad S.O.S.: tres toques seguidos piden ayuda ----
            if (toqueSOS && !alarmaVibrando()) {
                if (ahora - ultimoToqueSOS > VENTANA_ENTRE_TOQUES_MS) toquesSOS = 0;
                toquesSOS++;
                ultimoToqueSOS = ahora;

                if (toquesSOS < TOQUES_SOS) {
                    patronMotor = MOTOR_TOQUE;
                } else {
                    toquesSOS = 0;
                    if (dispositivoConectado) {
                        enviarAlertaSOSBLE(true);
                        marcarAvisoActivo();       // el boton Cancelar ya puede cerrarlo
                        sosEnviadoEn = ahora;
                        patronMotor = MOTOR_SOS;
                    } else {
                        // Sin celular: queda pendiente y se envia apenas se conecte
                        sosPendiente = true;
                        sosPendienteDesde = ahora;
                        anunciarRapidoBLE();
                        patronMotor = MOTOR_ERROR;
                    }
                }
            }
        }

        // Reinicio: mantener los dos pads 5 segundos y soltarlos
        if (sos.tocado && cancelar.tocado && !estaActualizandoOTA() && !reinicioPedido) {
            if (ambosTocadosDesde == 0) ambosTocadosDesde = ahora;
            if (reinicioArmadoEn == 0 && ahora - ambosTocadosDesde >= TIEMPO_REINICIO_TACTIL_MS) {
                reinicioArmadoEn = ahora;
                toquesSOS = 0;
                patronMotor = MOTOR_SOS;            // vibracion larga = solta los pads para reiniciar
            }
        } else {
            ambosTocadosDesde = 0;
        }
        if (reinicioArmadoEn != 0 && !reinicioPedido) {
            if (!sos.tocado && !cancelar.tocado) {
                vTaskDelay(pdMS_TO_TICKS(300));
                pedirReinicioPulsera();
                reinicioPedido = true;   // no repetir mientras se espera el reinicio
            } else if (ahora - reinicioArmadoEn >= ESPERA_SOLTAR_MS) {
                rebasearPad(sos);
                rebasearPad(cancelar);
                enCargador = true;
                reinicioArmadoEn = 0;
                ambosTocadosDesde = 0;
            }
        }

        // S.O.S. pendiente: enviarlo cuando la app ya este escuchando, o descartarlo si paso mucho
        if (sosPendiente) {
            if (dispositivoConectado && tiempoConectadoBLE() >= SOS_ESPERA_CONEXION_MS && !estaActualizandoOTA()) {
                sosPendiente = false;
                enviarAlertaSOSBLE(true);
                marcarAvisoActivo();
                sosEnviadoEn = ahora;
                patronMotor = MOTOR_SOS;
            } else if (ahora - sosPendienteDesde >= SOS_PENDIENTE_MAX_MS) {
                sosPendiente = false;
            }
        }

        // Si pasa demasiado tiempo entre toques, la cuenta vuelve a cero
        if (toquesSOS > 0 && ahora - ultimoToqueSOS > VENTANA_ENTRE_TOQUES_MS) toquesSOS = 0;

        // Volver el S.O.S. a 0 para que se pueda enviar otro mas adelante
        if (sosEnviadoEn != 0 && ahora - sosEnviadoEn >= 2000) {
            enviarAlertaSOSBLE(false);
            sosEnviadoEn = 0;
        }

        // Guardar la calibracion cuando lleva un minuto sin tocarse y cambio lo suficiente
        if (!enCargador && !sos.tocado && !cancelar.tocado && ahora - sinTocarDesde > 60000UL &&
            (ultimoGuardado == 0 || ahora - ultimoGuardado > TACTIL_GUARDAR_CADA_MS)) {
            PadTactil* pads[2] = { &sos, &cancelar };
            for (PadTactil* pad : pads) {
                bool cambio = pad->ultimaGuardada <= 0 ||
                              fabsf(pad->base - pad->ultimaGuardada) / pad->ultimaGuardada > TACTIL_CAMBIO_MIN;
                if (cambio) {
                    prefs.putFloat(pad->clave, pad->base);
                    pad->ultimaGuardada = pad->base;
                }
            }
            ultimoGuardado = ahora;
        }

        // Sin celular los pads se leen mas despacio
        vTaskDelay(pdMS_TO_TICKS((dispositivoConectado || toquesSOS > 0) ? PERIODO_TACTIL_MS : 50));
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
        while (1); // Detener sistema si falla el RTOS
    }

    // Inicializar lectura de bateria
    if (SENSAR_BATERIA) {
        inicializarModulo();
    }

    // Inicializar sensor MAX30102 y detector de caidas MPU6050
    if (xSemaphoreTake(i2cMutex, portMAX_DELAY) == pdTRUE) {
        inicializarSensorMAX();
        inicializarDetector();
        xSemaphoreGive(i2cMutex);
    }

    // Inicializar servidor Bluetooth y servicio OTA
    inicializarBLE();

    // Inicializar pin del motor vibrador
    pinMode(PIN_MOTOR, OUTPUT);
    digitalWrite(PIN_MOTOR, LOW);

    // Crear tareas en sus respectivos nucleos
    xTaskCreatePinnedToCore(TaskBLE, "TareaBLE", 6144, NULL, 1, NULL, 0); // mas pila: procesa los comandos de calibracion
    xTaskCreatePinnedToCore(TaskMAX30102, "TareaMAX30102", 4096, NULL, 1, NULL, 1);
    xTaskCreatePinnedToCore(TaskMPU6050, "TareaMPU6050", 4096, NULL, 1, NULL, 1);
    xTaskCreatePinnedToCore(TaskMotor, "TareaMotor", 2048, NULL, 1, NULL, 0);
    xTaskCreatePinnedToCore(TaskTactil, "TareaTactil", 3072, NULL, 1, NULL, 0);
}

void loop() {
    vTaskDelete(NULL);
}
