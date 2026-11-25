import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import notifee, { EventType } from '@notifee/react-native';
import { iniciarMonitorFamilia } from './services/monitorFamilia';
import { asegurarCanales } from './services/notificaciones';

// Importar pantallas
import RoleSelectionScreen from './screens/RoleSelectionScreen';
import PatientScreen from './screens/PatientScreen';
import FamilyLoginScreen from './screens/FamilyLoginScreen';
import FamilyPatientsScreen from './screens/FamilyPatientsScreen';
import FamilyDashboardScreen from './screens/FamilyDashboardScreen';
import ProfileScreen from './screens/ProfileScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import PatientOnboardingScreen from './screens/PatientOnboardingScreen';
import CalibracionScreen from './screens/CalibracionScreen';
import CalibracionPulsoScreen from './screens/CalibracionPulsoScreen';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();
// Solo en el modo demo (capturas): permite cambiar de pantalla con comandos desde la PC
if (global.__VITALINK_DEMO__) global.__demoNav = navigationRef;

// Al tocar una notificación se abre la pantalla que corresponde
const abrirDesdeNotificacion = (data) => {
  if (!data || !navigationRef.isReady()) return false;
  if (data.rol === 'familia' && data.patientId) {
    navigationRef.navigate('FamilyDashboard', { patientId: data.patientId });
    return true;
  }
  if (data.rol === 'paciente') {
    navigationRef.navigate('Patient');
    return true;
  }
  return false;
};

export default function App() {
  const pendienteRef = useRef(null);

  useEffect(() => {
    StatusBar.setHidden(true, 'none');
    asegurarCanales().catch(() => {});
    iniciarMonitorFamilia();

    // Si la app se abrió desde la alarma (toque o pantalla completa sobre el bloqueo),
    // ir directo a la emergencia. Si no se sabe, buscar una alarma de familiar que esté sonando.
    const irA = (data) => {
      if (data && !abrirDesdeNotificacion(data)) pendienteRef.current = data;
    };
    notifee.getInitialNotification().then(async (inicial) => {
      if (inicial?.notification?.data) return irA(inicial.notification.data);
      const mostradas = await notifee.getDisplayedNotifications();
      const alarma = mostradas.find((n) => n.id?.startsWith('alerta_') && n.notification?.data?.rol === 'familia');
      if (alarma) irA(alarma.notification.data);
    }).catch(() => {});

    return notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) abrirDesdeNotificacion(detail.notification?.data);
    });
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        if (pendienteRef.current) {
          abrirDesdeNotificacion(pendienteRef.current);
          pendienteRef.current = null;
        }
      }}
    >
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />
      <Stack.Navigator 
        initialRouteName="RoleSelection"
        screenOptions={{
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: 'bold' },
          headerShadowVisible: false,
          statusBarHidden: true,
          navigationBarHidden: true,
          animation: 'fade_from_bottom',
          contentStyle: { backgroundColor: '#0B0D10' },
        }}
      >
        <Stack.Screen 
          name="RoleSelection" 
          component={RoleSelectionScreen} 
          options={{ title: 'VitaLink - Inicio', headerShown: false }} 
        />
        <Stack.Screen 
          name="Patient" 
          component={PatientScreen} 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="PatientOnboarding" 
          component={PatientOnboardingScreen} 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="FamilyPatients" 
          component={FamilyPatientsScreen} 
          options={{ headerShown: false }} 
        />
        <Stack.Screen 
          name="FamilyLogin" 
          component={FamilyLoginScreen} 
          options={{ title: 'Vincular Paciente', headerShown: false }} 
        />
        <Stack.Screen 
          name="FamilyDashboard" 
          component={FamilyDashboardScreen} 
          // Fundido (sin deslizar) para que se vea el avatar volando desde la lista
          options={{ title: 'Dashboard Familiar', headerShown: false, animation: 'fade' }}
        />
        <Stack.Screen 
          name="Profile" 
          component={ProfileScreen} 
          options={{ headerShown: false }} 
        />
        <Stack.Screen
          name="CalibracionPulso"
          component={CalibracionPulsoScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CalibracionCaidas"
          component={CalibracionScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="QRScanner" 
          component={QRScannerScreen} 
          options={{ headerShown: false }} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
