#include "servidor_ble.h"
#include <BLEDevice.h>
#include <BLEServer.h>

void inicializarBLE() {
    BLEDevice::init("VitaLink"); // Nombra el dispositivo BLE
    
    BLEServer *pServer = BLEDevice::createServer(); // Crea el servidor BLE
    
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising(); // Prepara el faro
    BLEDevice::startAdvertising(); // Enciende el faro para ser visible
}
