import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Image, 
  KeyboardAvoidingView, 
  Platform, 
  ScrollView, 
  ActivityIndicator, 
  StatusBar,
  Alert 
} from 'react-native';
import { getAuth, signOut } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from '@react-native-firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { AVATARS } from '../constants/avatars';

export default function ProfileScreen({ navigation }) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('account-circle');
  const [foto, setFoto] = useState(null);
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);
  
  const [edad, setEdad] = useState('');
  const [tipoSangre, setTipoSangre] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [alergias, setAlergias] = useState('');
  const [telefonoEmergencia, setTelefonoEmergencia] = useState('');

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const auth = getAuth();
  const db = getFirestore();
  const user = auth.currentUser;
  const uid = user ? user.uid.substring(0, 8) : '';

  useEffect(() => {
    if (user && uid) {
      const unsub = onSnapshot(doc(db, 'pacientes', uid), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.nombre) setNombre(data.nombre);
          if (data.apellido) setApellido(data.apellido);
          if (data.avatar) setSelectedAvatar(data.avatar);
          if (data.foto) setFoto(data.foto);
          if (data.edad) setEdad(data.edad);
          if (data.tipoSangre) setTipoSangre(data.tipoSangre);
          if (data.condiciones) setCondiciones(data.condiciones);
          if (data.alergias) setAlergias(data.alergias);
          if (data.telefonoEmergencia) setTelefonoEmergencia(data.telefonoEmergencia);
        }
      });
      return () => unsub();
    }
  }, [user, uid]);

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso necesario', 'Se necesita acceso a la cámara para tomar una foto de perfil.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]?.base64) {
        setFoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo abrir la cámara.');
    }
  };

  const handlePickGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso necesario', 'Se necesita acceso a la galería para elegir una foto de perfil.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]?.base64) {
        setFoto(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo abrir la galería.');
    }
  };

  const handleRemovePhoto = () => {
    setFoto(null);
  };

  const handleSelectAvatar = (avId) => {
    setSelectedAvatar(avId);
    setFoto(null);
  };

  const handleSaveProfile = async () => {
    if (!user || !uid) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      await setDoc(doc(db, 'pacientes', uid), { 
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        avatar: selectedAvatar,
        foto: foto || null,
        edad: edad.trim(),
        tipoSangre: tipoSangre.trim().toUpperCase(),
        condiciones: condiciones.trim(),
        alergias: alergias.trim(),
        telefonoEmergencia: telefonoEmergencia.trim(),
        actualizado: new Date()
      }, { merge: true });
      
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (e) {
      console.error('Error guardando perfil:', e);
      alert('Error al guardar: ' + e.message);
    }
    setSaving(false);
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigation.replace('RoleSelection');
  };

  if (!user) return <View style={styles.container}><ActivityIndicator color="#E04644" /></View>;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${uid}&color=255-255-255&bgcolor=24-26-31`;
  const activeAvatarObj = AVATARS.find(a => a.id === selectedAvatar) || AVATARS[0];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.headerCategory}>PACIENTE</Text>
          <Text style={styles.headerTitle}>Mi Perfil</Text>
        </View>
        <TouchableOpacity 
          style={[styles.saveHeaderBtn, savedSuccess && { backgroundColor: '#43C667' }]} 
          onPress={handleSaveProfile}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : savedSuccess ? (
            <Text style={styles.saveHeaderBtnText}>✓ LISTO</Text>
          ) : (
            <Text style={styles.saveHeaderBtnText}>GUARDAR</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Avatar & Photo Card */}
        <Animatable.View animation="fadeInDown" style={styles.card}>
          <Text style={styles.sectionLabel}>TU FOTO O AVATAR</Text>

          <View style={styles.previewContainer}>
            <View style={styles.bigPreviewCircle}>
              {foto ? (
                <Image source={{ uri: foto }} style={styles.previewImage} />
              ) : (
                <MaterialCommunityIcons name={activeAvatarObj.id} size={48} color="#374151" />
              )}
            </View>
            <Text style={styles.previewStatusText}>
              {foto ? 'Foto personalizada' : `Avatar: ${activeAvatarObj.label}`}
            </Text>
          </View>

          <View style={styles.photoActionsRow}>
            <TouchableOpacity style={styles.photoActionBtn} onPress={handleTakePhoto} activeOpacity={0.8}>
              <MaterialCommunityIcons name="camera" size={17} color="#E5E7EB" style={{ marginRight: 6 }} />
              <Text style={styles.photoActionBtnText}>Tomar Foto</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.photoActionBtn} onPress={handlePickGallery} activeOpacity={0.8}>
              <MaterialCommunityIcons name="image-outline" size={17} color="#E5E7EB" style={{ marginRight: 6 }} />
              <Text style={styles.photoActionBtnText}>Subir Foto</Text>
            </TouchableOpacity>
          </View>

          {foto && (
            <TouchableOpacity style={styles.removePhotoBtn} onPress={handleRemovePhoto}>
              <MaterialCommunityIcons name="close-circle-outline" size={15} color="#9CA3AF" style={{ marginRight: 4 }} />
              <Text style={styles.removePhotoBtnText}>Quitar foto y usar avatar</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={[styles.dropdownToggleBtn, showAvatarDropdown && styles.dropdownToggleBtnActive]} 
            onPress={() => setShowAvatarDropdown(!showAvatarDropdown)}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="emoticon-outline" size={20} color="#D4A359" style={{ marginRight: 8 }} />
              <Text style={styles.dropdownToggleText}>
                {foto ? 'Opciones de avatar ilustrado' : `Avatar: ${activeAvatarObj.label}`}
              </Text>
            </View>
            <MaterialCommunityIcons 
              name={showAvatarDropdown ? 'chevron-up' : 'chevron-down'} 
              size={20} 
              color="#9CA3AF" 
            />
          </TouchableOpacity>

          {showAvatarDropdown && (
            <Animatable.View animation="fadeIn" duration={200} style={styles.dropdownContent}>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.avatarHorizontalScroll}
              >
                {AVATARS.map((av) => {
                  const isSelected = !foto && selectedAvatar === av.id;
                  return (
                    <TouchableOpacity 
                      key={av.id} 
                      style={[
                        styles.avatarCompactItem, 
                        isSelected && { borderColor: '#43C667', backgroundColor: '#181A1F' }
                      ]} 
                      onPress={() => {
                        handleSelectAvatar(av.id);
                        setShowAvatarDropdown(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name={av.id} size={28} color={av.color} />
                      <Text style={[styles.avatarLabel, isSelected && { color: '#FFF', fontWeight: '700' }]}>
                        {av.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </Animatable.View>
          )}
        </Animatable.View>

        {/* Basic Info Card */}
        <Animatable.View animation="fadeInUp" delay={100} style={styles.card}>
          <Text style={styles.sectionLabel}>DATOS PERSONALES</Text>

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.inputLabel}>Nombre</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: Franco"
                placeholderTextColor="#6B7280"
                value={nombre}
                onChangeText={setNombre}
              />
            </View>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.inputLabel}>Apellido</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: Gómez"
                placeholderTextColor="#6B7280"
                value={apellido}
                onChangeText={setApellido}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.inputLabel}>Edad</Text>
              <TextInput 
                style={[styles.input, { marginBottom: 4 }]} 
                placeholder="Ej: 68"
                placeholderTextColor="#6B7280"
                keyboardType="numeric"
                maxLength={3}
                value={edad}
                onChangeText={setEdad}
              />
            </View>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.inputLabel}>Grupo Sanguíneo</Text>
              <TextInput 
                style={[styles.input, { marginBottom: 4 }]} 
                placeholder="Ej: O+"
                placeholderTextColor="#6B7280"
                maxLength={4}
                autoCapitalize="characters"
                value={tipoSangre}
                onChangeText={setTipoSangre}
              />
            </View>
          </View>
        </Animatable.View>

        {/* Emergency Medical Sheet Card */}
        <Animatable.View animation="fadeInUp" delay={200} style={styles.card}>
          <Text style={styles.sectionLabel}>FICHA MÉDICA DE EMERGENCIA</Text>
          <Text style={styles.sectionDesc}>Esta información ayudará a los médicos y familiares en caso de alerta o caída.</Text>

          <Text style={styles.inputLabel}>Condiciones Médicas / Diagnósticos</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Ej: Hipertensión, Marcapasos, Diabético"
            placeholderTextColor="#6B7280"
            value={condiciones}
            onChangeText={setCondiciones}
          />

          <Text style={styles.inputLabel}>Alergias a Medicamentos</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Ej: Alérgico a la Penicilina, Ninguna"
            placeholderTextColor="#6B7280"
            value={alergias}
            onChangeText={setAlergias}
          />

          <Text style={styles.inputLabel}>Teléfono de Contacto de Emergencia</Text>
          <TextInput 
            style={[styles.input, { marginBottom: 4 }]} 
            placeholder="Ej: +54 9 11 2345-6789"
            placeholderTextColor="#6B7280"
            keyboardType="phone-pad"
            value={telefonoEmergencia}
            onChangeText={setTelefonoEmergencia}
          />
        </Animatable.View>

        {/* Link Code & QR Card */}
        <Animatable.View animation="fadeInUp" delay={300} style={styles.card}>
          <Text style={styles.sectionLabel}>CÓDIGO DE VINCULACIÓN FAMILIAR</Text>
          <Text style={styles.codeText}>{uid}</Text>
          <Text style={styles.sectionDesc}>Tu familiar puede escanear este código o escribirlo para comenzar a monitorearte.</Text>
          
          <View style={styles.qrWrapper}>
            <Image source={{ uri: qrUrl }} style={styles.qrImage} />
          </View>
        </Animatable.View>

        {/* Big Save Button */}
        <TouchableOpacity 
          style={[styles.bigSaveBtn, savedSuccess && { backgroundColor: '#43C667' }]} 
          onPress={handleSaveProfile}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : savedSuccess ? (
            <Text style={styles.bigSaveBtnText}>✓ PERFIL GUARDADO</Text>
          ) : (
            <Text style={styles.bigSaveBtnText}>GUARDAR CAMBIOS</Text>
          )}
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <MaterialCommunityIcons name="logout" size={18} color="#E04644" />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 42, paddingHorizontal: 20, paddingBottom: 15 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },
  headerCategory: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 2 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  saveHeaderBtn: { backgroundColor: '#E04644', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  saveHeaderBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  
  scrollContent: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 60 },

  card: { backgroundColor: '#22252A', borderRadius: 22, padding: 20, marginBottom: 16 },
  sectionLabel: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 12 },
  sectionDesc: { color: '#9CA3AF', fontSize: 13, lineHeight: 19, marginBottom: 16 },

  // Big Preview
  previewContainer: { alignItems: 'center', marginVertical: 8 },
  bigPreviewCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  previewStatusText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', marginTop: 8 },

  // Photo Action Buttons
  photoActionsRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 4 },
  photoActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#181A1F', paddingVertical: 12, borderRadius: 14 },
  photoActionBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  removePhotoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, marginTop: 4 },
  removePhotoBtnText: { color: '#9CA3AF', fontSize: 12, fontWeight: '600' },

  // Dropdown for Avatars
  dropdownToggleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#181A1F', paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, marginTop: 10 },
  dropdownToggleBtnActive: { borderWidth: 1, borderColor: '#D4A359' },
  dropdownToggleText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  dropdownContent: { marginTop: 10, paddingVertical: 4 },
  avatarHorizontalScroll: { paddingVertical: 4, gap: 10 },
  avatarCompactItem: { width: 76, backgroundColor: '#181A1F', borderRadius: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  avatarLabel: { color: '#9CA3AF', fontSize: 10, fontWeight: '600', marginTop: 4 },

  // Inputs
  row: { flexDirection: 'row' },
  inputLabel: { color: '#E8EAED', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#181A1F', color: '#FFF', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, marginBottom: 14 },

  // Code & QR
  codeText: { color: '#E04644', fontSize: 30, fontWeight: '800', letterSpacing: 3, marginBottom: 6 },
  qrWrapper: { alignSelf: 'center', padding: 14, backgroundColor: '#181A1F', borderRadius: 18, marginTop: 6 },
  qrImage: { width: 200, height: 200 },

  // Buttons
  bigSaveBtn: { backgroundColor: '#E04644', paddingVertical: 16, borderRadius: 18, alignItems: 'center', marginTop: 6, marginBottom: 14 },
  bigSaveBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  logoutText: { color: '#E04644', fontSize: 14, fontWeight: '700', marginLeft: 6 }
});
