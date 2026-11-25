#include "MAX30102.h"
#include <Wire.h>
#include "MAX30105.h"
#include "servidor_ble.h"
#include <Preferences.h>

// Parametros configurables desde la app (valores de fabrica)
static const ConfigMAX CONFIG_MAX_FABRICA = {
    165,       // led
    4,         // promedio: 25 muestras/s (40 ms de resolucion para medir cada latido)
    8.0f,      // sensBase
    50.0f,     // sensMax
    1500.0f,   // amplitudMax
    35000,     // umbralPulsera
    40,        // bpmMin
    145,       // bpmMax
    104.0f,    // spo2A
    5.0f       // spo2B
};
static ConfigMAX cfgMax = CONFIG_MAX_FABRICA;
static bool cfgMaxCargada = false;
static volatile bool cfgMaxPendiente = false;   // hay que reconfigurar el sensor (led/promedio)

// El algoritmo usa estos nombres: ahora apuntan a los parametros configurables
#define UMBRAL_PULSERA_PUESTA      ((float)cfgMax.umbralPulsera)
#define CAIDA_MINIMA_IR_BASE       (cfgMax.sensBase)
#define RANGO_CAIDA_MAX_IR         (cfgMax.amplitudMax)
#define MIN_INTERVALO_LATIDO_MS    (60000UL / cfgMax.bpmMax)
#define MAX_INTERVALO_LATIDO_MS    (60000UL / cfgMax.bpmMin)
#define MIN_BPM_VALIDO             (cfgMax.bpmMin)
#define MAX_BPM_VALIDO             (cfgMax.bpmMax)
#define CANTIDAD_LATIDOS_FILTRO    8       // Latidos usados para la mediana
#define TOLERANCIA_LATIDO          0.20f   // Un latido que se aleja mas de 20% de la mediana es atipico
#define ATIPICOS_PARA_REINICIAR    4       // Si hay 4 atipicos seguidos, el ritmo cambio de verdad
#define SUAVIZADO_BPM              0.30f   // Cuanto sigue el valor informado a cada latido nuevo
#define TIEMPO_ESTABILIZACION_MS   4000
#define TIEMPO_VENTANA_MS          2500

// Recuperacion del sensor si no responde o pierde la configuracion
#define REG_MODE_CONFIG            0x09
#define MODO_SPO2                  0x03
#define INTENTOS_INICIO            5
#define INTERVALO_REINTENTO_MS     1000

// Interrupcion del MAX30102 (pin INT del sensor -> D1 de la XIAO, activo en bajo)
#define PIN_INT_MAX                D1

// SpO2: la parte pulsatil se mide como RMS
#define ALFA_LINEA_BASE            0.04f   // Seguimiento lento de la componente continua (DC)
#define MIN_MUESTRAS_SPO2          18      // ~1.5 s de datos validos por ventana
#define SPO2_COEF_A                (cfgMax.spo2A)  // SpO2 = A - B * R  (calibrar contra un oximetro de dedo)
#define SPO2_COEF_B                (cfgMax.spo2B)
#define SPO2_MIN_REPORTE           70      // Ya no se recorta a 90%: una desaturacion real se ve
#define SPO2_MAX_REPORTE           100
#define R_MAXIMO_VALIDO            4.0f    // R mayores son ruido o mala lectura: se descarta la ventana
#define VENTANAS_MEDIANA_SPO2      3       // Mediana de las ultimas 3 ventanas para evitar saltos

static MAX30105 sensor;

static bool sensorIniciado = false;
static unsigned long ultimoReintentoMAX = 0;
static bool sensorDormido = false;
static bool pulseraPuesta = false;
static unsigned long tiempoInicioToque = 0;

static float picoMaximo = 0.0;
static float minimoLocal = 999999.0;
static float ultimoPicoLatido = 0.0;
static float sensibilidadDinamica = CAIDA_MINIMA_IR_BASE;
static bool buscandoPico = true;
static unsigned long tiempoUltimoLatido = 0;
static float ultimosBPM[CANTIDAD_LATIDOS_FILTRO];
static unsigned long idxPico = 0;          // numero de muestra donde esta el pico actual
static float tUltimoLatidoMs = 0.0f;       // momento del ultimo latido, contado en muestras (sin demoras)
static uint8_t latidosGuardados = 0;
static uint8_t atipicosSeguidos = 0;
static float bpmSuavizado = 0.0f;
static byte indiceBPM = 0;
static int bpmPromedio = 0;
static bool primerLatidoDetectado = false;

static float maxIR = 0.0;
static float minIR = 999999.0;
static float maxRed = 0.0;
static float minRed = 999999.0;
static float sumaIR = 0.0;
static float sumaRed = 0.0;
static int muestrasSpO2 = 0;
static int spo2Definitivo = 0;
static unsigned long tiempoInicioVentanaSpO2 = 0;

// SpO2 por RMS + mediana
static float lineaBaseIR = 0.0f;
static float lineaBaseRed = 0.0f;
static float sumaCuadIR = 0.0f;
static float sumaCuadRed = 0.0f;
static int historialSpO2[VENTANAS_MEDIANA_SPO2];
static int cantHistorialSpO2 = 0;
static int indiceHistorialSpO2 = 0;

// Movimiento informado por el acelerometro (se descartan esas muestras)
static volatile bool munecaEnMovimiento = false;

// Interrupcion de dato nuevo del MAX30102
static SemaphoreHandle_t semDatoMAX = NULL;
static bool interrupcionMAXActiva = false;

// Modo calibracion: se envia la onda infrarroja a la app
#define CALIB_MAX_MUESTRAS_POR_PAQUETE  4
#define CALIB_MAX_DURACION_MS           (10UL * 60UL * 1000UL)   // se apaga solo a los 10 minutos
static volatile bool calibMax = false;
static unsigned long inicioCalibMax = 0;
static uint32_t calibMaxMuestras[CALIB_MAX_MUESTRAS_POR_PAQUETE];
static uint8_t calibMaxCantidad = 0;
static uint8_t calibMaxMascara = 0;   // bits 0-3: latido detectado · bits 4-7: latido aceptado
static float ultimoR = 0.0f;

static long ultimoIR = 0;
static long ultimoRed = 0;
static unsigned long idMuestraGlobal = 0;

static uint8_t promedioARegistro(uint8_t n) {
    switch (n) {
        case 1: return 0x00;   // registro FIFO_CONFIG del MAX30102 (bits 7:5)
        case 2: return 0x20;
        case 4: return 0x40;
        case 16: return 0x80;
        default: return 0x60;  // 8 muestras
    }
}

static void cargarConfigMAX() {
    Preferences prefs;
    prefs.begin("max", true);
    ConfigMAX c = CONFIG_MAX_FABRICA;
    c.led = prefs.getUChar("led", c.led);
    c.promedio = prefs.getUChar("prom", c.promedio);
    c.sensBase = prefs.getFloat("sens", c.sensBase);
    c.sensMax = prefs.getFloat("smax", c.sensMax);
    c.amplitudMax = prefs.getFloat("amp", c.amplitudMax);
    c.umbralPulsera = prefs.getULong("pulsera", c.umbralPulsera);
    c.bpmMin = prefs.getUChar("bmin", c.bpmMin);
    c.bpmMax = prefs.getUChar("bmax", c.bpmMax);
    c.spo2A = prefs.getFloat("sa", c.spo2A);
    c.spo2B = prefs.getFloat("sb", c.spo2B);
    prefs.end();
    aplicarConfigMAX(c);
    cfgMaxCargada = true;
}

ConfigMAX obtenerConfigMAX() {
    return cfgMax;
}

static float limitarF(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }

void aplicarConfigMAX(const ConfigMAX &c) {
    ConfigMAX n = c;
    n.led = (uint8_t)limitarF(n.led, 10, 255);
    if (n.promedio != 1 && n.promedio != 2 && n.promedio != 4 && n.promedio != 8 && n.promedio != 16) n.promedio = 8;
    n.sensBase = limitarF(n.sensBase, 1.0f, 200.0f);
    n.sensMax = limitarF(n.sensMax, n.sensBase, 1000.0f);
    n.amplitudMax = limitarF(n.amplitudMax, n.sensBase * 2.0f, 20000.0f);
    n.umbralPulsera = (uint32_t)limitarF((float)n.umbralPulsera, 1000.0f, 250000.0f);
    n.bpmMin = (uint8_t)limitarF(n.bpmMin, 25, 80);
    n.bpmMax = (uint8_t)limitarF(n.bpmMax, 100, 220);
    n.spo2A = limitarF(n.spo2A, 80.0f, 130.0f);
    n.spo2B = limitarF(n.spo2B, 0.0f, 50.0f);
    bool cambiaHardware = (n.led != cfgMax.led) || (n.promedio != cfgMax.promedio);
    cfgMax = n;
    // El I2C no se puede usar desde aca: la tarea del MAX aplica el cambio con el bus tomado
    if (cambiaHardware) cfgMaxPendiente = true;
}

// Aplica LED y promedio al sensor (se llama con el bus I2C tomado)
static void aplicarHardwarePendienteMAX() {
    if (!cfgMaxPendiente || !sensorIniciado) return;
    cfgMaxPendiente = false;
    sensor.setFIFOAverage(promedioARegistro(cfgMax.promedio));
    if (!sensorDormido) {
        sensor.setPulseAmplitudeIR(cfgMax.led);
        sensor.setPulseAmplitudeRed(pulseraPuesta ? cfgMax.led : 0);
    }
}

void guardarConfigMAX() {
    Preferences prefs;
    prefs.begin("max", false);
    prefs.putUChar("led", cfgMax.led);
    prefs.putUChar("prom", cfgMax.promedio);
    prefs.putFloat("sens", cfgMax.sensBase);
    prefs.putFloat("smax", cfgMax.sensMax);
    prefs.putFloat("amp", cfgMax.amplitudMax);
    prefs.putULong("pulsera", cfgMax.umbralPulsera);
    prefs.putUChar("bmin", cfgMax.bpmMin);
    prefs.putUChar("bmax", cfgMax.bpmMax);
    prefs.putFloat("sa", cfgMax.spo2A);
    prefs.putFloat("sb", cfgMax.spo2B);
    prefs.end();
}

void restaurarConfigMAX() {
    aplicarConfigMAX(CONFIG_MAX_FABRICA);
    guardarConfigMAX();
}

void activarCalibracionMAX(bool activo) {
    calibMax = activo;
    inicioCalibMax = millis();
    calibMaxCantidad = 0;
    calibMaxMascara = 0;
}

bool enCalibracionMAX() {
    if (calibMax && millis() - inicioCalibMax >= CALIB_MAX_DURACION_MS) activarCalibracionMAX(false);
    return calibMax;
}

// Junta muestras de la onda y las manda a la app de a 4
static void registrarMuestraCalibMAX(float valorIR, bool latidoDetectado, bool latidoAceptado, int bpmActual) {
    if (!calibMax) return;
    uint32_t v = valorIR < 0 ? 0 : (uint32_t)valorIR;
    if (v > 0xFFFFFF) v = 0xFFFFFF;
    if (latidoDetectado) calibMaxMascara |= (1 << calibMaxCantidad);
    if (latidoAceptado) calibMaxMascara |= (1 << (4 + calibMaxCantidad));
    calibMaxMuestras[calibMaxCantidad++] = v;
    if (calibMaxCantidad < CALIB_MAX_MUESTRAS_POR_PAQUETE) return;

    uint8_t paquete[1 + CALIB_MAX_MUESTRAS_POR_PAQUETE * 3 + 6];
    size_t i = 0;
    paquete[i++] = calibMaxCantidad;
    for (uint8_t k = 0; k < calibMaxCantidad; k++) {
        paquete[i++] = calibMaxMuestras[k] & 0xFF;
        paquete[i++] = (calibMaxMuestras[k] >> 8) & 0xFF;
        paquete[i++] = (calibMaxMuestras[k] >> 16) & 0xFF;
    }
    uint8_t estado = !pulseraPuesta ? 0 : (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS ? 1 : 2);
    uint16_t r = (uint16_t)limitarF(ultimoR * 1000.0f, 0, 65000);
    paquete[i++] = calibMaxMascara;
    paquete[i++] = (uint8_t)(bpmActual > 0 ? bpmActual : 0);
    paquete[i++] = (uint8_t)(spo2Definitivo > 0 ? spo2Definitivo : 0);
    paquete[i++] = estado;
    paquete[i++] = r & 0xFF;
    paquete[i++] = r >> 8;
    enviarCalibracionMaxBLE(paquete, i);
    calibMaxCantidad = 0;
    calibMaxMascara = 0;
}

static void consumirMuestras();

static void resetearVariablesMAX() {
    picoMaximo = 0.0;
    minimoLocal = 999999.0;
    ultimoPicoLatido = 0.0;
    sensibilidadDinamica = CAIDA_MINIMA_IR_BASE;
    bpmPromedio = 0;
    for (byte i = 0 ; i < CANTIDAD_LATIDOS_FILTRO ; i++) ultimosBPM[i] = 0;
    indiceBPM = 0;
    latidosGuardados = 0;
    atipicosSeguidos = 0;
    bpmSuavizado = 0.0f;
    tUltimoLatidoMs = 0.0f;
    buscandoPico = true;
    primerLatidoDetectado = false;
    tiempoUltimoLatido = millis();

    maxIR = 0.0; minIR = 999999.0;
    maxRed = 0.0; minRed = 999999.0;
    sumaIR = 0.0; sumaRed = 0.0;
    muestrasSpO2 = 0;
    spo2Definitivo = 0;
    tiempoInicioVentanaSpO2 = millis();
}

void dormirSensorMAX() {
    if (!sensorDormido) {
        sensor.setPulseAmplitudeRed(0);
        sensor.setPulseAmplitudeIR(0);
        sensor.clearFIFO();
        while (sensor.available()) {
            sensor.nextSample();
        }
        pulseraPuesta = false;
        resetearVariablesMAX();
        sensorDormido = true;
    }
}

void despertarSensorMAX() {
    if (sensorDormido) {
        sensor.setPulseAmplitudeIR(150);
        sensor.setPulseAmplitudeRed(0);
        delay(170);
        sensor.clearFIFO();
        while (sensor.available()) {
            sensor.nextSample();
        }
        pulseraPuesta = false;
        ultimoIR = 0;
        ultimoRed = 0;
        resetearVariablesMAX();
        sensorDormido = false;
    }
}

bool verificarMunecaDestello() {
    // Si ya está despierto midiendo activamente, devolvemos el estado en curso
    if (!sensorDormido) {
        return pulseraPuesta;
    }

    // 1. Encender el LED infrarrojo para el destello de detección
    sensor.setPulseAmplitudeRed(0);
    sensor.setPulseAmplitudeIR(150);

    // 2. Esperar 170ms para que termine cualquier promedio previo con el LED apagado,
    //    limpiar el FIFO de hardware y leer 1 muestra nueva directa con getIR()
    delay(170);
    sensor.clearFIFO();
    uint32_t lecturaIR = sensor.getIR();
    while (sensor.available()) {
        sensor.nextSample();
    }

    // 3. Apagar inmediatamente los LEDs para ahorrar batería el resto del segundo
    sensor.setPulseAmplitudeIR(0);
    sensor.setPulseAmplitudeRed(0);

    pulseraPuesta = (lecturaIR > UMBRAL_PULSERA_PUESTA);
    return pulseraPuesta;
}

bool estaSensorDormido() {
    return sensorDormido;
}

bool hayPulseraPuesta() {
    return pulseraPuesta;
}

bool inicializarSensorMAX() {
    // Se verifica la conexión I2C
    if (!sensor.begin(Wire, I2C_SPEED_STANDARD)) {
        return false;
    }
    
    sensor.softReset();
    
    // Configuración de LEDs y ADC del max
    sensor.setup(150, 16, 2, 100, 411, 16384); 
    sensor.setPulseAmplitudeRed(0); // Apagar luz roja visible inicialmente
    
    sensorDormido = false;
    resetearVariablesMAX();

    // Arranca dormido por defecto hasta que el main lo despierte al conectar Bluetooth
    dormirSensorMAX();
    return true;
}

// Procesa UNA muestra infrarroja para la deteccion de latidos
static void procesarMuestraBPM(float valorActual) {
    bool latidoDetectado = false;   // para el grafico de calibracion
    bool latidoAceptado = false;

    static unsigned long tiempoDedoFuera = 0;

    if (valorActual <= UMBRAL_PULSERA_PUESTA) {
        if (pulseraPuesta) {
            if (tiempoDedoFuera == 0) tiempoDedoFuera = millis();

            // Le damos medio segundo de tolerancia para ignorar ruidos o glitches del I2C
            if (millis() - tiempoDedoFuera > 500) {
                pulseraPuesta = false;
                sensor.setPulseAmplitudeRed(0); // Apagar luz roja visible
                resetearVariablesMAX();
                tiempoDedoFuera = 0;
            }
        }
        registrarMuestraCalibMAX(valorActual, false, false, 0);
        return;
    }

    tiempoDedoFuera = 0; // Hay buena lectura, reiniciamos el contador de apagado

    if (!pulseraPuesta) {
        pulseraPuesta = true;
        sensor.setPulseAmplitudeRed(cfgMax.led); // Encender luz roja para SpO2
        tiempoInicioToque = millis();
        resetearVariablesMAX();
        picoMaximo = valorActual;
        minimoLocal = valorActual;
    }

    if (millis() - tiempoInicioToque >= TIEMPO_ESTABILIZACION_MS) {
        if (picoMaximo == 0.0) {
            picoMaximo = valorActual;
            minimoLocal = valorActual;
        }

        // Relajar gradualmente la sensibilidad hacia el piso base (8.0) para muñeca
        float escalaTiempo = cfgMax.promedio / 8.0f;   // 1 con promedio 8; 0,5 con promedio 4
        if (sensibilidadDinamica > CAIDA_MINIMA_IR_BASE) {
            sensibilidadDinamica *= powf(0.98f, escalaTiempo);
            if (sensibilidadDinamica < CAIDA_MINIMA_IR_BASE) {
                sensibilidadDinamica = CAIDA_MINIMA_IR_BASE;
            }
        }

        float pasoDecaimiento = sensibilidadDinamica * 0.12f * escalaTiempo;
        if (pasoDecaimiento < 1.0f) pasoDecaimiento = 1.0f;

        if (buscandoPico) {
            if (valorActual > picoMaximo) { picoMaximo = valorActual; idxPico = idMuestraGlobal; }
            else picoMaximo -= pasoDecaimiento;

            float caida = picoMaximo - valorActual;

            if (caida > sensibilidadDinamica && caida < RANGO_CAIDA_MAX_IR) {
                latidoDetectado = true;
                // El latido se mide contando muestras desde el pico
                float tLatidoMs = (float)idxPico * 10.0f * cfgMax.promedio;

                if (!primerLatidoDetectado) {
                    // El primer pico solo sirve para encender el cronómetro, no para medir
                    primerLatidoDetectado = true;
                    tUltimoLatidoMs = tLatidoMs;
                } else {
                    float intervalo = tLatidoMs - tUltimoLatidoMs;

                    if (intervalo > MIN_INTERVALO_LATIDO_MS) {
                        if (intervalo < MAX_INTERVALO_LATIDO_MS) {
                            float bpmInstantaneo = 60000.0f / intervalo;
                            // Con la muñeca en movimiento el intervalo no es confiable: no se usa
                            if (!munecaEnMovimiento && bpmInstantaneo > MIN_BPM_VALIDO && bpmInstantaneo < MAX_BPM_VALIDO) {
                                latidoAceptado = registrarLatido(bpmInstantaneo);
                            }
                        }
                        tUltimoLatidoMs = tLatidoMs;
                    }
                }
                ultimoPicoLatido = picoMaximo;
                buscandoPico = false;
                minimoLocal = valorActual;
            }
            else if (caida >= RANGO_CAIDA_MAX_IR) { picoMaximo = valorActual; idxPico = idMuestraGlobal; }
        }
        else {
            if (valorActual < minimoLocal) minimoLocal = valorActual;
            else minimoLocal += pasoDecaimiento;

            float subida = valorActual - minimoLocal;
            if (subida > sensibilidadDinamica && subida < RANGO_CAIDA_MAX_IR) {
                // Ajustar sensibilidad segun amplitud real (baja en muñeca ~8-12, alta en dedo ~25-45)
                if (ultimoPicoLatido > minimoLocal) {
                    float amplitudOnda = ultimoPicoLatido - minimoLocal;
                    if (amplitudOnda < RANGO_CAIDA_MAX_IR) {
                        float nuevaSens = amplitudOnda * 0.40f;
                        if (nuevaSens < CAIDA_MINIMA_IR_BASE) nuevaSens = CAIDA_MINIMA_IR_BASE;
                        if (nuevaSens > cfgMax.sensMax) nuevaSens = cfgMax.sensMax;
                        sensibilidadDinamica = (0.70f * sensibilidadDinamica) + (0.30f * nuevaSens);
                    }
                }
                buscandoPico = true;
                picoMaximo = valorActual;
                idxPico = idMuestraGlobal;
            }
            else if (subida >= RANGO_CAIDA_MAX_IR) minimoLocal = valorActual;
        }
    }
    registrarMuestraCalibMAX(valorActual, latidoDetectado, latidoAceptado, bpmPromedio);
}

int procesarLatidosBPM() {
    if (sensorDormido) return 0;

    aplicarHardwarePendienteMAX();
    consumirMuestras();   // procesa TODAS las muestras nuevas del sensor


    if (!pulseraPuesta) return 0;
    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    if (bpmPromedio == 0) return -1; // Aún no hay latidos válidos medidos
    return bpmPromedio;
}

// Mediana de las ultimas ventanas de SpO2 (evita saltos por una ventana ruidosa)
static int medianaSpO2() {
    int v[VENTANAS_MEDIANA_SPO2];
    for (int i = 0; i < cantHistorialSpO2; i++) v[i] = historialSpO2[i];
    for (int i = 1; i < cantHistorialSpO2; i++) {
        int x = v[i], j = i - 1;
        while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j--; }
        v[j + 1] = x;
    }
    return v[cantHistorialSpO2 / 2];
}

// Procesa UNA muestra (infrarroja y roja) para el calculo de SpO2
static void procesarMuestraSpO2(float irActual, float redActual) {

    if (irActual <= UMBRAL_PULSERA_PUESTA) return;

    // Linea de base (DC) que sigue lentamente a la señal
    if (lineaBaseIR <= 0.0f) { lineaBaseIR = irActual; lineaBaseRed = redActual; }
    lineaBaseIR += ALFA_LINEA_BASE * (irActual - lineaBaseIR);
    lineaBaseRed += ALFA_LINEA_BASE * (redActual - lineaBaseRed);

    // Con la muñeca quieta, acumular la parte pulsatil (AC) de cada canal
    if (!munecaEnMovimiento) {
        float acIR = irActual - lineaBaseIR;
        float acRed = redActual - lineaBaseRed;
        sumaCuadIR += acIR * acIR;
        sumaCuadRed += acRed * acRed;
        sumaIR += irActual;
        sumaRed += redActual;
        muestrasSpO2++;
    }
}

// Lee todas las muestras nuevas del FIFO
static void consumirMuestras() {
    if (sensorDormido || !sensorIniciado) return;
    sensor.check();
    while (sensor.available()) {
        long ir = sensor.getFIFOIR();
        long red = sensor.getFIFORed();
        sensor.nextSample();
        idMuestraGlobal++;   // numero de muestra: tambien sirve de reloj (10 ms x promedio)
        ultimoIR = ir;
        ultimoRed = red;
        procesarMuestraBPM((float)ir);
        procesarMuestraSpO2((float)ir, (float)red);
    }
}

int procesarOxigenoSangre() {
    if (sensorDormido) return 0;

    consumirMuestras();


    if (millis() - tiempoInicioVentanaSpO2 >= TIEMPO_VENTANA_MS) {
        if (muestrasSpO2 >= MIN_MUESTRAS_SPO2) {
            float dcIR = sumaIR / muestrasSpO2;
            float dcRed = sumaRed / muestrasSpO2;
            float rmsIR = sqrtf(sumaCuadIR / muestrasSpO2);
            float rmsRed = sqrtf(sumaCuadRed / muestrasSpO2);

            if (dcIR > 0 && dcRed > 0 && rmsIR > 0) {
                float R = (rmsRed / dcRed) / (rmsIR / dcIR);
                ultimoR = R;

                if (R > 0.0f && R < R_MAXIMO_VALIDO) {
                    float spo2Calculado = SPO2_COEF_A - (SPO2_COEF_B * R);
                    if (spo2Calculado > SPO2_MAX_REPORTE) spo2Calculado = SPO2_MAX_REPORTE;
                    if (spo2Calculado < SPO2_MIN_REPORTE) spo2Calculado = SPO2_MIN_REPORTE;

                    historialSpO2[indiceHistorialSpO2] = (int)(spo2Calculado + 0.5f);
                    indiceHistorialSpO2 = (indiceHistorialSpO2 + 1) % VENTANAS_MEDIANA_SPO2;
                    if (cantHistorialSpO2 < VENTANAS_MEDIANA_SPO2) cantHistorialSpO2++;
                    spo2Definitivo = medianaSpO2();
                }
            }
        }

        sumaIR = 0.0; sumaRed = 0.0;
        sumaCuadIR = 0.0f; sumaCuadRed = 0.0f;
        muestrasSpO2 = 0;
        tiempoInicioVentanaSpO2 = millis();
    }

    if (!pulseraPuesta) return 0;
    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    if (spo2Definitivo == 0) return -1; // Aún no hay cálculo válido de oxígeno

    return spo2Definitivo;
}
