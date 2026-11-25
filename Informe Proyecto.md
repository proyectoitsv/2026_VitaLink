# Informe del proyecto VitaLink

**Evolución del proyecto, decisiones y consideraciones**

*Proyecto integrador · Grupo N.° 5 · 7.° año B · Electrónica · Instituto Técnico Salesiano Villada · 2026*

> Este informe cuenta cómo fue cambiando VitaLink desde la idea inicial hasta el prototipo actual: qué se decidió, qué se descartó, qué problemas aparecieron y cómo se resolvieron.

---

## Índice

1. [Línea de tiempo](#1-línea-de-tiempo)
2. [Componentes](#2-componentes)
3. [Decisiones técnicas](#3-decisiones-técnicas)
4. [Placa (PCB)](#4-placa-pcb)
5. [Carcasa y cargador](#5-carcasa-y-cargador)
6. [Firmware](#6-firmware)
7. [Aplicación móvil](#7-aplicación-móvil)
8. [Problemas encontrados y soluciones](#8-problemas-encontrados-y-soluciones)
9. [Consideraciones finales](#9-consideraciones-finales)
10. [Lecciones aprendidas](#10-lecciones-aprendidas)

---

## 1. Línea de tiempo

Armada a partir del historial del repositorio y de lo registrado por el grupo.

| Período | Qué pasó |
|---|---|
| **Mayo** | Primeras pruebas de detección de caídas con el MPU6050 y una librería externa. Ajuste de la sensibilidad del acelerómetro. |
| **Junio (8/6)** | Reunión de devolución: se recomienda entender qué hace cada sensor y medir con osciloscopio en lugar de depender de librerías "mágicas". |
| **Junio – Agosto** | Definición de componentes: se descartan la ESP32-C6 y el SIM800. Prueba del sensor XD-58C y vuelta al MAX30102. Placas hechas en el colegio (versiones 1 a 3) diseñadas en EasyEDA. |
| **14 – 20 de septiembre** | Se rehace la placa desde cero en **Altium Designer**: esquemático, librerías propias (MAX30102, MPU6050, pads de cables), circuito de batería, driver del motor, salida de pines táctiles, ruteo, logo, archivos Gerber y modelo 3D. Se envía a fabricar a **JLCPCB**. |
| **21 de septiembre** | Se borra el código de prueba y se arranca un proyecto nuevo en PlatformIO con otro enfoque. |
| **Fines de septiembre – octubre** | Módulos por separado: MAX30102 (pulso y oxígeno), batería (divisor de tensión y porcentaje), servidor Bluetooth, adquisición y filtrado del MPU6050. Primeras versiones de la carcasa en Fusion 360. |
| **9 – 18 de octubre** | Nace la aplicación móvil en React Native: escaneo BLE, Firebase, perfiles con QR, varios pacientes por familiar y reconexión automática. Se integran los módulos del firmware. |
| **26 de octubre – 4 de noviembre** | Actualización de firmware por Bluetooth (OTA), mejora de la lectura de batería y módulo de detección de caídas. |
| **9 – 12 de noviembre** | Firmware con tareas de FreeRTOS, modo de bajo consumo, ventana de tiempo en la detección de caídas y correcciones del escaneo BLE. |
| **22 – 25 de noviembre** | Pads táctiles S.O.S. y Cancelar, vibración en pulsos, sueño profundo, confirmación de caída por quietud, calibración desde la app, alertas a pantalla completa con notificaciones push, ubicación en vivo, carcasa final con cargador y documentación. |

---

## 2. Componentes

### Lista de componentes inicial

| Componente | Función prevista |
|---|---|
| XIAO ESP32-S3 | Microcontrolador |
| SIM800 | Enviar las alertas por la red celular (SMS / datos) |
| MAX30102 | Pulso y oxígeno en sangre |
| MPU6050 | Acelerómetro para detectar caídas |
| Motor vibrador de moneda | Avisos hápticos |
| MOSFET | Manejo del motor |
| Diodos | Protección |

### Lista de componentes actual

| Componente | Función |
|---|---|
| **XIAO ESP32-S3** | Microcontrolador de 2 núcleos con Bluetooth 5 (BLE), pines táctiles y cargador de batería LiPo |
| **MAX30102** | Sensor óptico de pulso (BPM) y oxígeno en sangre (SpO₂) |
| **MPU6050 (GY-521)** | Acelerómetro para la detección de caídas |
| **Motor vibrador de moneda** | Avisos hápticos (toques, S.O.S., alarma) |
| **MOSFET AO3404** (antes AO3400) | Driver del motor vibrador |
| **Diodo M7** (antes M1) | Protección del circuito del motor |
| **Resistencias 470 Ω y 1 kΩ SMD 0805** | Componentes pasivos de la placa |
| **Divisor resistivo** | Medición de la tensión de la batería en el ADC (pin A3) |
| **Batería LiPo** | Alimentación de la pulsera |
| **Chapas metálicas** | Zonas táctiles S.O.S. y Cancelar, y pads de carga (GND y 5 V) |

### Historial de cambios de componentes

- **ESP32-C6 en lugar de la S3 (descartado):** en una etapa temprana se pensó en cambiar la XIAO ESP32-S3 por una XIAO ESP32-C6, pero la C6 no tiene pines táctiles, que eran necesarios para las zonas S.O.S. y Cancelar. Se decidió quedarse con la S3.
- **SIM800 (descartado):** se descartó por la complejidad y el costo de usarlo (módulo, chip con plan de datos y consumo alto).
- **Bluetooth en lugar del SIM800:** los datos se envían por Bluetooth al celular del paciente, que los sube a la nube. Así la pulsera funciona en cualquier lugar donde esté el celular, no solo en la casa. Como contrapartida, **ahora se depende del celular del usuario**, algo que no pasaba con el SIM800.
- **MAX30102 → XD-58C:** el MAX30102 dio muchos problemas de sensibilidad y necesitaba condiciones muy precisas para medir bien el pulso, así que se probó el sensor **XD-58C**.
- **XD-58C → MAX30102:** el XD-58C tuvo problemas parecidos, era más limitado y no se encontró otro sensor similar. Se volvió al MAX30102 y se **cambió por completo la lógica interna** de la medición (ver [Firmware](#6-firmware)).
- **Cambios de valores:** el MOSFET pasó de AO3400 a AO3404 y el diodo de M1 a M7.
- **Pin de la batería:** el pin del ADC pasó del 29 al **A3**.

---

## 3. Decisiones técnicas

| Decisión | Alternativas consideradas | Por qué se eligió |
|---|---|---|
| **XIAO ESP32-S3** | XIAO ESP32-C6 | Tiene pines táctiles, Bluetooth LE, 2 núcleos y cargador de batería integrado |
| **Bluetooth + celular como puente** | SIM800 (red celular) | Más barato, menor consumo y funciona fuera de la casa |
| **MAX30102 con algoritmo propio** | XD-58C | Mide pulso **y** oxígeno. Los problemas de medición se resolvieron con software |
| **Aplicación propia (React Native + Firebase)** | Bot de Telegram (idea del anteproyecto) | Permite modo paciente y familiar, alertas a pantalla completa, mapa y reconexión automática |
| **Pads táctiles en lugar de botones** | Botones mecánicos | Sin partes móviles, más fáciles de usar para un adulto mayor y la carcasa queda más cerrada |
| **Cargador que se apoya encima, con pogo pins** | Cable USB / sacar la pulsera para cargar | El adulto **no tiene que sacarse la pulsera** para cargarla y nunca queda desprotegido |
| **Placa fabricada por JLCPCB, rediseñada en Altium** | Placa hecha en el colegio (EasyEDA) | Doble faz, componentes SMD, mucho más chica y sin los errores de fabricación casera |
| **FreeRTOS con una tarea por módulo** | Un solo `loop()` | Cada parte (Bluetooth, sensores, motor, pads) funciona en paralelo sin bloquear a las demás |
| **Lectura del MPU6050 por registros** | Librería de Adafruit | Control total de la configuración (rango, filtro, interrupción, giroscopio apagado) y menos consumo |

---

## 4. Placa (PCB)

### Versión N.° 1 — EasyEDA, fabricada en el colegio

- **Esquemático y PCB:** diseñados en **EasyEDA**.
- **Fabricación:** en el laboratorio 2 de electrónica, con cortado, planchado y ataque con ácido.
- **Carcasa de prueba:** mientras se hacía la placa, se modeló en Fusion 360 una carcasa para aproximar medidas y tener una idea de la forma final.
- **Error en el ácido:** después de dejar la placa mucho tiempo en el ácido (que estaba muy usado), varias pistas quedaron consumidas y otras zonas ni se atacaron. El ácido comía el cobre de forma muy despareja. Para evitarlo había que usar un ácido con menos usos.

### Versión N.° 2 — mismo diseño

- **PCB:** el mismo diseño de la versión 1.
- **Fabricación:** en el mismo laboratorio: cortado, planchado, perforado y soldado.
- **Error:** durante el soldado se notó que al imprimir se espejó la capa equivocada (la inferior en lugar de la superior). Hubo que hacer una tercera versión.

### Versión N.° 3 — corrigiendo el espejado

- **PCB:** el mismo diseño, espejando las capas correctamente.
- **Fabricación:** cortado, planchado, perforado y soldado de componentes y vías.
- **Prueba de funcionamiento:** se probó la placa ya armada.
- **Carcasa 2:** en paralelo se diseñó una segunda versión de la carcasa, con un lugar definido para la placa, los sensores y la batería.

### Versión N.° 4 (final) — rediseño en Altium y fabricación en JLCPCB

Para mandar la placa a fabricar a **JLCPCB**, **se rehízo todo desde cero en Altium Designer**:

- Librerías propias del **MAX30102**, el **MPU6050** y los pads para conectar cables, con el footprint de la XIAO ESP32-S3 adaptado y con los pads de batería.
- Circuito para **monitorear la batería**, conectores de batería y cargador, conector para LED externo, **driver del motor vibrador** y **salida de los pines táctiles**.
- Placa **de doble faz** con componentes SMD, esquinas redondeadas y el **logo de VitaLink**.
- Se exportaron los **Gerbers**, el esquemático en PDF y el **modelo 3D (.STEP)** de la placa para diseñar la carcasa alrededor.

**Lo que se aprendió:** la fabricación casera sirve para prototipos rápidos, pero para una placa chica, de doble faz y con SMD conviene mandarla a fabricar. Y antes de imprimir hay que verificar qué capa se espeja.

---

## 5. Carcasa y cargador

Diseñados en **Fusion 360** e impresos en 3D.

| Versión | Descripción |
|---|---|
| **Prototipo** | Modelo de prueba para aproximar medidas mientras se hacía la primera placa |
| **Versión 2** | Lugar definido para la placa, los sensores y la batería |
| **Versión final** (`vitalink_case`) | **Pulsera:** base con ventana óptica para el sensor de pulso y anclajes de la correa, y tapa con las chapas metálicas. **Cargador:** dos piezas que se apoyan sobre la pulsera, con pogo pins que tocan los pads de carga |

- La pulsera final mide aproximadamente **30 × 40 mm**.

---

## 6. Firmware

### Etapas

1. **Pruebas iniciales (mayo):** detección de caídas con la librería del MPU6050 y ajuste de sensibilidad.
2. **Nuevo comienzo (septiembre):** se borró el código de prueba y se armó un proyecto nuevo en PlatformIO, separado en módulos.
3. **Módulos por separado (septiembre – octubre):** MAX30102, batería, servidor Bluetooth y acelerómetro, cada uno en su rama.
4. **Integración (octubre – noviembre):** todo se unió en una sola rama, con un **semáforo (mutex)** para compartir el bus I²C entre los dos sensores y una **tarea de FreeRTOS por módulo**.
5. **Versión final (noviembre):** pads táctiles, vibración, sueño profundo, calibración desde la app y actualización por Bluetooth (OTA).

### Evolución de la detección de caídas

| | Primera versión | Versión final |
|---|---|---|
| **Caída libre** | menos de 0,6 g | menos de **0,66 g** |
| **Impacto** | más de 4 g | más de **7,7 g** |
| **Ventana de tiempo** | entre 250 y 700 ms | entre **400 y 750 ms** desde que empieza la caída libre |
| **Confirmación** | — | Se ignoran 500 ms de rebotes y la persona tiene que quedar **quieta el 95 %** del tiempo hasta completar **2 s** desde el impacto |
| **Ajuste** | Valores fijos en el código | **Configurables desde la app**, con gráfico en vivo y modo de prueba sin alertas reales |
| **Cuándo detecta** | Siempre | Solo con el celular conectado y la **pulsera puesta**, para no dar falsa alarma si se cae de la mesa |

Los cambios salieron de probar: los movimientos bruscos del brazo daban falsos positivos (por eso subió el umbral de impacto y la ventana mínima), y un golpe sin que la persona quede en el piso no es una caída real (por eso la confirmación por quietud).

### Evolución de la medición de pulso y oxígeno

- **Al principio:** se usaba solo la última muestra de cada lectura y las demás se perdían, lo que corría la medición del latido.
- **Ahora:**
  - Se leen **todas las muestras del FIFO** del sensor, avisadas por su pin de interrupción.
  - El **BPM** se calcula desde el pico de cada latido, con la mediana de los últimos latidos.
  - El **SpO₂** se calcula con la componente pulsátil (RMS) y la mediana de varias ventanas.
  - Las muestras con la muñeca en movimiento se descartan (lo avisa el acelerómetro).
- **Detección de muñeca:** un destello infrarrojo por segundo, y cada 3 s si nadie la usa hace más de un minuto. Entre destellos el sensor queda apagado.

### Evolución del consumo de energía

| Etapa | Medidas |
|---|---|
| Primera versión | Todo encendido todo el tiempo |
| Noviembre | CPU a 80 MHz (240 MHz solo en la OTA), giroscopio apagado, sensores dormidos sin celular o sin pulsera puesta |
| Versión final | Además: **sueño profundo** a los 5 min sin celular (se despierta cada 45 s o con un toque en S.O.S.), anuncio Bluetooth lento sin celular e intervalo de conexión más largo |

La potencia del Bluetooth se ajustó varias veces: con potencia baja la conexión se perdía a través de la carcasa, y con la máxima (+9 dBm) los picos de consumo podían reiniciar los sensores con la batería baja. Se dejó en **+6 dBm**.

---

## 7. Aplicación móvil

- **Idea inicial:** en el anteproyecto se pensó en usar un **bot de Telegram** para avisar a la familia. Se reemplazó por una **aplicación propia** porque permitía mucho más.
- **Primera versión (octubre):** React Native con escaneo Bluetooth y lectura de los datos de la pulsera.
- **Nube:** Firebase con autenticación anónima y Cloud Firestore en tiempo real.
- **Familia:** perfil del paciente con **código QR**, varios pacientes por familiar y ficha médica de emergencia.
- **Conexión:** reconexión automática y persistente con la pulsera, que funciona con la pantalla apagada.
- **Actualización del firmware por Bluetooth (OTA)** desde la app, con barra de progreso.
- **Versión final:**
  - **Alertas a pantalla completa con sirena**, aunque la app esté cerrada, con notificaciones push enviadas por Cloud Functions.
  - **Ubicación en vivo** y botón "Cómo llegar con Google Maps".
  - Aviso al paciente de que la alerta fue **vista**.
  - **Calibración** de la detección de caídas y del sensor de pulso.
  - **Reinicio** de la pulsera desde la app.

---

## 8. Problemas encontrados y soluciones

| Problema | Causa | Solución |
|---|---|---|
| Pistas consumidas de forma despareja (placa V1) | Ácido muy usado | Usar ácido nuevo y, finalmente, mandar a fabricar la placa |
| Capa espejada al revés (placa V2) | Error al imprimir | Versión 3 espejando la capa correcta |
| Medición de pulso inestable | Sensibilidad del MAX30102 y muestras que se perdían | Leer todo el FIFO, detectar el pico de cada latido y usar medianas |
| Error 133 al conectar por Bluetooth en Android | Problema conocido de Android con el GATT | Ajuste de MTU y demoras al conectar, y limpieza de caché del GATT para la OTA |
| Conexiones "fantasma" y cortes a los 2 s | Escaneo sin filtro | Filtrar por nombre y limpiar conexiones viejas |
| La pulsera se reiniciaba al recibir comandos de calibración | La función que atiende el Bluetooth tiene muy poca memoria | Guardar los comandos en una cola y procesarlos en la tarea del Bluetooth |
| Con la yema del dedo el toque costaba más que con el pulgar | Umbral táctil muy alto | Umbral del 10 %, histéresis y base que se adapta a la humedad y la temperatura |
| Al apoyar el cargador vibraba y el S.O.S. quedaba trabado | El pogo pin del cargador se conecta al pad S.O.S. | El toque cuenta al soltar el dedo, y un pad apretado más de 2 s se recalibra solo |
| Los sensores se reiniciaban con la batería baja | Picos de consumo de la radio a máxima potencia | Bajar la potencia del Bluetooth a +6 dBm |
| Falsas alarmas por gestos bruscos o si la pulsera se caía de la mesa | Algoritmo de caídas muy simple | Ventana mínima de 400 ms, confirmación por quietud y detectar solo con la pulsera puesta |
| El MAX30102 a veces no respondía al encender | Arranque en frío o caída de tensión | Reintentos automáticos y recuperación de la configuración |
| La OTA era lenta | Paquetes chicos | MTU de 512, prioridad alta de conexión y envío en ráfagas |

---

## 9. Consideraciones finales

### Limitaciones actuales

- Menos precisa que un equipo clínico especializado.
- Necesita el **celular del paciente cerca** para enviar las alertas.
- Una **caída lenta** (por ejemplo, deslizarse de una silla) puede no tener caída libre y no detectarse. Para eso está el botón **S.O.S.**
- El pulso y el oxígeno se **monitorean** en la app, pero todavía no generan alertas automáticas.
- Con el cargador puesto, el cargador replica la zona S.O.S. pero todavía no la de **Cancelar**.

### Trabajo futuro

- **Miniaturizar la placa** e integrar los sensores directamente en la PCB.
- **Diseño más ergonómico** y resistente al agua (muchos accidentes domésticos ocurren en el baño).
- **Recordatorios de medicación** con vibración.
- **Alertas por pulso u oxígeno fuera de rango**, una vez validada la medición.
- Agregar la zona **Cancelar** al cargador.

---

## 10. Lecciones aprendidas

- **Entender los sensores antes de programar.** En la reunión del 8/6 nos recomendaron no buscar una "librería mágica" y medir primero con osciloscopio. Eso se aplicó: el acelerómetro terminó leyéndose directamente por registros y la medición del MAX30102 se rehízo con un algoritmo propio.
- **Probar en condiciones reales.** Los umbrales de caída, la sensibilidad táctil y la potencia del Bluetooth solo se pudieron ajustar probando con la pulsera puesta y con la carcasa cerrada.
- **Trabajar por módulos.** Desarrollar cada parte en su propia rama de Git y después integrarla permitió avanzar en paralelo.
- **La fabricación importa.** Dos de las tres placas caseras fallaron por cuestiones de fabricación, no de diseño.
