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
}

bool inicializarSensorBPM() {
    // Se verifica la conexión I2C
    if (!sensor.begin(Wire, I2C_SPEED_STANDARD)) {
        return false;
    }
    
    sensor.softReset();
    
    // Configuración de LEDs y ADC del max
    sensor.setup(150, 16, 2, 100, 411, 16384); 
    
    resetearVariablesBPM();
    return true;
}

int procesarLatidosBPM() {
    long valorCrudo = sensor.getIR();
    float valorActual = (float)valorCrudo;

    if (valorActual <= UMBRAL_PULSERA_PUESTA) { 
        pulseraPuesta = false;
        resetearVariablesBPM();
        return -1; 
    }

    if (!pulseraPuesta) {
        pulseraPuesta = true;
        tiempoInicioToque = millis();
        resetearVariablesBPM();
    }

    if (millis() - tiempoInicioToque < TIEMPO_ESTABILIZACION_MS) return -1;
    
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

    if (millis() - tiempoInicioVentanaBPM >= TIEMPO_VENTANA_MS) {
        if (latidosEnVentana > 0) bpmDefinitivo = sumaVentanaBPM / latidosEnVentana;
        else bpmDefinitivo = bpmPromedio; 

        sumaVentanaBPM = 0;
        latidosEnVentana = 0;
        tiempoInicioVentanaBPM = millis();
    }

    return bpmDefinitivo; 
}
