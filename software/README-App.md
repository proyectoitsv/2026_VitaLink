# Configuración de VitaLink App (React Native)

He reiniciado la carpeta `software` para usar **Expo**, que es la herramienta oficial y más amigable para desarrollar en React Native hoy en día, especialmente en Windows.

## ¿Qué se descargó e instaló?
Se están terminando de instalar automáticamente (en segundo plano) las siguientes librerías que vas a necesitar para la arquitectura del proyecto:
1. `react-native-ble-plx`: Para conectarte por Bluetooth a la pulsera.
2. `@react-native-firebase/app` y `@react-native-firebase/firestore`: Para enviar los datos en tiempo real al celular del familiar.
3. `@react-navigation/native`: Para poder tener múltiples pantallas (Login, Inicio, Configuraciones).
4. `expo-dev-client`: Para poder compilar la aplicación con código nativo de Bluetooth de forma sencilla.

## ¿Cómo probarlo?
Una vez que termine la instalación, para arrancar el servidor en Visual Studio Code, abrí una terminal nueva en la carpeta `software/VitaLink` y corré:
```bash
npm start
```

## Nota Importante sobre Bluetooth:
Como estamos usando Bluetooth, **no se puede usar Expo Go** para probar la app. Vas a necesitar generar una versión (Build) de desarrollo ("Dev Client") o compilarla localmente para instalarla en tu Android físico. 
Para compilar localmente el apk de pruebas, podés correr:
```bash
npx expo run:android
```
*(Requiere tener Android Studio instalado y configurado).*
