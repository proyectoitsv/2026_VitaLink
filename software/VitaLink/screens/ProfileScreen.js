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
  StatusBar 
} from 'react-native';
import { getAuth, signOut } from '@react-native-firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from '@react-native-firebase/firestore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';

const AVATARS = [
  { id: 'account-circle', label: 'Estándar', color: '#0A84FF' },
  { id: 'face-man-profile', label: 'Hombre', color: '#30D158' },
  { id: 'face-woman-profile', label: 'Mujer', color: '#FF375F' },
  { id: 'emoticon-happy-outline', label: 'Alegre', color: '#FFD60A' },
  { id: 'shield-heart', label: 'Protección', color: '#FF2D55' },
  { id: 'medical-bag', label: 'Clínico', color: '#64D2FF' },
];

export default function ProfileScreen({ navigation }) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('account-circle');
  
  // Ficha Médica
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

  const handleSaveProfile = async () => {
    if (!user || !uid) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      await setDoc(doc(db, 'pacientes', uid), { 
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        avatar: selectedAvatar,
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

  if (!user) return <View style={styles.container}><ActivityIndicator color="#FF2D55" /></View>;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}&color=255-255-255&bgcolor=18-18-18`;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialCommunityIcons name="chevron-left" size={32} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mi Perfil</Text>
        <TouchableOpacity 
          style={[styles.saveHeaderBtn, savedSuccess && { backgroundColor: '#34C759' }]} 
          onPress={handleSaveProfile}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#000" />
          ) : savedSuccess ? (
            <Text style={styles.saveHeaderBtnText}>✓ LISTO</Text>
          ) : (
            <Text style={styles.saveHeaderBtnText}>GUARDAR</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Avatar Selector Card */}
        <Animatable.View animation="fadeInDown" style={styles.card}>
          <Text style={styles.sectionLabel}>ELEGÍ TU AVATAR</Text>
          <View style={styles.avatarRow}>
            {AVATARS.map((av) => {
              const isSelected = selectedAvatar === av.id;
              return (
                <TouchableOpacity 
                  key={av.id} 
                  style={[styles.avatarOption, isSelected && { borderColor: av.color, backgroundColor: 'rgba(255,255,255,0.08)' }]} 
                  onPress={() => setSelectedAvatar(av.id)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name={av.id} size={32} color={av.color} />
                  {isSelected && <View style={[styles.avatarDot, { backgroundColor: av.color }]} />}
                </TouchableOpacity>
              );
            })}
          </View>
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
                placeholderTextColor="#555"
                value={nombre}
                onChangeText={setNombre}
              />
            </View>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.inputLabel}>Apellido</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: Castillo"
                placeholderTextColor="#555"
                value={apellido}
                onChangeText={setApellido}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.inputLabel}>Edad</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: 68"
                placeholderTextColor="#555"
                keyboardType="numeric"
                maxLength={3}
                value={edad}
                onChangeText={setEdad}
              />
            </View>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.inputLabel}>Grupo Sanguíneo</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Ej: 0+"
                placeholderTextColor="#555"
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
          <View style={styles.cardHeaderRow}>
            <MaterialCommunityIcons name="card-account-details-outline" size={20} color="#FF2D55" />
            <Text style={[styles.sectionLabel, { marginLeft: 8, marginBottom: 0 }]}>FICHA MÉDICA DE EMERGENCIA</Text>
          </View>
          <Text style={styles.sectionDesc}>Esta información ayudará a los médicos y familiares en caso de alerta o caída.</Text>

          <Text style={styles.inputLabel}>Condiciones Médicas / Diagnósticos</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Ej: Hipertensión, Marcapasos, Diabético"
            placeholderTextColor="#555"
            value={condiciones}
            onChangeText={setCondiciones}
          />

          <Text style={styles.inputLabel}>Alergias a Medicamentos</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Ej: Alérgico a la Penicilina, Ninguna"
            placeholderTextColor="#555"
            value={alergias}
            onChangeText={setAlergias}
          />

          <Text style={styles.inputLabel}>Teléfono de Contacto de Emergencia</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Ej: +54 9 11 2345-6789"
            placeholderTextColor="#555"
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
          style={[styles.bigSaveBtn, savedSuccess && { backgroundColor: '#34C759' }]} 
          onPress={handleSaveProfile}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : savedSuccess ? (
            <Text style={styles.bigSaveBtnText}>✓ PERFIL GUARDADO</Text>
          ) : (
            <Text style={styles.bigSaveBtnText}>GUARDAR CAMBIOS</Text>
          )}
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <MaterialCommunityIcons name="logout" size={18} color="#FF2D55" />
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 50, paddingHorizontal: 16, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  backBtn: { padding: 4 },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  saveHeaderBtn: { backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  saveHeaderBtnText: { color: '#000', fontSize: 12, fontWeight: '800' },
  
  scrollContent: { padding: 20, paddingBottom: 60 },

  card: { backgroundColor: '#121212', borderRadius: 20, padding: 20, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sectionLabel: { color: '#8E8E93', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 12 },
  sectionDesc: { color: '#666', fontSize: 12, lineHeight: 18, marginBottom: 16 },

  // Avatar Row
  avatarRow: { flexDirection: 'row', justifyContent: 'space-between' },
  avatarOption: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent', position: 'relative' },
  avatarDot: { position: 'absolute', bottom: -2, width: 8, height: 8, borderRadius: 4 },

  // Inputs
  row: { flexDirection: 'row' },
  inputLabel: { color: '#AAA', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#181818', color: '#FFF', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#262626' },

  // Code & QR
  codeText: { color: '#FF2D55', fontSize: 28, fontWeight: '900', letterSpacing: 2, marginBottom: 6 },
  qrWrapper: { alignSelf: 'center', padding: 14, backgroundColor: '#181818', borderRadius: 16, marginTop: 10 },
  qrImage: { width: 170, height: 170 },

  // Buttons
  bigSaveBtn: { backgroundColor: '#FFF', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 10, marginBottom: 15 },
  bigSaveBtnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  logoutText: { color: '#FF2D55', fontSize: 14, fontWeight: '700', marginLeft: 6 }
});
