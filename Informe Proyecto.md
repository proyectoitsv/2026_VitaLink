### Componentes:

###### Lista de componentes inicial:

Xiao esp32-s3:

Sim800:

Max 30102:

Mpu6050:

Motor vibrador de moneda:

Mosfet:

Diodos:



###### Historial de cambios:

\- En etapas tempranas se pensó en cambiar la Xiao esp32-S3 por una Xiao esp32-C6, pero debido a que esta última no posee pinas táctiles se descartó completamente la idea y decidimos quedar con la S3.

\- Se descartó la idea de usar el componente SIM800 debido a la complejidad y el costo que conlleva usar ese dispositivo.

\- Al reemplazar el sim800 lo haríamos con bluetooth que nos permite recolectar datos y mandarlos, esto fue decidido a que nos conviene hacerlo así para no depender si la persona adulta está en la casa, que se pueda transmitir en todas partes.

\- Ahora vamos a depender del celular de el usuario, cosa que no pasaba antes con la sim800.

\- Cambio del max 30102: Al tener muchos problemas con la sensibilidad y las condiciones que se necesitan para medir pulso de forma correcta, se decidió cambiar el sensor de pulso por otro que pueda cumplir mejor con la tarea. Se decidió usar el “Xd-58c”.

\- Cambio del Xd-58c: Debido a problemas parecidos, no funcionaba bien,  estaba muy limitado, y el anterior nos parecía más completo, además de que por no encontrar otro sensor parecido nos quedamos a renegar un poco más con el anterior. Cambiando la lógica interna de este.



###### Lista de componentes Actual:

Xiao esp32-s3:

Max 30102:

Mpu6050:

Diodo m1: posterior m7

Mosfet AO3400: posterior AO3404

resistencia 470Ω SMD 0805 :

resistencia 1kΩ SMD 0805:





#### Creación de Placas:

###### Versión N°1:

\- Armado de esquemático y PCB: Tanto el diseño del esquemático y del PCB se realizaron en Easy Eda.

\- Realizado de placa: El proceso tuvo lugar en el laboratorio 2 de electrónica, allí se realizó el cortado, planchado, y se pasó por ácido a la placa.

\- Diseño de la carcasa para el prototipo: Mientras que la placa estaba en proceso; en fusión se construyó un modelo de carcasa que utilizaremos para aproximar medidas y darnos una idea de cómo será la carcaza final, en otras palabras es un modelo de prueba.

\- Error en el ácido: Después de dejar la placa en ácido durante un buen tiempo (debido al uso excesivo que carga el ácido del cole), se encontraron varias pistas que fueron consumidas y otras que ni toco a los alrededores. Esto fue debido a que el ácido consumía el cobre de forma muy desigual, por lo que para evitar esto tendríamos que usar un ácido diferente, uno que no tenga tantos usos y consuma el cobre de una forma más pareja.



###### Versión N°2:

\- PCB a utilizar: Se utilizará el mismo PCB que se usó en la primera versión.

\- ⁠Realización de placa: El proceso de construcción tuvo lugar en el mismo laboratorio que antes, en donde se pudo realizar el cortado, planchado, perforado y hasta el soldado de la placa.

\- Error en la creación de la placa: Durante el soldado nos dimos cuenta de un error que realizamos al imprimir las placas, y fue que espejamos la capa que no era (espejamos la capa inferior y no la superior cuando debería ser al revés). Por lo que tendremos que hacer una tercera versión del PCB teniendo en cuenta los infortunios de las 2 versiones anteriores.



###### Versión N°3: En proceso

\- PCB a utilizar: Se utilizará el mismo PCB que antes, solo que al momento de imprimir se espejaran las capas como es debido.

\- Realización de placa: El proceso se dio en el mismo lugar de los otros 2 intentos anteriores, terminando procesos como el cortado, planchado, perforado y actualmente se esta realizando el soldado de componentes y vías.

\- Diseño de carcasa 2: En paralelo al proceso de la placa, se busca hacer una segunda versión de la carcasa, en donde se encuentre una forma más optimizada de sostener la placa, los sensores y la batería y que cada uno tenga su espacio.

\- prueba de funcionamiento de la placa realizada

