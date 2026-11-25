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
static bool buscandoPico = true;
static unsigned long tiempoUltimoLatido = 0;
static int ultimosBPM[CANTIDAD_LATIDOS_FILTRO];
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

int procesarLatidosBPM() {
    if (sensorDormido) return 0;

    actualizarLecturas();
    
    static unsigned long ultimoIdBPM = 0;
    
    // Solo se ejecuta si hay una muestra nueva.
    // Esto garantiza que "picoMaximo -= 2.0" caiga a la velocidad real del corazón
    // sin importar qué tan rápido corra el main.
    if (ultimoIdBPM != idMuestraGlobal) {
        ultimoIdBPM = idMuestraGlobal;
        
        float valorActual = (float)ultimoIR;

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
            return 0; 
        }

        tiempoDedoFuera = 0; // Hay buena lectura, reiniciamos el contador de apagado

        if (!pulseraPuesta) {
            pulseraPuesta = true;
            sensor.setPulseAmplitudeRed(150); // Encender luz roja para SpO2
            tiempoInicioToque = millis();
            resetearVariablesMAX();
        }

        if (millis() - tiempoInicioToque >= TIEMPO_ESTABILIZACION_MS) {
            if (buscandoPico) {
                if (valorActual > picoMaximo) picoMaximo = valorActual; 
                else picoMaximo -= 2.0; 

                float caida = picoMaximo - valorActual;

                if (caida > CAIDA_MINIMA_IR && caida < RANGO_CAIDA_MAX_IR) { 
                    unsigned long tiempoAhora = millis();
                    
                    if (!primerLatidoDetectado) {
                        // El primer pico solo sirve para encender el cronómetro, no para medir
                        primerLatidoDetectado = true;
                        tiempoUltimoLatido = tiempoAhora;
                    } else {
                        unsigned long intervalo = tiempoAhora - tiempoUltimoLatido;

                        if (intervalo > MIN_INTERVALO_LATIDO_MS && intervalo < MAX_INTERVALO_LATIDO_MS) { 
                            int bpmInstantaneo = 60000 / intervalo;
                            if (bpmInstantaneo > MIN_BPM_VALIDO && bpmInstantaneo < MAX_BPM_VALIDO) {
                                ultimosBPM[indiceBPM] = bpmInstantaneo;
                                indiceBPM++;
                                if (indiceBPM >= CANTIDAD_LATIDOS_FILTRO) indiceBPM = 0; 
                                
                                int suma = 0, datosValidos = 0;
                                for (byte i = 0 ; i < CANTIDAD_LATIDOS_FILTRO ; i++) {
                                    if (ultimosBPM[i] != 0) { suma += ultimosBPM[i]; datosValidos++; }
                                }
                                if (datosValidos > 0) bpmPromedio = suma / datosValidos; 
                            }
                            tiempoUltimoLatido = tiempoAhora; 
                        }
                    }
                    buscandoPico = false; 
                    minimoLocal = valorActual; 
                }
                else if (caida >= RANGO_CAIDA_MAX_IR) picoMaximo = valorActual; 
            } 
            else {
                if (valorActual < minimoLocal) minimoLocal = valorActual;
                else minimoLocal += 2.0; 

                float subida = valorActual - minimoLocal;
                if (subida > CAIDA_MINIMA_IR) {
                    buscandoPico = true;
                    picoMaximo = valorActual; 
                }
            }
        }
    }

    if (!pulseraPuesta) return 0;
    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    if (bpmPromedio == 0) return -1; // Aún no hay latidos válidos medidos
    return bpmPromedio; 
}

int procesarOxigenoSangre() {
    if (sensorDormido) return 0;

    actualizarLecturas();

    static unsigned long ultimoIdSpO2 = 0;
    
    // Solo sumamos para el oxígeno si la muestra es nueva (evita promedios falsos)
    if (ultimoIdSpO2 != idMuestraGlobal) {
        ultimoIdSpO2 = idMuestraGlobal;
        
        float irActual = (float)ultimoIR;
        float redActual = (float)ultimoRed;

        if (irActual <= UMBRAL_PULSERA_PUESTA) return 0;

        if (irActual > maxIR) maxIR = irActual;
        if (irActual < minIR) minIR = irActual;
        if (redActual > maxRed) maxRed = redActual;
        if (redActual < minRed) minRed = redActual;

        sumaIR += irActual;
        sumaRed += redActual;
        muestrasSpO2++;
    }

    if (millis() - tiempoInicioVentanaSpO2 >= TIEMPO_VENTANA_MS) {
        if (muestrasSpO2 > 0) {
            float dcIR = sumaIR / muestrasSpO2;
            float acIR = maxIR - minIR;
            
            float dcRed = sumaRed / muestrasSpO2;
            float acRed = maxRed - minRed;

            if (dcIR > 0 && dcRed > 0 && acIR > 0) {
                float R = (acRed / dcRed) / (acIR / dcIR);
                float spo2Calculado = 110.0 - (25.0 * R);

                if (spo2Calculado > 100.0) spo2Calculado = 100.0;
                if (spo2Calculado < 70.0) spo2Calculado = 70.0;

                spo2Definitivo = (int)spo2Calculado;
            }
        }

        maxIR = 0.0; minIR = 999999.0;
        maxRed = 0.0; minRed = 999999.0;
        sumaIR = 0.0; sumaRed = 0.0;
        muestrasSpO2 = 0;
        tiempoInicioVentanaSpO2 = millis();
    }

    if (!pulseraPuesta) return 0;
    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    if (spo2Definitivo == 0) return -1; // Aún no hay cálculo válido de oxígeno
    
    return spo2Definitivo;
}
