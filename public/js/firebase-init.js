import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA5dyDpjUkZ18Ohu__O63VqfrD5_BpFeFA',
  authDomain: 'racer-arp.firebaseapp.com',
  projectId: 'racer-arp',
  storageBucket: 'racer-arp.firebasestorage.app',
  messagingSenderId: '531388421715',
  appId: '1:531388421715:web:f62715f2a3a53f6a2b18a6',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
