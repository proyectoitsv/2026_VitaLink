import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDnX37ylaU9GGStpBzyJFIbkRA40W9ccWc",
  authDomain: "vitalink-app-92745.firebaseapp.com",
  projectId: "vitalink-app-92745",
  storageBucket: "vitalink-app-92745.firebasestorage.app",
  messagingSenderId: "1019914670401",
  appId: "1:1019914670401:web:b295828dc18f891a98d1c0"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
