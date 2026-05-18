# Crítica técnica del módulo de comunicaciones

## Problemas con el SIM800

Federico advierte enfáticamente contra el uso del módulo **SIM800**, al que describe como un “desastre” por su comportamiento durante la comunicación serial.

El principal problema identificado son las **notificaciones no solicitadas** que el módulo envía a través del puerto serial. Estas respuestas inesperadas complican el procesamiento de datos, ya que el sistema puede recibir mensajes del hardware que no fueron solicitados explícitamente por el microcontrolador.

Esto puede generar errores en la interpretación de respuestas, fallas de sincronización y mayor complejidad en el código de comunicación.

## Alternativa sugerida: módulo A6

Como alternativa, Federico propone evaluar el módulo **A6**.

Según su experiencia, este módulo presenta:

- mejor calidad general;
- funcionamiento más estable;
- precio accesible;
- menor complejidad técnica en comparación con el SIM800.

También menciona que ya fue utilizado exitosamente en proyectos previos sin generar complicaciones importantes.

# Evolución del diseño: hardware y aplicación

## Optimización de la placa

Se discute la posibilidad de pasar a tecnología de montaje superficial, conocida como **SMD** (*Surface-Mount Device*), para reducir el tamaño de la placa actual.

El objetivo estimado es lograr una reducción aproximada del **60%** del tamaño de la placa.

Esta optimización permitiría obtener un dispositivo más compacto, liviano y adecuado para su uso como pulsera o equipo portátil.

## Conectividad Bluetooth

Se plantea reemplazar o complementar componentes como Wi-Fi o GPS mediante una conexión **Bluetooth** con el smartphone del usuario.

Esta estrategia permitiría que el teléfono se encargue de funciones como:

- envío de alertas por SMS o mensajería;
- obtención de geolocalización;
- gestión de conectividad;
- comunicación con contactos de emergencia.

De esta forma, se podrían reducir costos de hardware, consumo energético y tamaño del dispositivo.

## Desarrollo de software

Se menciona la posibilidad de crear una aplicación para recibir y gestionar los datos del dispositivo.

Para acelerar el desarrollo, se plantea utilizar:

- plataformas de programación por bloques;
- herramientas asistidas por inteligencia artificial;
- entornos de desarrollo simplificados para prototipado rápido.

# Validación del modelo de negocio y usuario

## Base de referencia: proyecto de Tommy

Federico enfatiza que el equipo no debería comenzar desde cero.

La recomendación es tomar como base el trabajo previo realizado por **Tommy** y enfocarse en mejorar aspectos concretos del producto, como:

- carcasa;
- tamaño;
- funcionalidad;
- integración de componentes;
- experiencia de uso.

Esto permite aprovechar aprendizajes previos y avanzar sobre una base técnica ya existente.

## Análisis del usuario real

Se abre un debate sobre si los adultos mayores realmente llevan el celular consigo durante el día.

Este punto es importante porque la propuesta de usar Bluetooth depende de que el smartphone esté cerca del dispositivo.

Federico sugiere actualizar las encuestas de mercado y compararlas con datos de hace aproximadamente **4 años**. El objetivo es validar si el uso de smartphones en este segmento creció lo suficiente como para justificar una solución que dependa parcialmente del teléfono móvil.

# Geolocalización alternativa

Los estudiantes proponen un método alternativo de geolocalización basado en el escaneo de redes Wi-Fi cercanas.

La idea consiste en detectar redes disponibles alrededor del dispositivo y utilizar una API para estimar coordenadas a partir de esa información.

Esta estrategia podría mejorar la precisión en interiores, donde el GPS suele presentar limitaciones o fallas de señal.
