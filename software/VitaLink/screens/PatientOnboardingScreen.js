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
  Platform,
  TouchableWithoutFeedback,
  Keyboard
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

  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('account-circle');
  const [foto, setFoto] = useState(null);
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);

  const [edad, setEdad] = useState('');
  const [tipoSangre, setTipoSangre] = useState('');
  const [telefonoEmergencia, setTelefonoEmergencia] = useState('');

  const [familiarLinked, setFamiliarLinked] = useState(false);

  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
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
  const qrUrl = uid ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${uid}&color=255-255-255&bgcolor=24-26-31` : null;

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} translucent={true} backgroundColor="transparent" />

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
          <MaterialCommunityIcons name="chevron-left" size={26} color="#E5E7EB" />
        </TouchableOpacity>

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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={{ flex: 1 }}>
            {/* STEP 1: Nombre y Apellido */}
            {step === 1 && (
              <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
                <View style={styles.stepHeader}>
                  <View style={styles.iconCircle}>
                    <MaterialCommunityIcons name="account" size={32} color="#E04644" />
                  </View>
                  <Text style={styles.categoryLabel}>PASO 1 DE 4</Text>
                  <Text style={styles.title}>¿Cómo te llamás?</Text>
                  <Text style={styles.subtitle}>
                    Ingresá tus datos para que tus familiares y médicos te reconozcan.
                  </Text>
                </View>

                <View style={styles.cardBox}>
                  <Text style={styles.label}>NOMBRE</Text>
                  <TextInput 
                    style={styles.input} 
                    placeholder="Ej: Franco"
                    placeholderTextColor="#6B7280"
                    value={nombre}
                    onChangeText={setNombre}
                  />

                  <Text style={styles.label}>APELLIDO</Text>
                  <TextInput 
                    style={[styles.input, { marginBottom: 4 }]} 
                    placeholder="Ej: Gómez"
                    placeholderTextColor="#6B7280"
                    value={apellido}
                    onChangeText={setApellido}
                  />
                </View>

                <View style={styles.bottomActions}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep1} activeOpacity={0.8}>
                    <Text style={styles.primaryBtnText}>Continuar</Text>
                    <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                </View>
              </Animatable.View>
            )}

            {/* STEP 2: Foto o Avatar */}
            {step === 2 && (
              <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
                <View style={styles.stepHeader}>
                  <Text style={styles.categoryLabel}>PASO 2 DE 4</Text>
                  <Text style={styles.title}>Tu Foto o Avatar</Text>
                  <Text style={styles.subtitle}>
                    Elegí cómo querés identificarte en la pantalla de tu familiar.
                  </Text>
                </View>

                <View style={styles.cardBox}>
                  <View style={styles.avatarPreviewSection}>
                    <View style={styles.avatarCirclePreview}>
                      {foto ? (
                        <Image source={{ uri: foto }} style={styles.avatarImg} />
                      ) : (
                        <MaterialCommunityIcons name={activeAvatarObj.id} size={46} color="#374151" />
                      )}
                    </View>
                    <Text style={styles.avatarStatusText}>
                      {foto ? 'Foto personalizada' : `Avatar: ${activeAvatarObj.label}`}
                    </Text>
                  </View>

                  <View style={styles.photoBtnRow}>
                    <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="camera" size={18} color="#E5E7EB" style={{ marginRight: 6 }} />
                      <Text style={styles.photoBtnText}>Tomar Foto</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.photoBtn} onPress={handlePickGallery} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="image-outline" size={18} color="#E5E7EB" style={{ marginRight: 6 }} />
                      <Text style={styles.photoBtnText}>Subir Foto</Text>
                    </TouchableOpacity>
                  </View>

                  {foto && (
                    <TouchableOpacity 
                      style={styles.removePhotoBtn} 
                      onPress={() => setFoto(null)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="close-circle-outline" size={15} color="#9CA3AF" style={{ marginRight: 4 }} />
                      <Text style={styles.removePhotoText}>Quitar foto y usar avatar</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity 
                    style={[styles.dropdownBtn, showAvatarDropdown && styles.dropdownBtnActive]} 
                    onPress={() => setShowAvatarDropdown(!showAvatarDropdown)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons name="emoticon-outline" size={18} color="#D4A359" style={{ marginRight: 8 }} />
                      <Text style={styles.dropdownBtnText}>
                        {foto ? 'Elegir avatar ilustrado' : `Avatar: ${activeAvatarObj.label}`}
                      </Text>
                    </View>
                    <MaterialCommunityIcons 
                      name={showAvatarDropdown ? 'chevron-up' : 'chevron-down'} 
                      size={18} 
                      color="#9CA3AF" 
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
                                isSelected && { borderColor: '#43C667', backgroundColor: '#181A1F' }
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
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                </View>

                <View style={styles.bottomActions}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep2} activeOpacity={0.8}>
                    <Text style={styles.primaryBtnText}>Continuar</Text>
                    <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                </View>
              </Animatable.View>
            )}

            {/* STEP 3: Ficha Médica de Emergencia */}
            {step === 3 && (
              <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCard}>
                <View style={styles.stepHeader}>
                  <View style={styles.iconCircle}>
                    <MaterialCommunityIcons name="clipboard-pulse-outline" size={32} color="#43C667" />
                  </View>
                  <Text style={styles.categoryLabel}>PASO 3 DE 4</Text>
                  <Text style={styles.title}>Ficha de Salud</Text>
                  <Text style={styles.subtitle}>
                    Información de emergencia opcional para asistir a tus cuidadores.
                  </Text>
                </View>

                <View style={styles.cardBox}>
                  <View style={styles.row}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.label}>EDAD</Text>
                      <TextInput 
                        style={styles.input} 
                        placeholder="Ej: 68"
                        placeholderTextColor="#6B7280"
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
                        placeholderTextColor="#6B7280"
                        autoCapitalize="characters"
                        value={tipoSangre}
                        onChangeText={setTipoSangre}
                      />
                    </View>
                  </View>

                  <Text style={styles.label}>TELÉFONO DE CONTACTO</Text>
                  <TextInput 
                    style={[styles.input, { marginBottom: 4 }]} 
                    placeholder="Ej: +54 9 11 1234-5678"
                    placeholderTextColor="#6B7280"
                    keyboardType="phone-pad"
                    value={telefonoEmergencia}
                    onChangeText={setTelefonoEmergencia}
                  />
                </View>

                <View style={styles.bottomActions}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep3} activeOpacity={0.8}>
                    <Text style={styles.primaryBtnText}>Continuar</Text>
                    <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                </View>
              </Animatable.View>
            )}

            {/* STEP 4: Vincular con un Familiar */}
            {step === 4 && (
              <Animatable.View animation="fadeInRight" duration={350} style={styles.stepCardLink}>
                <View style={styles.stepHeader}>
                  <Text style={styles.categoryLabel}>PASO 4 DE 4</Text>
                  <Text style={styles.title}>Vinculá a tu Familiar</Text>
                  <Text style={styles.subtitle}>
                    Tu familiar debe escanear este código QR o ingresar tu código en su aplicación.
                  </Text>
                </View>

                <View style={styles.linkCard}>
                  <Text style={styles.codeLabel}>CÓDIGO DE VINCULACIÓN</Text>
                  <View style={styles.codeBadge}>
                    <Text style={styles.codeText}>{uid || '...'}</Text>
                  </View>

                  {qrUrl ? (
                    <View style={styles.qrBox}>
                      <Image source={{ uri: qrUrl }} style={styles.qrImage} />
                    </View>
                  ) : (
                    <ActivityIndicator color="#E04644" style={{ marginVertical: 30 }} />
                  )}

                  {familiarLinked ? (
                    <Animatable.View animation="bounceIn" style={styles.linkedSuccessBadge}>
                      <MaterialCommunityIcons name="check-circle" size={18} color="#43C667" style={{ marginRight: 6 }} />
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

                <View style={styles.bottomActionsFinal}>
                  <TouchableOpacity 
                    style={styles.skipBtn} 
                    onPress={() => handleFinish(true)}
                    activeOpacity={0.7}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#E5E7EB" />
                    ) : (
                      <>
                        <Text style={styles.skipBtnText}>Omitir por ahora y comenzar</Text>
                        <MaterialCommunityIcons name="arrow-right" size={16} color="#E5E7EB" style={{ marginLeft: 6 }} />
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </Animatable.View>
            )}
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0D10' },

  // Top Bar
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 42, paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center' },
  stepsPillContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 20, height: 6, borderRadius: 3, backgroundColor: '#22252A' },
  stepDotActive: { width: 32, backgroundColor: '#E04644' },
  stepDotCompleted: { backgroundColor: '#43C667' },
  stepCounterWrapper: { width: 44, alignItems: 'flex-end' },
  stepCounterText: { color: '#9CA3AF', fontSize: 13, fontWeight: '700' },

  // Content Container
  contentContainer: { flex: 1, paddingHorizontal: 20, justifyContent: 'flex-start', paddingTop: 6 },
  stepCard: { flex: 1, justifyContent: 'flex-start', paddingVertical: 4 },
  stepCardLink: { flex: 1, justifyContent: 'space-between', paddingVertical: 4 },

  // Step Header
  stepHeader: { alignItems: 'center', marginTop: 4, marginBottom: 16 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#22252A', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  categoryLabel: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 4 },
  title: { color: '#FFF', fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { color: '#9CA3AF', fontSize: 13.5, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },

  // Card Box & Form Elements
  cardBox: { backgroundColor: '#22252A', borderRadius: 22, padding: 20 },
  label: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  input: { backgroundColor: '#181A1F', color: '#FFF', fontSize: 16, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, marginBottom: 14 },
  row: { flexDirection: 'row' },

  // Avatar Step
  avatarPreviewSection: { alignItems: 'center', marginTop: 2, marginBottom: 10 },
  avatarCirclePreview: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarStatusText: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginTop: 8 },

  photoBtnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  photoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#181A1F', paddingVertical: 12, borderRadius: 14 },
  photoBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  removePhotoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  removePhotoText: { color: '#9CA3AF', fontSize: 11, fontWeight: '600' },

  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#181A1F', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, marginTop: 10 },
  dropdownBtnActive: { borderWidth: 1, borderColor: '#D4A359' },
  dropdownBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' },
  avatarScrollContainer: { marginTop: 10 },
  avatarScrollContent: { gap: 8, paddingVertical: 2 },
  avatarItem: { width: 70, backgroundColor: '#181A1F', borderRadius: 14, paddingVertical: 8, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  avatarItemText: { color: '#9CA3AF', fontSize: 10, fontWeight: '600', marginTop: 3 },

  // Step 4: Link Card
  linkCard: { alignItems: 'center', backgroundColor: '#22252A', borderRadius: 22, paddingVertical: 18, paddingHorizontal: 18, marginVertical: 4 },
  codeLabel: { color: '#D4A359', fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 6 },
  codeBadge: { backgroundColor: '#181A1F', paddingHorizontal: 24, paddingVertical: 8, borderRadius: 14, marginBottom: 12 },
  codeText: { color: '#E04644', fontSize: 30, fontWeight: '800', letterSpacing: 3 },
  qrBox: { padding: 12, backgroundColor: '#181A1F', borderRadius: 18, marginBottom: 12 },
  qrImage: { width: 200, height: 200 },

  waitingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181A1F', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4A359', marginRight: 8 },
  waitingText: { color: '#D4A359', fontSize: 11, fontWeight: '700' },
  linkedSuccessBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#181A1F', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  linkedSuccessText: { color: '#43C667', fontSize: 13, fontWeight: '700' },

  // Bottom Buttons
  bottomActions: { marginTop: 18, marginBottom: 10 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E04644', paddingVertical: 16, borderRadius: 18 },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  bottomActionsFinal: { alignItems: 'center', marginTop: 8, marginBottom: 12 },
  skipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252A', paddingVertical: 13, paddingHorizontal: 22, borderRadius: 20 },
  skipBtnText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600' }
});
