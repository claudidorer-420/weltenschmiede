// ─────────────────────────────────────────────────────────────────────────────
//  Weltenschmiede – Konfiguration
//
//  Firebase-Web-Konfiguration für Sync zwischen Geräten und das Online-Spiel.
//  Diese Werte sind NICHT geheim (sie landen in jeder Firebase-Web-App im
//  Browser). Geschützt werden die Daten durch Login + firebase/firestore.rules.
//
//  KI-Schlüssel gehören NICHT hierher – die trägt die Spielleitung in der App
//  unter Einstellungen → KI ein. Sie liegen im privaten Bereich ihres Kontos.
// ─────────────────────────────────────────────────────────────────────────────
window.WS_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDlDyPSUlgtKNiWe69SFagDBU_kuwF8doA',
    authDomain: 'weltenschmiede.firebaseapp.com',
    projectId: 'weltenschmiede',
    storageBucket: 'weltenschmiede.firebasestorage.app',
    messagingSenderId: '349891049660',
    appId: '1:349891049660:web:4820fc7cf84fc0924478b9',
  },
};
