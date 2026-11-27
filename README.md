<div align="center">

# VitaLink

**Pulsera inteligente que detecta caídas y avisa a la familia, pensada para adultos mayores que viven solos.**

![ESP32-S3](https://img.shields.io/badge/XIAO-ESP32--S3-E5484D?style=for-the-badge&logo=espressif&logoColor=white)
![FreeRTOS](https://img.shields.io/badge/FreeRTOS-multitarea-2C2D33?style=for-the-badge)
![PlatformIO](https://img.shields.io/badge/PlatformIO-C%2B%2B-F5822A?style=for-the-badge&logo=platformio&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-Expo-3B9CFF?style=for-the-badge&logo=react&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Firestore_·_FCM-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)

*Proyecto integrador · 7.° año B · Electrónica · Instituto Técnico Salesiano Villada · Córdoba, Argentina · 2026*

<img src="Assets/renders/render_pulsera.jpg" alt="Render 3D de la pulsera VitaLink" width="720">

</div>

---

## Contenido

1. [¿Qué es VitaLink?](#qué-es-vitalink)
2. [El problema](#el-problema)
3. [Cómo funciona](#cómo-funciona)
4. [Hardware](#hardware)
5. [Firmware](#firmware)
6. [Aplicación móvil](#aplicación-móvil)
7. [Estructura del repositorio](#estructura-del-repositorio)
8. [Cómo compilar y usar](#cómo-compilar-y-usar)
9. [Presentaciones](#presentaciones)
10. [Limitaciones y próximos pasos](#limitaciones-y-próximos-pasos)
11. [Equipo](#equipo)

---

## ¿Qué es VitaLink?

VitaLink es un **ecosistema** formado por una pulsera y una aplicación móvil:

- La **pulsera** detecta caídas por sí sola, mide el pulso y el oxígeno en sangre, y tiene una zona táctil de **S.O.S.** para pedir ayuda con tres toques. No tiene pantallas ni menús: no hay nada que configurar.
- El **celular del paciente** hace de puente: recibe los datos por Bluetooth Low Energy y los sube a la nube junto con la ubicación GPS.
- La **familia** recibe la alerta al instante en su celular, con la ubicación y los signos vitales en vivo.

Usar el celular como puente permite que la pulsera sea **chica (30 × 40 mm), económica y de bajo consumo**.

---

## El problema

| | |
|---|---|
| **1.200.000** | adultos mayores de 65 años viven solos en Argentina *(Censo INDEC)* |
| **33 %** | declara sentir una soledad profunda *(Cruz Roja Argentina)* |
| **6.ª causa** | de muerte después de los 75 años son las caídas |
| **90 %** | de las fracturas en adultos mayores viene de una caída previa |

Después de una caída, **el tiempo en el piso** es lo que más importa: horas sin ayuda llevan a deshidratación, infecciones y úlceras, y un golpe que se podía curar puede volverse grave. Las alternativas actuales (geriátrico, cuidador, smartwatch o botón de pánico fijo) son caras, invaden la independencia o dejan zonas sin cobertura.

---

## Cómo funciona

```mermaid
flowchart LR
    P["Pulsera<br/>MPU6050 · MAX30102<br/>pads táctiles"] -- "Bluetooth LE" --> C["App del paciente<br/>GPS + reconexión automática"]
    C -- "Cloud Firestore" --> N["Firebase"]
    N -- "Cloud Function + FCM" --> F["App del familiar<br/>alerta a pantalla completa"]
    F -- "visto / cancelar" --> N
    N --> C
    C -- "V / X / R" --> P
```

**Ante una caída:**

1. La pulsera detecta la **caída libre**, el **impacto** y confirma que la persona **quedó quieta**.
2. Vibra en pulsos y avisa al celular del paciente por Bluetooth.
3. La app crea la alerta en Firestore con la **ubicación GPS**.
4. Una Cloud Function envía una **notificación push** a todos los familiares vinculados.
5. El familiar ve la alerta a pantalla completa con sirena, el mapa y el botón **"Cómo llegar"**.
6. Cuando un familiar la ve, la pulsera espacia los pulsos para que el paciente sepa que ya lo vieron. La alerta se cancela desde la app o tocando **Cancelar** en la pulsera.

---

## Hardware

### Componentes

| Componente | Función | Conexión |
|---|---|---|
| **Seeed Studio XIAO ESP32-S3** | Microcontrolador de 2 núcleos con Bluetooth 5 (BLE) y cargador de batería LiPo | — |
| **MPU6050 (GY-521)** | Acelerómetro para detectar caídas (±8 g, 50 muestras/s, giroscopio apagado). Vigila solo la caída libre y despierta al ESP32 | I²C · INT → `D0` |
| **MAX30102** | Sensor óptico de pulso (BPM) y oxígeno en sangre (SpO₂) | I²C · INT → `D1` |
| **Pad táctil S.O.S.** | Pedir ayuda (3 toques) y despertar la pulsera | `D9` (táctil capacitivo) |
| **Pad táctil Cancelar** | Cancelar una alerta | `D10` (táctil capacitivo) |
| **Motor vibrador** | Avisos hápticos (toques, S.O.S., alarma, carga) | `D6` (GPIO43) |
| **Batería LiPo** | Alimentación, medida con divisor resistivo al ADC | ADC |
| **Pads de carga** | GND y 5 V para el cargador magnético | — |

### Placa propia (PCB)

Diseñada en **Altium Designer**, de doble faz, con componentes SMD.

| Vista frontal (top) | Vista trasera (bottom) |
| :---: | :---: |
| ![Frontal sin componentes](Assets/pcb_top_sin_componentes.png) <br> *Placa sin componentes* | ![Trasera sin componentes](Assets/pcb_bottom_sin_componentes.png) <br> *Placa sin componentes* |
| ![Frontal con componentes](Assets/pcb_top_componentes.png) <br> *Placa con componentes* | ![Trasera con componentes](Assets/pcb_bottom_componentes.png) <br> *Placa con componentes* |

**Esquemático:**

![Esquemático VitaLink](Assets/esquematico.png)

### Carcasa y cargador

Modelados en **Fusion 360** e impresos en 3D (archivos en `Diseño 3d/`):

- **Pulsera:** base con ventana óptica para el sensor de pulso y anclajes de la correa, y tapa con las chapas metálicas (zonas táctiles S.O.S. y Cancelar, y pads de carga).
- **Cargador magnético:** dos piezas que se apoyan **sobre** la pulsera. Sus pogo pins tocan los pads de carga, así el adulto **no tiene que sacarse la pulsera para cargarla** y nunca queda desprotegido: con el cargador puesto puede seguir pidiendo ayuda y cancelando alertas.

| Cara con las chapas | Por dentro | Con el cargador |
| :---: | :---: | :---: |
| ![Cara de la pulsera](Assets/renders/render_frente.jpg) | ![Despiece](Assets/renders/render_despiece.jpg) | ![Pulsera con el cargador](Assets/renders/render_cargador.jpg) |
| Zonas táctiles S.O.S. y Cancelar, y pads de carga | Tapa, placa, batería y base con la ventana del sensor | El cargador se apoya encima de la pulsera |

*Renders generados a partir del modelo 3D real de la carcasa (`Diseño 3d/vitalink_case`).*

---

## Firmware

Escrito en **C++** con **PlatformIO** (framework Arduino) sobre **FreeRTOS**. Código en [`Firmware/VitaLink`](Firmware/VitaLink).

### Tareas

| Tarea | Núcleo | Qué hace |
|---|:---:|---|
| `TaskBLE` | 0 | Servidor Bluetooth, batería y carga, ritmo de la conexión, comandos de la app, OTA y sueño profundo |
| `TaskMAX30102` | 1 | Detección de muñeca y medición de pulso y oxígeno |
| `TaskMPU6050` | 1 | Espera la interrupción de caída libre del MPU y mide a 50 Hz para confirmar la caída |
| `TaskMotor` | — | Patrones de vibración |
| `TaskTactil` | 0 | Lectura de los pads S.O.S. y Cancelar |

- El bus I²C se comparte con un **mutex** (`i2cMutex`).
- Un **watchdog** reinicia la pulsera si alguna tarea se cuelga más de 10 s.

### Detección de caídas

Algoritmo en 3 pasos con parámetros **configurables desde la app** y guardados en la memoria de la pulsera:

| Paso | Condición (valores de fábrica) |
|---|---|
| **1. Caída libre** | Aceleración menor a **0,66 g** |
| **2. Impacto** | Más de **7,7 g**, entre **400 y 750 ms** después de empezar la caída libre (más rápido es un gesto del brazo) |
| **3. Confirmación** | Se ignoran 500 ms de rebotes y la persona tiene que quedar **quieta el 95 %** del tiempo hasta completar **2 s** desde el impacto |

- **El MPU vigila solo:** en reposo el ESP32 no lee el acelerómetro. El MPU6050 queda programado con su detección de **caída libre por hardware** y, cuando la gravedad baja del umbral, levanta el pin **INT (`D0`)**. Recién ahí el ESP32 mide a 50 Hz y confirma los pasos 2 y 3. Si en 3,5 s no hubo caída, el MPU vuelve a vigilar solo.
- Si el chip no es un MPU6050 original (por ejemplo, un MPU6500 que no tiene caída libre), la pulsera mide de forma continua como antes.
- **Solo se detectan caídas** con el celular conectado y la pulsera puesta, para evitar falsas alarmas si se cae de la mesa.
- Si el sensor de pulso no responde, se detecta igual.
- **Modo calibración:** la app muestra la aceleración en vivo y los eventos de cada prueba, sin disparar alertas reales.

### Pulso y oxígeno

- **Detección de muñeca:** un destello infrarrojo cada 1 s, y cada 3 s si pasó más de un minuto sin que nadie la use. Entre destellos, el chip queda apagado (~1 µA).
- **Ciclos de medición:** 30 s midiendo y 15 s de pausa. Los primeros 15 s se descartan mientras el sensor se estabiliza.
- **Lectura del FIFO:** se leen todas las muestras del FIFO por interrupción. El **BPM** sale del pico de cada latido y de la mediana de los últimos latidos, y el **SpO₂** de la componente pulsátil (RMS) con mediana de ventanas.
- **Movimiento:** si la muñeca se mueve, el acelerómetro lo avisa y esas muestras se descartan.

### Pads táctiles y vibración

| Gesto | Resultado |
|---|---|
| **3 toques** en S.O.S. | Envía un pedido de ayuda. Si no hay celular, queda pendiente hasta 5 min y se envía al reconectar |
| **1 toque** en Cancelar | Cancela la alerta en curso (en la pulsera y en la app) |
| **Mantener los dos pads 5 s** y soltar | Reinicia la pulsera |
| **Apoyar el cargador** | Los pads se recalibran solos y, cuando la pulsera detecta que está cargando, vibra para avisarlo |

| Vibración | Significado |
|---|---|
| Pulso corto | Toque registrado |
| Pulso largo (1,5 s) | S.O.S. enviado |
| 2 pulsos medios | S.O.S. sin celular |
| 3 pulsos cortos | Alerta cancelada |
| 3 pulsos que van creciendo | Empezó a cargar |
| Pulsos continuos | Alerta en curso, se espacian cuando un familiar la vio |

El motor está en `D6`, que en la XIAO es el pin TX del puerto serie (GPIO43). Para que no vibre cada vez que la pulsera se despierta, el pin queda **trabado en bajo** durante el sueño profundo y el arranque.

### Batería y carga

- La batería se lee **cada 1 s** y se envía a la app cada 5 s como `porcentaje;cargando`.
- **Detección de carga solo con la tensión de la batería:** un salto sostenido de más de 40 mV, o una subida lenta y constante durante 2 minutos, indica que está cargando. Una caída de la tensión indica que se desenchufó.
- La app muestra un indicador de **"Cargando"** en la batería, y el aviso de batería baja no aparece mientras carga.

### Ahorro de energía

- **Procesador:** CPU a **80 MHz** (240 MHz solo durante la actualización OTA).
- **Radio:** potencia BLE de **+6 dBm**. En reposo pide un intervalo de conexión de **400–500 ms**; con una alerta, una calibración o recién conectada vuelve a **50–100 ms**.
- **Sin celular:** anuncio rápido el primer minuto y después lento.
- **Sensores:** giroscopio apagado de forma permanente. El acelerómetro vigila la caída libre por su cuenta, así el ESP32 no lo lee en reposo, y el sensor de pulso duerme cuando no se usa.
- **Sueño profundo:** después de **5 min sin celular** la pulsera duerme. Se despierta cada 45 s para anunciarse, o al instante con un toque en **S.O.S.**

### Bluetooth (servicio `4fafc201-…`)

| Característica | Termina en | Uso |
|---|:---:|---|
| BPM / SpO₂ / Batería | `…26a8` `…26a9` `…26aa` | Signos vitales (notify). La batería va como `porcentaje;cargando` |
| Caída | `…26ab` | Alerta de caída. La app escribe `V` (visto), `X` (cancelada), `R` (reiniciar) |
| S.O.S. | `…26ac` | Pedido de ayuda |
| OTA | `…26ad` `…26ae` `…26af` | Versión, control y datos de la actualización |
| Calibración de caídas | `…26b0` `…26b1` | Aceleración en vivo y parámetros |
| Calibración de pulso | `…26b2` `…26b3` | Onda del pulso en vivo y parámetros |
| Diagnóstico táctil | `…26b4` | Lecturas del pad S.O.S. (solo con `DEPURAR_TACTIL`) |

### Actualización inalámbrica (OTA)

La pulsera se actualiza **por Bluetooth desde la app**. Al compilar, el script [`publicar_ota.py`](Firmware/VitaLink/publicar_ota.py) publica el firmware nuevo y registra la versión en Firestore. La app avisa que hay una actualización y la instala con una barra de progreso.

---

## Aplicación móvil

Hecha en **React Native (Expo)** con **Firebase**: autenticación anónima, Cloud Firestore en tiempo real, Cloud Messaging y Cloud Functions. El código está en [`software/VitaLink`](software/VitaLink) y las Cloud Functions en [`software/firebase-functions`](software/firebase-functions).

| Inicio | Paciente | Familiar | Alerta de caída |
| :---: | :---: | :---: | :---: |
| ![Inicio](Assets/app/01_inicio_rol.jpg) | ![Paciente](Assets/app/10_paciente_signos.jpg) | ![Familiar](Assets/app/03_familia_panel.jpg) | ![Alerta](Assets/app/04_familia_caida.jpg) |

### Modo Paciente

- Conexión y **reconexión automática** con la pulsera, que sigue funcionando con la pantalla apagada.
- Pulso, oxígeno y batería en vivo, con el estado del sensor ("midiendo", "sin muñeca", "pausa") y un indicador de **carga**.
- Comparte la **ubicación GPS** con la familia y avisa si falta el permiso o el GPS está apagado.
- **Pantalla de emergencia** a pantalla completa ante una caída o S.O.S., indicando qué familiares ya la vieron.
- **Ajustes:** calibrar la detección de caídas y el sensor de pulso, actualizar el firmware (OTA), reiniciar la pulsera y editar el perfil.

### Modo Familiar

- **Varios pacientes** en una misma cuenta, vinculados con un código **QR**.
- Signos vitales en vivo y **última ubicación** en el mapa.
- **Alerta a pantalla completa** con sirena, aunque la app esté cerrada, con la ubicación y el botón **"Cómo llegar con Google Maps"**.
- Avisa al paciente que la alerta fue **vista** y permite **cancelarla** manteniendo presionado.
- Ficha médica de emergencia: grupo sanguíneo, edad, alergias y teléfono.

| Calibración de caídas | S.O.S. del paciente |
| :---: | :---: |
| ![Calibración](Assets/app/17_calibracion_caidas.jpg) | ![SOS](Assets/app/13_paciente_sos.jpg) |

---

## Estructura del repositorio

```
2026_VitaLink/
├── Firmware/VitaLink/            # Firmware de la pulsera (PlatformIO)
│   ├── src/                      #   main, detección de caídas, MAX30102, BLE, OTA, batería
│   ├── include/                  #   cabeceras
│   ├── platformio.ini
│   └── publicar_ota.py           #   publica cada compilación para la actualización OTA
├── software/
│   ├── VitaLink/                 # Aplicación móvil (React Native + Expo)
│   ├── firebase-functions/       # Cloud Functions (notificaciones push de las alertas)
│   └── apk/VitaLink.apk          # APK lista para instalar en Android
├── Hardware/MainBoard_VitaLink/  # Proyecto de Altium, esquemático (PDF) y Gerbers
├── Diseño 3d/                    # Carcasa y cargador: vitalink_case (.f3d, .step, .stl)
├── capturas/                     # Capturas de la aplicación
├── Presentaciones/               # Presentaciones del proyecto (se abren en el navegador)
├── Assets/                       # Imágenes y renders del README
├── Informe Proyecto.md           # Evolución del proyecto, decisiones y consideraciones
└── feedback.md                   # Notas de las reuniones de seguimiento
```

| Rama | Contenido |
|---|---|
| `main` | **Todo el proyecto** |
| `feature-integracion-de-codigo` | Desarrollo del firmware |
| `feature-aplicacion-movil` | Desarrollo de la aplicación móvil |

> La historia completa del proyecto (componentes descartados, versiones de la placa, problemas y soluciones) está en el [**Informe del proyecto**](Informe%20Proyecto.md).

---

## Cómo compilar y usar

### Firmware

1. Instalar **VS Code** con la extensión **PlatformIO**.
2. Abrir la carpeta `Firmware/VitaLink`.
3. Conectar la XIAO por USB y ejecutar **Upload** (o `pio run -t upload`).
4. Las siguientes versiones se pueden instalar **por Bluetooth** desde la app (OTA).

### Aplicación

```bash
cd software/VitaLink
npm install
npx expo run:android          # desarrollo con un celular conectado
cd android && ./gradlew assembleRelease   # APK de release
```

> La APK ya compilada está en [`software/apk/VitaLink.apk`](software/apk/VitaLink.apk).
> Hace falta el archivo `google-services.json` del proyecto de Firebase.
> Compilando con `VITALINK_DEMO=1`, la app usa datos simulados (sin pulsera ni Firebase), por ejemplo para sacar capturas.

### Uso de la pulsera

1. Abrir la app, elegir **Soy Paciente**, completar el perfil y conectar la pulsera.
2. En el celular del familiar, elegir **Soy Familiar** y escanear el **QR** del perfil del paciente.
3. Listo: la pulsera vigila sola. Para pedir ayuda, **3 toques en S.O.S.**

---

## Presentaciones

En [`Presentaciones/`](Presentaciones) hay tres presentaciones hechas como páginas web, con la pulsera en 3D y capturas reales de la app:

| Presentación | Para qué |
|---|---|
| **Exposición técnica** | La exposición completa: problema, hardware, firmware, app, ventajas y limitaciones |
| **Exhibición** | Corre sola en loop, pensada para dejarla en una pantalla durante la muestra |
| **Público general** | Más corta y orientada al producto, para gente sin conocimientos técnicos |

Para verlas hay que abrir el archivo **`index.html`** de cada carpeta en un navegador. Los detalles y los controles están en el [README de Presentaciones](Presentaciones/README.md).

---

## Limitaciones y próximos pasos

**Limitaciones actuales**

- Menos precisa que un equipo clínico especializado.
- Necesita el celular del paciente cerca para avisar.
- Una caída muy lenta (por ejemplo, deslizarse de una silla) puede no tener caída libre: para eso está el botón S.O.S.
- El pulso y el oxígeno se **monitorean** en la app, pero todavía no generan alertas automáticas.

**Próximos pasos**

- **Miniaturizar la placa** e integrar los sensores directamente en la PCB.
- **Diseño más ergonómico** y resistente al agua.
- **Recordatorios de medicación** con vibración.

---

## Equipo

**Grupo N.° 5 · 7.° año B · Electrónica**

| Integrantes |
|---|
| Franco Castillo |
| Valentín Cerri |
| Francisco Salatín |
| Santiago Virgolini |

**Instituto Técnico Salesiano Villada** · Córdoba, Argentina
