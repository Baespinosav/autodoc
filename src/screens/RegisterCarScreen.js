import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, SafeAreaView, ScrollView, Image, Animated } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import DocumentPicker from 'react-native-document-picker';
import storage from '@react-native-firebase/storage';
import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import Logo from '../assets/Logo.png';
import { Platform } from 'react-native';
import RNFetchBlob from 'rn-fetch-blob';
import RNFS from 'react-native-fs';

/**
 * Componente RegisterCar que permite al usuario registrar un nuevo vehículo.
 * Permite seleccionar documentos necesarios y subirlos a Firebase.
 * @returns {JSX.Element} Componente de registro de vehículo.
 */
const RegisterCar = () => {
  const navigation = useNavigation();
  const [marca, setMarca] = useState('Subaru'); // Estado para almacenar la marca del vehículo
  const [modelo, setModelo] = useState('Impreza'); // Estado para almacenar el modelo del vehículo
  const [año, setAño] = useState(new Date().getFullYear()); // Estado para almacenar el año del vehículo
  const [patente, setPatente] = useState(''); // Estado para almacenar la patente del vehículo
  const [documents, setDocuments] = useState({
    permisoCirculacion: null,
    soap: null,
    revisionTecnica: null
  }); // Estado para almacenar los documentos del vehículo

  const scaleAnim1 = useRef(new Animated.Value(1)).current; // Animación para el primer círculo
  const scaleAnim2 = useRef(new Animated.Value(1)).current; // Animación para el segundo círculo

  useEffect(() => {
    // Inicia las animaciones de escalado en bucle
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim1, {
            toValue: 1.03,
            duration: 3000,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim1, {
            toValue: 1,
            duration: 3000,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(scaleAnim2, {
            toValue: 1.05,
            duration: 2500,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim2, {
            toValue: 0.97,
            duration: 2500,
            useNativeDriver: true,
          }),
        ]),
      ])
    ).start();
  }, []);

  const currentYear = new Date().getFullYear(); // Obtiene el año actual
  const years = Array.from({ length: currentYear - 1899 }, (_, i) => currentYear - i); // Crea un array de años desde 1900 hasta el año actual

  /**
   * Permite al usuario seleccionar un documento desde su dispositivo.
   * @param {string} documentType - Tipo de documento a seleccionar (permisoCirculacion, soap, revisionTecnica).
   */
  const pickDocument = async (documentType) => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.pdf],
      });
      setDocuments(prev => ({
        ...prev,
        [documentType]: {
          uri: result[0].uri,
          name: result[0].name
        }
      }));
    } catch (err) {
      if (DocumentPicker.isCancel(err)) {
        console.log('User cancelled the picker');
      } else {
        console.error('Error al seleccionar el documento:', err);
        Alert.alert('Error', 'No se pudo seleccionar el documento');
      }
    }
  };

  /**
   * Sube un documento PDF a Firebase Storage.
   * @param {string} documentType - Tipo de documento a subir.
   * @returns {Promise<string|null>} URL del documento subido o null si no hay documento.
   */
  const uploadPdf = async (documentType) => {
    const doc = documents[documentType];
    if (!doc) {
      console.log(`No hay documento para ${documentType}`);
      return null;
    }
    try {
      console.log(`Iniciando subida de ${documentType}...`);
      const timestamp = Date.now();
      const storagePath = `vehicle_documents/${auth().currentUser.uid}/${timestamp}_${doc.name}`;
      console.log('Ruta de almacenamiento:', storagePath);

      const reference = storage().ref(storagePath);
      console.log('Referencia creada:', reference.fullPath);

      console.log('Preparando archivo para subir...');
      console.log('URI del archivo:', doc.uri);

      // Convertir content:// URI a file:// URI en Android
      let fileUri = doc.uri;
      if (Platform.OS === 'android' && doc.uri.startsWith('content://')) {
        const destPath = `${RNFS.CachesDirectoryPath}/${doc.name}`;
        await RNFS.copyFile(doc.uri, destPath);
        fileUri = `file://${destPath}`;
      }
      console.log('File URI:', fileUri);

      // Leer el archivo como una cadena base64
      const base64Data = await RNFS.readFile(fileUri, 'base64');
      console.log('Archivo leído como base64');

      // Subir el archivo
      const uploadTask = reference.putString(base64Data, 'base64', { contentType: 'application/pdf' });

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          uploadTask.cancel();
          reject(new Error('Timeout: La subida tardó demasiado'));
        }, 60000); // 60 segundos de timeout

        uploadTask.on(
          storage.TaskEvent.STATE_CHANGED,
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log(`Progreso de subida ${documentType}: ${progress.toFixed(2)}%`);
          },
          (error) => {
            clearTimeout(timeout);
            console.error('Error durante la subida:', error);
            reject(error);
          },
          async () => {
            clearTimeout(timeout);
            console.log('Subida completada');
            try {
              const url = await reference.getDownloadURL();
              console.log('URL de descarga:', url);
              resolve(url);
            } catch (urlError) {
              console.error('Error al obtener la URL de descarga:', urlError);
              reject(urlError);
            }
          }
        );
      });
    } catch (error) {
      console.error(`Error detallado al subir ${documentType}:`, JSON.stringify(error, null, 2));
      throw error;
    }
  };

  /**
   * Registra un nuevo vehículo en Firestore.
   * Valida los campos y sube los documentos necesarios.
   */
  const registerCar = async () => {
    try {
      if (!marca || !modelo || !año || !patente) {
        Alert.alert('Error', 'Por favor, complete todos los campos obligatorios');
        return;
      }

      const documentUrls = {};
      const documentTypes = ['permisoCirculacion', 'soap', 'revisionTecnica'];

      for (const docType of documentTypes) {
        if (documents[docType]) {
          try {
            const url = await uploadPdf(docType);
            if (url) {
              documentUrls[docType] = url;
            } else {
              console.log(`No se pudo obtener la URL para ${docType}`);
            }
          } catch (uploadError) {
            console.error(`Error al subir ${docType}:`, uploadError);
            Alert.alert('Error', `No se pudo subir el documento ${docType}. Por favor, inténtelo de nuevo.`);
            return;
          }
        } else {
          console.log(`No se seleccionó documento para ${docType}`);
        }
      }

      const docRef = await firestore().collection('vehicles').add({
        marca,
        modelo,
        año: parseInt(año, 10),
        patente,
        ...documentUrls,
        userId: auth().currentUser.uid,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      console.log('Vehículo registrado con ID:', docRef.id);

      Alert.alert(
        'Éxito',
        'Vehículo registrado correctamente',
        [{ text: 'OK', onPress: () => navigation.navigate('ReadyUse', { refreshVehicles: true }) }]
      );
    } catch (error) {
      console.error('Error al registrar vehículo:', error);
      Alert.alert('Error', 'No se pudo registrar el vehículo: ' + error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.circle1, { transform: [{ scale: scaleAnim1 }] }]} />
      <Animated.View style={[styles.circle2, { transform: [{ scale: scaleAnim2 }] }]} />
      <View style={styles.header}>
        <Image source={Logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>
          <Text style={styles.boldText}>Auto</Text>Doc
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.formContainer}>
          <Text style={styles.registerMessage}>Registra tu vehículo</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={marca}
              style={styles.picker}
              onValueChange={(itemValue) => setMarca(itemValue)}
            >
              <Picker.Item label="Subaru" value="Subaru" color="black"/>
            </Picker>
          </View>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={modelo}
              style={styles.picker}
              onValueChange={(itemValue) => setModelo(itemValue)}
            >
              <Picker.Item label="Impreza" value="Impreza" color="black" />
            </Picker>
          </View>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={año}
              style={styles.picker}
              onValueChange={(itemValue) => setAño(itemValue)}
            >
              {years.map((year) => (
                <Picker.Item key={year} label={year.toString()} value={year} color="black" />
              ))}
            </Picker>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Patente"
            placeholderTextColor="#7f8c8d"
            value={patente}
            onChangeText={setPatente}
          />
          <TouchableOpacity style={styles.documentButton} onPress={() => pickDocument('permisoCirculacion')}>
            <Text style={styles.documentButtonText}>Seleccionar Permiso de Circulación</Text>
          </TouchableOpacity>
          {documents.permisoCirculacion && <Text style={styles.documentName}>Documento seleccionado: {documents.permisoCirculacion.name}</Text>}
          <TouchableOpacity style={styles.documentButton} onPress={() => pickDocument('soap')}>
            <Text style={styles.documentButtonText}>Seleccionar SOAP</Text>
          </TouchableOpacity>
          {documents.soap && <Text style={styles.documentName}>Documento seleccionado: {documents.soap.name}</Text>}
          <TouchableOpacity style={styles.documentButton} onPress={() => pickDocument('revisionTecnica')}>
            <Text style={styles.documentButtonText}>Seleccionar Revisión Técnica</Text>
          </TouchableOpacity>
          {documents.revisionTecnica && <Text style={styles.documentName}>Documento seleccionado: {documents.revisionTecnica.name}</Text>}
          <TouchableOpacity style={styles.registerButton} onPress={registerCar}>
            <Text style={styles.registerButtonText}>Registrar Vehículo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Volver</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  circle1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#e8f4fd',
    top: -200,
    left: -50,
    zIndex: 1,
  },
  circle2: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#d1e8fa',
    top: -180,
    right: -100,
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    zIndex: 3,
  },
  logo: {
    width: 40,
    height: 40,
    marginRight: 10,
  },
  title: {
    fontSize: 24,
    color: '#333',
  },
  boldText: {
    fontWeight: 'bold',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingTop: 40,
    zIndex: 3,
  },
  formContainer: {
    width: '100%',
  },
  registerMessage: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  pickerContainer: {
    backgroundColor: '#e8e8e8',
    borderRadius: 8,
    marginBottom: 15,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
    width: '100%',
  },
  input: {
    backgroundColor: '#e8e8e8',
    width: '100%',
    height: 50,
    borderRadius: 8,
    marginBottom: 15,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#000',
  },
  documentButton: {
    backgroundColor: '#ffffff',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#000000',
  },
  documentButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  documentName: {
    marginVertical: 10,
    fontSize: 14,
    color: '#333',
  },
  registerButton: {
    backgroundColor: '#001f3f', // Azul muy oscuro, casi negro
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  registerButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backButton: {
    backgroundColor: '#000000',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default RegisterCar;
