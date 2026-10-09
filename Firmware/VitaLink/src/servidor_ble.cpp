#include "servidor_ble.h"
#include <BLEDevice.h>
#include <BLEServer.h>

void inicializarBLE() {
    BLEDevice::init("VitaLink"); // Nombra el dispositivo BLE
    
    BLEServer *pServer = BLEDevice::createServer(); // Crea el servidor BLE
    
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising(); // Prepara el faro
    pAdvertising->setAppearance(192); // 192 = Generic Watch (Suele tener mejor soporte de ícono en Android/iOS)
    pAdvertising->addServiceUUID((uint16_t)0x180D); // 0x180D = Servicio estándar de Ritmo Cardíaco
    BLEDevice::startAdvertising(); // Enciende el faro para ser visible
}
