#include "MAX30102.h"
#include <Wire.h>
#include "MAX30105.h"

#define UMBRAL_PULSERA_PUESTA      50000
#define CAIDA_MINIMA_IR            20.0
#define RANGO_CAIDA_MAX_IR         10000.0
#define MIN_INTERVALO_LATIDO_MS    400
#define MAX_INTERVALO_LATIDO_MS    2000
#define MIN_BPM_VALIDO             40
#define MAX_BPM_VALIDO             160
#define CANTIDAD_LATIDOS_FILTRO    10
#define TIEMPO_ESTABILIZACION_MS   1000
#define TIEMPO_VENTANA_MS          2500

static MAX30105 sensor;

static bool pulseraPuesta = false;
static unsigned long tiempoInicioToque = 0;

static float picoMaximo = 0.0;
static float minimoLocal = 999999.0;
static bool buscandoPico = true;
static unsigned long tiempoUltimoLatido = 0;
static int ultimosBPM[CANTIDAD_LATIDOS_FILTRO];
static byte indiceBPM = 0;
static int bpmPromedio = 0;
static unsigned long tiempoInicioVentanaBPM = 0;
static int sumaVentanaBPM = 0;
static byte latidosEnVentana = 0;
static int bpmDefinitivo = 0;

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

static void actualizarLecturas() {
    sensor.check(); 
    
    // Se precesa todos los datos nuevos disponibles en la cola de la librería
    while (sensor.available()) {
        ultimoIR = sensor.getFIFOIR();
        ultimoRed = sensor.getFIFORed();
        sensor.nextSample(); // Avanza el puntero
        idMuestraGlobal++;   // "Etiquetamos" esta nueva muestra
    }
}

static void resetearVariablesBPM() {
    picoMaximo = 0.0; 
    minimoLocal = 999999.0;
    bpmPromedio = 0;
    for (byte i = 0 ; i < CANTIDAD_LATIDOS_FILTRO ; i++) ultimosBPM[i] = 0;
    sumaVentanaBPM = 0;
    latidosEnVentana = 0;
    bpmDefinitivo = 0;
    buscandoPico = true;
    tiempoUltimoLatido = millis();
    tiempoInicioVentanaBPM = millis();

    maxIR = 0.0; minIR = 999999.0;
    maxRed = 0.0; minRed = 999999.0;
    sumaIR = 0.0; sumaRed = 0.0;
    muestrasSpO2 = 0;
    spo2Definitivo = 0;
    tiempoInicioVentanaSpO2 = millis();
}

bool inicializarSensorBPM() {
    // Se verifica la conexión I2C
    if (!sensor.begin(Wire, I2C_SPEED_STANDARD)) {
        return false;
    }
    
    sensor.softReset();
    
    // Configuración de LEDs y ADC del max
    sensor.setup(150, 16, 2, 100, 411, 16384); 
    sensor.setPulseAmplitudeRed(0); // Apagar luz roja visible inicialmente
    
    resetearVariablesBPM();
    return true;
}

int procesarLatidosBPM() {
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
                    resetearVariablesBPM();
                    tiempoDedoFuera = 0;
                }
            }
            return -1; 
        }

        tiempoDedoFuera = 0; // Hay buena lectura, reiniciamos el contador de apagado

        if (!pulseraPuesta) {
            pulseraPuesta = true;
            sensor.setPulseAmplitudeRed(150); // Encender luz roja para SpO2
            tiempoInicioToque = millis();
            resetearVariablesBPM();
        }

        if (millis() - tiempoInicioToque >= TIEMPO_ESTABILIZACION_MS) {
            if (buscandoPico) {
                if (valorActual > picoMaximo) picoMaximo = valorActual; 
                else picoMaximo -= 2.0; 

                float caida = picoMaximo - valorActual;

                if (caida > CAIDA_MINIMA_IR && caida < RANGO_CAIDA_MAX_IR) { 
                    unsigned long tiempoAhora = millis();
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

                            sumaVentanaBPM += bpmPromedio;
                            latidosEnVentana++;
                        }
                        tiempoUltimoLatido = tiempoAhora; 
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

    if (millis() - tiempoInicioVentanaBPM >= TIEMPO_VENTANA_MS) {
        if (latidosEnVentana > 0) bpmDefinitivo = sumaVentanaBPM / latidosEnVentana;
        else bpmDefinitivo = bpmPromedio; 

        sumaVentanaBPM = 0;
        latidosEnVentana = 0;
        tiempoInicioVentanaBPM = millis();
    }

    if (!pulseraPuesta) return -1;
    return bpmDefinitivo; 
}

int procesarOxigenoSangre() {
    actualizarLecturas();

    static unsigned long ultimoIdSpO2 = 0;
    
    // Solo sumamos para el oxígeno si la muestra es nueva (evita promedios falsos)
    if (ultimoIdSpO2 != idMuestraGlobal) {
        ultimoIdSpO2 = idMuestraGlobal;
        
        float irActual = (float)ultimoIR;
        float redActual = (float)ultimoRed;

        if (irActual <= UMBRAL_PULSERA_PUESTA) return -1;

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

    if (!pulseraPuesta) return -1;
    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    
    return spo2Definitivo;
}
