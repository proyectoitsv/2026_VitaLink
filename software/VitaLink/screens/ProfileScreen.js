import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { getAuth, signOut } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

export default function ProfileScreen({ navigation, route }) {
  const [nombre, setNombre] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;
  const uid = user ? user.uid.substring(0, 8) : '';

  useEffect(() => {
    if (user && uid) {
      const unsub = onSnapshot(doc(db, 'pacientes', uid), (docSnap) => {
        if (docSnap.exists() && docSnap.data().nombre) {
          setNombre(docSnap.data().nombre);
        }
      });
      return () => unsub();
    }
  }, [user, uid]);

  const handleSaveName = async () => {
    if (!nombre.trim() || !user || !uid) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      await setDoc(doc(db, 'pacientes', uid), { 
        nombre: nombre.trim() 
      }, { merge: true });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (e) {
      console.error('Error guardando nombre:', e);
      alert('Error al guardar: ' + e.message);
    }
    setSaving(false);
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigation.replace('RoleSelection');
  };

  if (!user) return <View style={styles.container}><ActivityIndicator color="#FFF" /></View>;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}&color=255-255-255&bgcolor=18-18-18`;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={32} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil del Paciente</Text>
        <View style={{width: 32}} />
      </View>

      <Animatable.View animation="fadeInUp" style={styles.content}>
        
        {/* Profile Card */}
        <View style={styles.card}>
          <Text style={styles.label}>TU CÓDIGO ÚNICO</Text>
          <Text style={styles.codeText}>{uid}</Text>
          
          <Text style={styles.label}>NOMBRE DEL PACIENTE</Text>
          <View style={styles.inputRow}>
            <TextInput 
              style={styles.input} 
              placeholder="Ej: Juan Pérez"
              placeholderTextColor="#555"
              value={nombre}
              onChangeText={setNombre}
            />
            <TouchableOpacity 
              style={[styles.saveBtn, savedSuccess && { backgroundColor: '#34C759' }]} 
              onPress={handleSaveName} 
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#000" size="small" />
              ) : savedSuccess ? (
                <Text style={[styles.saveBtnText, { color: '#FFF' }]}>✓ GUARDADO</Text>
              ) : (
                <Text style={styles.saveBtnText}>GUARDAR</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* QR Code */}
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Vincular Familiar</Text>
          <Text style={styles.qrSubtitle}>El familiar debe escanear este código desde su aplicación para comenzar a monitorearte.</Text>
          <View style={styles.qrWrapper}>
            <Image source={{uri: qrUrl}} style={styles.qrImage} />
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={20} color="#FF2D55" />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>

      </Animatable.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingHorizontal: 16, paddingBottom: 20 },
  backBtn: { padding: 4 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  content: { flex: 1, paddingHorizontal: 20 },
  
  card: { backgroundColor: '#121212', borderRadius: 24, padding: 24, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  label: { color: '#8E8E93', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  codeText: { color: '#FF2D55', fontSize: 32, fontWeight: '900', letterSpacing: 2, marginBottom: 24 },
  
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#1A1A1A', color: '#FFF', fontSize: 16, fontWeight: '600', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, marginRight: 12 },
  saveBtn: { backgroundColor: '#FFF', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16, justifyContent: 'center' },
  saveBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  
  qrCard: { backgroundColor: '#121212', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 30 },
  qrTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  qrSubtitle: { color: '#8E8E93', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  qrWrapper: { padding: 16, backgroundColor: '#181818', borderRadius: 20 },
  qrImage: { width: 180, height: 180 },
  
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  logoutText: { color: '#FF2D55', fontSize: 16, fontWeight: '700', marginLeft: 8 }
});
