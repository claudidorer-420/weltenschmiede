// Einstellungen (pro Gerät in localStorage, optional mit der Cloud synchronisiert).
import { createStore } from './store.js';
import { deepMerge, debounce } from '../lib/util.js';

const KEY = 'ws.settings.v1';

export const DEFAULT_GRAPH_GROUPS = [
  { query: '(Blau', color: '#4d8dff', label: 'Blau' },
  { query: '(Lila', color: '#b07cff', label: 'Lila' },
  { query: '(Rot', color: '#ff5a5a', label: 'Rot' },
  { query: '(Grün', color: '#4cc38a', label: 'Grün' },
  { query: '(Gelb', color: '#f5c542', label: 'Gelb' },
  { query: '(Orange', color: '#ff9a3c', label: 'Orange' },
  { query: '(Weiß', color: '#f1f1f1', label: 'Weiß' },
  { query: 'path:Reiche', color: '#e0b24a', label: 'Reiche' },
];

export const DEFAULTS = {
  theme: 'amoled',
  accent: '#8a5cf5',
  fontSize: 16,
  readableWidth: true,
  profileName: 'Spielleitung',
  units: 'm',
  rulesVersion: '2014',
  editor: { defaultMode: 'read', spellcheck: true, toolbar: true },
  ai: {
    providers: {
      gemini: { key: '' },
      anthropic: { key: '' },
      openai: { key: '' },
      openrouter: { key: '' },
      custom: { key: '', baseUrl: 'http://localhost:11434/v1', model: '' },
    },
    tasks: {},
    preferred: '', // bevorzugtes Textmodell ('anbieter:modell'), überall vorausgewählt
    preferredImage: '',
    loaded: {},
    demo: false,
    syncKeys: true,
  },
  graph: {
    groups: DEFAULT_GRAPH_GROUPS,
    showOrphans: true,
    showUnresolved: false,
    showTags: false,
    showFiles: false,
    nodeSize: 1,
    linkWidth: 1,
    repel: 1,
    linkDistance: 1,
    centerForce: 1,
    textFade: 1,
    arrows: false,
    dim: '2d',
    spin: true,
    spinSpeed: 0.6,   // 40 % langsamer als früher
    pulses: true,
  },
  diceSkin: 'klassisch',
  mcpUrl: '',
  forge: { recipes: [], customBlocks: [], lastConfig: null },
  bookmarks: [],
  layout: { left: true, right: false },
  onboarded: false,
};

function load() {
  const base = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deepMerge(base, JSON.parse(raw)) : base;
  } catch {
    return base;
  }
}

export const settings = createStore(load());

let cloudPush = null;
const persist = debounce((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* Speicher voll */ }
  if (cloudPush) cloudPush(syncablePart(s));
}, 400);

settings.subscribe((s) => {
  persist(s);
  applyTheme(s);
});

export function updateSettings(patch) {
  settings.replace(deepMerge(settings.get(), patch));
}

// KI-Schlüssel gehören zum Konto und liegen im privaten Bereich (users/{uid}/private/settings).
export function syncablePart(s) {
  const out = structuredClone(s);
  delete out.layout;
  return out;
}

export function setCloudSettingsSync(fn) {
  cloudPush = fn;
}

export function flushSettings() {
  persist.flush(settings.get());
}

// Beim Abmelden bzw. Kontowechsel: Schlüssel vom Gerät entfernen (vorher Cloud-Sync trennen!)
export function clearAiKeys() {
  const cur = settings.get();
  const providers = Object.fromEntries(Object.entries(cur.ai.providers).map(([id, p]) => [id, { ...p, key: '' }]));
  settings.replace({ ...cur, ai: { ...cur.ai, providers } });
  flushSettings();
}

export function ensureSettingsOwner(uid) {
  const prev = localStorage.getItem('ws.settingsOwner');
  if (prev && prev !== uid) clearAiKeys();
  localStorage.setItem('ws.settingsOwner', uid);
}

export function mergeRemoteSettings(remote) {
  if (!remote) return;
  const cur = settings.get();
  const merged = deepMerge(cur, remote);
  // lokale Schlüssel nie durch leere Remote-Werte überschreiben
  for (const [id, p] of Object.entries(cur.ai.providers)) {
    if (p.key && !merged.ai.providers[id]?.key) merged.ai.providers[id].key = p.key;
  }
  merged.layout = cur.layout;
  settings.replace(merged);
}

export function applyTheme(s = settings.get()) {
  const root = document.documentElement;
  root.dataset.theme = s.theme || 'dark';
  root.style.setProperty('--accent', s.accent || '#8a5cf5');
  root.style.setProperty('--fs', `${s.fontSize || 16}px`);
  root.classList.toggle('readable', !!s.readableWidth);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#1e1e1e';
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
}

// ── Cloud-Konfiguration ──
export function getCloudConfig() {
  try {
    const j = localStorage.getItem('ws.firebase');
    if (j) return JSON.parse(j);
  } catch { /* ignore */ }
  return (window.WS_CONFIG && window.WS_CONFIG.firebase) || null;
}

export function hasBakedCloudConfig() {
  return !!(window.WS_CONFIG && window.WS_CONFIG.firebase);
}

export function setCloudConfig(cfg) {
  if (cfg) localStorage.setItem('ws.firebase', JSON.stringify(cfg));
  else localStorage.removeItem('ws.firebase');
}

export function parseFirebaseConfig(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (j.apiKey && j.projectId) return j;
  } catch { /* JS-Schnipsel */ }
  const out = {};
  for (const key of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL']) {
    const m = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(t);
    if (m) out[key] = m[1];
  }
  return out.apiKey && out.projectId ? out : null;
}

// 'local' nur noch über #/offline (alte Werte aus 'ws.mode' werden bewusst ignoriert)
export const modePref = {
  get: () => localStorage.getItem('ws.mode2') || 'auto',
  set: (v) => localStorage.setItem('ws.mode2', v),
};
