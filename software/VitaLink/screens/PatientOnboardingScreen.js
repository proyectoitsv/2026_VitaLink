import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  TextInput, 
  Image, 
  StatusBar, 
  ActivityIndicator, 
  Alert, 
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import * as ImagePicker from 'expo-image-picker';
import { AVATARS } from '../constants/avatars';

export default function PatientOnboardingScreen({ navigation }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uid, setUid] = useState(null);

  // Form State
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('account-circle');
  const [foto, setFoto] = useState(null);
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);

  // Medical Info State
  const [edad, setEdad] = useState('');
  const [tipoSangre, setTipoSangre] = useState('');
  const [telefonoEmergencia, setTelefonoEmergencia] = useState('');

  // Link status
  const [familiarLinked, setFamiliarLinked] = useState(false);

  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    // Asegurar usuario paciente anónimo
    let unsubUserDoc = () => {};
    const initUser = async () => {
      let u = auth.currentUser;
      if (!u) {
        try {
          const res = await signInAnonymously(auth);
          u = res.user;
        } catch (e) {
          console.error('Error auth anon:', e);
        }
      }
      if (u) {
        const cleanUid = u.uid.substring(0, 8);
        setUid(cleanUid);

        // Escuchar si un familiar se vincula en tiempo real
        unsubUserDoc = onSnapshot(doc(db, 'pacientes', cleanUid), (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.familiarVinculado) {
              setFamiliarLinked(true);
            }
          }
        });
      }
    };

    initUser();
    return () => unsubUserDoc();
  }, []);

  // Al detectarse vinculación del familiar en el paso 4, entrar automáticamente
  useEffect(() => {
    if (familiarLinked && step === 4) {
      const timer = setTimeout(() => {
        handleFinish(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [familiarLinked, step]);

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso necesario', 'Se necesita acceso a la cámara para tomar una foto.');
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
        Alert.alert('Permiso necesario', 'Se necesita acceso a la galería para elegir una foto.');
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

  const handleNextStep1 = () => {
    if (!nombre.trim()) {
      Alert.alert('Campo requerido', 'Por favor ingresá tu nombre para continuar.');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    setStep(3);
  };

  const handleNextStep3 = async () => {
    // Guardar los datos en Firestore antes de pasar al paso de vinculación
    await saveUserData(false);
    setStep(4);
  };

  const saveUserData = async (isComplete) => {
    if (!uid) return;
    try {
      await setDoc(doc(db, 'pacientes', uid), {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        avatar: selectedAvatar,
        foto: foto || null,
        edad: edad.trim(),
        tipoSangre: tipoSangre.trim().toUpperCase(),
        telefonoEmergencia: telefonoEmergencia.trim(),
        perfilCompletado: isComplete,
        activo: true,
        actualizado: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error('Error guardando paciente en onboarding:', e);
    }
  };

  const handleFinish = async (skipped = false) => {
    setLoading(true);
    await saveUserData(true);
    setLoading(false);
    navigation.replace('Patient');
  };

  const activeAvatarObj = AVATARS.find(a => a.id === selectedAvatar) || AVATARS[0];
  const qrUrl = uid ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}&color=255-255-255&bgcolor=18-18-18` : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />

      {/* Top Bar & Step Progress */}
      <View style={styles.topBar}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => {
            if (step > 1) setStep(step - 1);
            else navigation.goBack();
          }}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color="#FFF" />
        </TouchableOpacity>

        {/* Step Indicator Pills */}
        <View style={styles.stepsPillContainer}>
          {[1, 2, 3, 4].map((i) => (
            <View 
              key={i} 
              style={[
                styles.stepDot, 
                i === step ? styles.stepDotActive : i < step ? styles.stepDotCompleted : null
              ]} 
            />
          ))}
        </View>

        <View style={styles.stepCounterWrapper}>
          <Text style={styles.stepCounterText}>{step}/4</Text>
        </View>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={styles.contentContainer}
      >
        {/* STEP 1: Nombre y Apellido */}
        {step === 1 && (
          <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons name="account" size={32} color="#FF2D55" />
              </View>
              <Text style={styles.title}>¿Cómo te llamás?</Text>
              <Text style={styles.subtitle}>
                Ingresá tus datos para que tus familiares y médicos te reconozcan.
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>NOMBRE</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: Franco"
                placeholderTextColor="#555"
                value={nombre}
                onChangeText={setNombre}
                autoFocus
              />

              <Text style={styles.label}>APELLIDO</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: Castillo"
                placeholderTextColor="#555"
                value={apellido}
                onChangeText={setApellido}
              />
            </View>

            <View style={styles.bottomActions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep1} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Continuar</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#000" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          </Animatable.View>
        )}

        {/* STEP 2: Foto o Avatar */}
        {step === 2 && (
          <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.title}>Tu Foto o Avatar</Text>
              <Text style={styles.subtitle}>
                Elegí cómo querés identificarte en la pantalla de tu familiar.
              </Text>
            </View>

            {/* Preview Circle */}
            <View style={styles.avatarPreviewSection}>
              <View style={[styles.avatarCirclePreview, foto && styles.avatarCircleWithPhoto]}>
                {foto ? (
                  <Image source={{ uri: foto }} style={styles.avatarImg} />
                ) : (
                  <MaterialCommunityIcons name={activeAvatarObj.id} size={46} color={activeAvatarObj.color} />
                )}
              </View>
              <Text style={styles.avatarStatusText}>
                {foto ? 'Foto personalizada' : `Avatar: ${activeAvatarObj.label}`}
              </Text>
            </View>

            {/* Photo Action Buttons */}
            <View style={styles.photoBtnRow}>
              <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.8}>
                <MaterialCommunityIcons name="camera" size={18} color="#FFF" style={{ marginRight: 6 }} />
                <Text style={styles.photoBtnText}>Tomar Foto</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.photoBtn} onPress={handlePickGallery} activeOpacity={0.8}>
                <MaterialCommunityIcons name="image-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
                <Text style={styles.photoBtnText}>Subir Foto</Text>
              </TouchableOpacity>
            </View>

            {foto && (
              <TouchableOpacity 
                style={styles.removePhotoBtn} 
                onPress={() => setFoto(null)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="close-circle-outline" size={15} color="#8E8E93" style={{ marginRight: 4 }} />
                <Text style={styles.removePhotoText}>Quitar foto y usar avatar</Text>
              </TouchableOpacity>
            )}

            {/* Compact Collapsible Dropdown for Illustrated Avatars */}
            <TouchableOpacity 
              style={[styles.dropdownBtn, showAvatarDropdown && styles.dropdownBtnActive]} 
              onPress={() => setShowAvatarDropdown(!showAvatarDropdown)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name="emoticon-outline" size={18} color="#FF9500" style={{ marginRight: 8 }} />
                <Text style={styles.dropdownBtnText}>
                  {foto ? 'Elegir avatar ilustrado' : `Avatar: ${activeAvatarObj.label}`}
                </Text>
              </View>
              <MaterialCommunityIcons 
                name={showAvatarDropdown ? 'chevron-up' : 'chevron-down'} 
                size={18} 
                color="#8E8E93" 
              />
            </TouchableOpacity>

            {showAvatarDropdown && (
              <View style={styles.avatarScrollContainer}>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.avatarScrollContent}
                >
                  {AVATARS.map((av) => {
                    const isSelected = !foto && selectedAvatar === av.id;
                    return (
                      <TouchableOpacity 
                        key={av.id} 
                        style={[
                          styles.avatarItem, 
                          isSelected && { borderColor: av.color, backgroundColor: 'rgba(255,255,255,0.08)' }
                        ]} 
                        onPress={() => {
                          setSelectedAvatar(av.id);
                          setFoto(null);
                          setShowAvatarDropdown(false);
                        }}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons name={av.id} size={26} color={av.color} />
                        <Text style={[styles.avatarItemText, isSelected && { color: '#FFF', fontWeight: '700' }]}>
                          {av.label}
                        </Text>
                        {isSelected && <View style={[styles.avatarDot, { backgroundColor: av.color }]} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.bottomActions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep2} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Continuar</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#000" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          </Animatable.View>
        )}

        {/* STEP 3: Ficha Médica de Emergencia */}
        {step === 3 && (
          <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.iconCircle}>
                <MaterialCommunityIcons name="clipboard-pulse-outline" size={32} color="#34C759" />
              </View>
              <Text style={styles.title}>Ficha de Salud</Text>
              <Text style={styles.subtitle}>
                Información de emergencia opcional para asistir a tus cuidadores.
              </Text>
            </View>

            <View style={styles.formGroup}>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.label}>EDAD</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="Ej: 68"
                    placeholderTextColor="#555"
                    keyboardType="number-pad"
                    value={edad}
                    onChangeText={setEdad}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.label}>GRUPO SANGUÍNEO</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="Ej: O+"
                    placeholderTextColor="#555"
                    autoCapitalize="characters"
                    value={tipoSangre}
                    onChangeText={setTipoSangre}
                  />
                </View>
              </View>

              <Text style={styles.label}>TELÉFONO DE CONTACTO</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: +54 9 11 1234-5678"
                placeholderTextColor="#555"
                keyboardType="phone-pad"
                value={telefonoEmergencia}
                onChangeText={setTelefonoEmergencia}
              />
            </View>

            <View style={styles.bottomActions}>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep3} activeOpacity={0.8}>
                <Text style={styles.primaryBtnText}>Continuar</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#000" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          </Animatable.View>
        )}

        {/* STEP 4: Vincular con un Familiar (Paso Final) */}
        {step === 4 && (
          <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.title}>Vinculá a tu Familiar</Text>
              <Text style={styles.subtitle}>
                Tu familiar debe escanear este código QR o ingresar tu código en su aplicación.
              </Text>
            </View>

            {/* Code Box & QR */}
            <View style={styles.linkCard}>
              <View style={styles.codeBadge}>
                <Text style={styles.codeText}>{uid || '...'}</Text>
              </View>

              {qrUrl ? (
                <View style={styles.qrBox}>
                  <Image source={{ uri: qrUrl }} style={styles.qrImage} />
                </View>
              ) : (
                <ActivityIndicator color="#FF2D55" style={{ marginVertical: 30 }} />
              )}

              {/* Dynamic Status / Auto-entry indicator */}
              {familiarLinked ? (
                <Animatable.View animation="bounceIn" style={styles.linkedSuccessBadge}>
                  <MaterialCommunityIcons name="check-circle" size={20} color="#34C759" style={{ marginRight: 6 }} />
                  <Text style={styles.linkedSuccessText}>¡Familiar vinculado! Ingresando...</Text>
                </Animatable.View>
              ) : (
                <View style={styles.waitingBadge}>
                  <Animatable.View 
                    animation="pulse" 
                    iterationCount="infinite" 
                    style={styles.waitingDot} 
                  />
                  <Text style={styles.waitingText}>Esperando que tu familiar se conecte...</Text>
                </View>
              )}
            </View>

            {/* Bottom Actions: Omitir */}
            <View style={styles.bottomActionsFinal}>
              <TouchableOpacity 
                style={styles.skipBtn} 
                onPress={() => handleFinish(true)}
                activeOpacity={0.7}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#8E8E93" />
                ) : (
                  <>
                    <Text style={styles.skipBtnText}>Omitir por ahora y comenzar</Text>
                    <MaterialCommunityIcons name="arrow-right" size={16} color="#8E8E93" style={{ marginLeft: 4 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Animatable.View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },

  // Top Bar
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  stepsPillContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 20, height: 6, borderRadius: 3, backgroundColor: '#222' },
  stepDotActive: { width: 32, backgroundColor: '#FF2D55' },
  stepDotCompleted: { backgroundColor: '#34C759' },
  stepCounterWrapper: { width: 40, alignItems: 'flex-end' },
  stepCounterText: { color: '#8E8E93', fontSize: 13, fontWeight: '700' },

  // Content Container (Fixed layout, NO scroll overflow)
  contentContainer: { flex: 1, paddingHorizontal: 22, justifyContent: 'center' },
  stepCard: { flex: 1, justifyContent: 'space-between', paddingVertical: 10 },

  // Step Header
  stepHeader: { alignItems: 'center', marginBottom: 12 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,45,85,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,45,85,0.2)' },
  title: { color: '#FFF', fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3, marginBottom: 8 },
  subtitle: { color: '#8E8E93', fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },

  // Form Elements
  formGroup: { marginVertical: 8 },
  label: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  input: { backgroundColor: '#141414', color: '#FFF', fontSize: 16, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, marginBottom: 14, borderWidth: 1, borderColor: '#222' },
  row: { flexDirection: 'row' },

  // Avatar Step
  avatarPreviewSection: { alignItems: 'center', marginVertical: 6 },
  avatarCirclePreview: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#141414', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  avatarCircleWithPhoto: { borderColor: '#34C759' },
  avatarImg: { width: '100%', height: '100%' },
  avatarStatusText: { color: '#8E8E93', fontSize: 12, fontWeight: '600', marginTop: 6 },

  photoBtnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  photoBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  removePhotoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  removePhotoText: { color: '#8E8E93', fontSize: 11, fontWeight: '600' },

  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#121212', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  dropdownBtnActive: { borderColor: '#FF9500', backgroundColor: 'rgba(255, 149, 0, 0.08)' },
  dropdownBtnText: { color: '#EEE', fontSize: 12, fontWeight: '700' },
  avatarScrollContainer: { marginTop: 8 },
  avatarScrollContent: { gap: 8, paddingVertical: 2 },
  avatarItem: { width: 70, backgroundColor: '#141414', borderRadius: 12, paddingVertical: 8, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent', position: 'relative' },
  avatarItemText: { color: '#777', fontSize: 9, fontWeight: '600', marginTop: 3 },
  avatarDot: { position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: 2.5 },

  // Step 4: Link Card
  linkCard: { alignItems: 'center', backgroundColor: '#121212', borderRadius: 22, padding: 16, marginVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  codeBadge: { backgroundColor: '#1E1E1E', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  codeText: { color: '#FF2D55', fontSize: 24, fontWeight: '900', letterSpacing: 3 },
  qrBox: { padding: 10, backgroundColor: '#181818', borderRadius: 16, marginBottom: 12 },
  qrImage: { width: 140, height: 140 },

  waitingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,149,0,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,149,0,0.25)' },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF9500', marginRight: 8 },
  waitingText: { color: '#FF9500', fontSize: 11, fontWeight: '700' },
  linkedSuccessBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52,199,89,0.15)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(52,199,89,0.3)' },
  linkedSuccessText: { color: '#34C759', fontSize: 12, fontWeight: '800' },

  // Bottom Buttons
  bottomActions: { marginTop: 16, marginBottom: 10 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', paddingVertical: 16, borderRadius: 16, shadowColor: '#FFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 },
  primaryBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },

  bottomActionsFinal: { alignItems: 'center', marginTop: 10, marginBottom: 8 },
  skipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  skipBtnText: { color: '#8E8E93', fontSize: 13, fontWeight: '700' }
});
