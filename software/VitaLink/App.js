import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Importar pantallas
import RoleSelectionScreen from './screens/RoleSelectionScreen';
import PatientScreen from './screens/PatientScreen';
import FamilyLoginScreen from './screens/FamilyLoginScreen';
import FamilyDashboardScreen from './screens/FamilyDashboardScreen';
import ProfileScreen from './screens/ProfileScreen';
import QRScannerScreen from './screens/QRScannerScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator 
        initialRouteName="RoleSelection"
        screenOptions={{
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: 'bold' },
          headerShadowVisible: false,
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
          options={{ title: 'Modo Paciente' }} 
        />
        <Stack.Screen 
          name="FamilyLogin" 
          component={FamilyLoginScreen} 
          options={{ title: 'Acceso Familiar' }} 
        />
        <Stack.Screen 
          name="FamilyDashboard" 
          component={FamilyDashboardScreen} 
          options={{ title: 'Dashboard Familiar', headerShown: false }} 
        />
        <Stack.Screen 
          name="Profile" 
          component={ProfileScreen} 
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
