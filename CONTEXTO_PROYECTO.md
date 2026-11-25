# VitaLink - Ecosistema Wearable Autónomo
**Documento Maestro de Contexto y Arquitectura**

## 1. Identidad del Proyecto
*   **Nombre:** VitaLink
*   **Propósito:** Ecosistema wearable autónomo para el monitoreo de salud y cuidado de adultos mayores.
*   **Líder Técnico (Firmware/Hardware):** Franco Ignacio Castillo.
*   **Hardware Principal:** Microcontrolador Seeed Studio XIAO ESP32-S3.
*   **Sensores y Actuadores:** 
    *   MAX30102 (Pulsioximetría: Ritmo cardíaco y Oxígeno en sangre).
    *   MPU6050 (Acelerómetro/Giroscopio para Detección de Caídas).
    *   Circuito Divisor de Tensión (Medición de batería LiPo).
    *   Motor Vibrador (Retroalimentación háptica/alertas).
    *   Botón Táctil (Alerta SOS de pánico).

## 2. Las 7 Reglas de Oro de Arquitectura (Firmware)
Toda línea de código en este proyecto debe respetar los siguientes principios:
1.  **Cero `delay()`:** Prohibido congelar el procesador. Toda espera se maneja con `millis()` o bloqueos de sistema operativo.
2.  **Cero `void loop()` bloqueante:** El loop principal solo orquesta; el trabajo pesado se delega a Tareas (Tasks) en RTOS.
3.  **Cero bucles infinitos (`while(true)`):** Todo bucle debe tener una condición de salida segura o un *timeout*.
4.  **Cero variables `String`:** Prohibido el uso del objeto `String` de Arduino para prevenir la fragmentación de la memoria RAM. Se utilizan arreglos nativos `char buffer[]` y `snprintf()`.
5.  **Cero Números Mágicos:** Todos los valores (tiempos, umbrales, pines) deben estar definidos como constantes (`#define`) en la cabecera.
6.  **Cero Variables Globales sin control:** Si varias tareas deben leer o modificar una misma variable (o bus I2C), se deben usar Semáforos (Mutex) para evitar colisiones.
7.  **Flujo de Datos Estricto:** Los datos entran a las funciones por parámetros y salen por `return`.

## 3. Estándar de Control de Versiones (Git)
*   **Commits Atómicos:** Un commit por cada micro-tarea o funcionalidad lógica resuelta.
*   **Formato de Commits:** Siempre en español, comenzando con un verbo en **infinitivo** y sin punto final (Ej: `Crear servidor BLE con servicio medico`).
*   **Nomenclatura de Ramas:** Se utiliza el prefijo `feature-` o `feat/` seguido del nombre descriptivo separado por guiones (Ej: `feature-servidor-ble`, `feat/oxigeno-y-pulsaciones`).

---

## 4. Estado Actual del Proyecto (Lo que ya se hizo)

### Hardware (Finalizado)
*   Diseño completo de la PCB Custom en Altium Designer.
*   Archivos Gerber, STEP y PDF exportados.
*   Integración de footprints para XIAO ESP32-S3, pads para batería, driver del motor, y conexión del MAX30102.

### Medición de Energía (`gestion_energia`)
*   Se implementó la lectura de la batería usando el ADC.
*   **Corrección crítica:** Se mapeó correctamente al pin `A3`. (Se descubrió que usar el pin `29` causaba un crash directo de la CPU (`TG1WDT_SYS_RST`) por superposición con la memoria PSRAM interna del ESP32-S3).

### Sensor Biométrico MAX30102 (`feat/oxigeno-y-pulsaciones`)
*   Se reescribió el algoritmo de muestreo eliminando por completo el lag.
*   **Sincronización I2C:** Se implementó una variable `idMuestraGlobal` para asegurar que las lecturas de BPM y SpO2 consuman la misma muestra FIFO sin pisarse.
*   **Máscara de Calibración:** Se implementó un sistema de 3 estados para el retorno de datos:
    *   `0` -> La pulsera **no está puesta**.
    *   `-1` -> La pulsera está puesta, pero en periodo de **calibración** (Primeros 5 segundos).
    *   `>0` -> Dato de pulsaciones válido y filtrado.

### Servidor Bluetooth BLE (`feature-servidor-ble`)
*   **Arquitectura GATT:** Se configuró la ESP32-S3 como Peripheral Server con el nombre `"VitaLink"`.
*   **Apariencia:** Se forzó el código Appearance `192` (Reloj genérico) y el UUID `0x180D` en el Advertising para que los teléfonos dibujen un ícono de reloj/pulsera médica.
*   **5 Buzones Médicos (Characteristics):** Se crearon buzones dedicados para BPM, SpO2, Batería, Caídas y SOS. Todos con propiedades `READ` y `NOTIFY`.
*   **Cero Strings:** La comunicación empuja arreglos de bytes mediante `snprintf`.
*   **Auto-reconexión:** Lógica de *restart advertising* implementada para que la pulsera se vuelva visible automáticamente si el celular pierde conexión.

---

## 5. Próximos Pasos (Hoja de Ruta)

1.  **Integración Maestra (El Jefe Final):**
    *   Fusionar las ramas del MAX30102, Batería y BLE en `feature-integracion-de-codigo`.
    *   Implementar **FreeRTOS** para correr las lecturas I2C en el Core 0 (con Semáforo Mutex) y las lecturas de Batería y notificaciones BLE en el Core 1.
2.  **Detección de Caídas (MPU6050):** 
    *   Programar el algoritmo (Delegado a otros miembros del equipo).
    *   Integrar su llamado a la tarea de I2C en FreeRTOS y disparar el estado al buzón BLE.
3.  **Control Háptico (Motor):**
    *   Escribir el driver del motor vibrador (Delegado a otros miembros del equipo).
    *   Integrarlo para que vibre en caso de alarmas (SOS, Caída, Batería muy baja).
