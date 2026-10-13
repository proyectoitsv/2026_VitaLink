#include "servidor_ble.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// UUIDs personalizados para VitaLink
#define SERVICIO_VITALINK_UUID      "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CARACTERISTICA_BPM_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CARACTERISTICA_SPO2_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define CARACTERISTICA_BAT_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26aa"
#define CARACTERISTICA_CAIDA_UUID   "beb5483e-36e1-4688-b7f5-ea07361b26ab"
#define CARACTERISTICA_SOS_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26ac"

bool dispositivoConectado = false;
bool dispositivoDesconectandose = false;

static BLEServer* pServer = NULL;
static BLECharacteristic* pCharBPM = NULL;
static BLECharacteristic* pCharSpO2 = NULL;
static BLECharacteristic* pCharBat = NULL;
static BLECharacteristic* pCharCaida = NULL;
static BLECharacteristic* pCharSOS = NULL;

class MisCallbacksServidor: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        dispositivoConectado = true;
    };
    void onDisconnect(BLEServer* pServer) {
        dispositivoConectado = false;
        dispositivoDesconectandose = true;
    }
};

void inicializarBLE() {
    BLEDevice::init("VitaLink"); 
    
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MisCallbacksServidor());
    
    BLEService *pService = pServer->createService(SERVICIO_VITALINK_UUID);
    
    // Crear los 5 buzones con permisos de Lectura (READ) y Notificación Push (NOTIFY)
    pCharBPM = pService->createCharacteristic(CARACTERISTICA_BPM_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharBPM->addDescriptor(new BLE2902());
    
    pCharSpO2 = pService->createCharacteristic(CARACTERISTICA_SPO2_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharSpO2->addDescriptor(new BLE2902());
    
    pCharBat = pService->createCharacteristic(CARACTERISTICA_BAT_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharBat->addDescriptor(new BLE2902());
    
    pCharCaida = pService->createCharacteristic(CARACTERISTICA_CAIDA_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharCaida->addDescriptor(new BLE2902());
    
    pCharSOS = pService->createCharacteristic(CARACTERISTICA_SOS_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    pCharSOS->addDescriptor(new BLE2902());
    
    pService->start(); // Abrimos el edificio
    
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising(); 
    pAdvertising->addServiceUUID(SERVICIO_VITALINK_UUID);
    pAdvertising->setAppearance(192); // Generic Watch
    pAdvertising->addServiceUUID((uint16_t)0x180D); // Servicio de Ritmo Cardíaco
    BLEDevice::startAdvertising(); 
}

void manejarDesconexionBLE() {
    if (!dispositivoConectado && dispositivoDesconectandose) {
        delay(500); // Pequeño tiempo para que el hardware se acomode
        pServer->startAdvertising(); 
        dispositivoDesconectandose = false;
    }
}

// ---------------------------------------------------------
// FUNCIONES DE ENVÍO DE DATOS
// ---------------------------------------------------------

void enviarLatidosBLE(int bpm) {
    if (dispositivoConectado) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", bpm);
        pCharBPM->setValue((uint8_t*)buffer, strlen(buffer));
        pCharBPM->notify(); // Dispara la notificación al celular
    }
}

void enviarOxigenoBLE(int spo2) {
    if (dispositivoConectado) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", spo2);
        pCharSpO2->setValue((uint8_t*)buffer, strlen(buffer));
        pCharSpO2->notify();
    }
}

void enviarBateriaBLE(int porcentaje) {
    if (dispositivoConectado) {
        char buffer[10];
        snprintf(buffer, sizeof(buffer), "%d", porcentaje);
        pCharBat->setValue((uint8_t*)buffer, strlen(buffer));
        pCharBat->notify();
    }
}

void enviarAlertaCaidaBLE(bool hayCaida) {
    if (dispositivoConectado) {
        char buffer[2];
        snprintf(buffer, sizeof(buffer), "%d", hayCaida ? 1 : 0);
        pCharCaida->setValue((uint8_t*)buffer, strlen(buffer));
        pCharCaida->notify();
    }
}

void enviarAlertaSOSBLE(bool presionado) {
    if (dispositivoConectado) {
        char buffer[2];
        snprintf(buffer, sizeof(buffer), "%d", presionado ? 1 : 0);
        pCharSOS->setValue((uint8_t*)buffer, strlen(buffer));
        pCharSOS->notify();
    }
}
