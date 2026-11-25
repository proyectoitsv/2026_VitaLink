# Notificaciones push de VitaLink

Estas funciones mandan una notificación push a los familiares cuando:

- la pulsera detecta una **caída o SOS** (`avisarEmergencia`),
- alguien **cancela** la alerta (`avisarAlertaCancelada`, quita la alarma de los otros celulares),
- la batería de la pulsera baja de **20 % o 10 %** (`avisarBateriaBaja`).

Sin estas funciones la app igual avisa, pero solo mientras el proceso de la app del familiar
siga vivo (el servicio en segundo plano lo mantiene). Con ellas el aviso llega aunque la app esté cerrada.

## Requisitos

- Proyecto Firebase en el **plan Blaze** (Cloud Functions lo exige; el uso de VitaLink entra en la capa gratuita).
- Node.js 22 y Firebase CLI: `npm install -g firebase-tools`

## Publicar

```powershell
cd software/firebase-functions/functions
npm install
cd ..
firebase login
firebase deploy --only functions
```

## Datos que usa

La app del familiar guarda su token en `pacientes/{patientId}/suscriptores/{familiarUid}`
con el campo `fcmToken`. Al desvincular un paciente, ese documento se borra.
