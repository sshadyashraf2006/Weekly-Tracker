// ─── firebase-config.js ───────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAq64diHez5YQAhlC1hz_PMAE1Q2mc94E0",
  authDomain:        "weekly-tracker-c3249.firebaseapp.com",
  projectId:         "weekly-tracker-c3249",
  storageBucket:     "weekly-tracker-c3249.firebasestorage.app",
  messagingSenderId: "775932263263",
  appId:             "1:775932263263:web:4f89b16d7c6c4a4e8414ea",
  measurementId:     "G-JRK80HNN8W"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);