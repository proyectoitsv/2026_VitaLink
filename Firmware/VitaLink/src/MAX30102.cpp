#include "MAX30102.h"
#include <Wire.h>
#include "MAX30105.h"

static MAX30105 sensor;

bool inicializarSensorBPM() {
    // Se verifica la conexión I2C
    if (!sensor.begin(Wire, I2C_SPEED_STANDARD)) {
        return false;
    }
    
    sensor.softReset();
    
    // Configuración de LEDs y ADC del max
    sensor.setup(150, 16, 2, 100, 411, 16384); 
    
    return true;
}
