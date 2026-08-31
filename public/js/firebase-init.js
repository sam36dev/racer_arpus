import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// TODO: substituir pelo firebaseConfig do seu app Web
// (Console Firebase > Configuracoes do projeto > Geral > Seus apps > </>).
const firebaseConfig = {
  apiKey: 'PLACEHOLDER',
  authDomain: 'PLACEHOLDER.firebaseapp.com',
  projectId: 'PLACEHOLDER',
  storageBucket: 'PLACEHOLDER.appspot.com',
  messagingSenderId: 'PLACEHOLDER',
  appId: 'PLACEHOLDER',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
