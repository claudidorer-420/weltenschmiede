// KI-Anbindung: mehrere Anbieter, frei wählbare Modelle, Empfehlungen pro Aufgabe, Streaming.
// Schlüssel liegen nur im Browser (Einstellungen) und werden direkt an den jeweiligen Anbieter geschickt.
import { settings, updateSettings } from './settings.js';
import { sleep } from '../lib/util.js';
import { demoResponse, demoImage } from '../data/demo.js';

const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.125.0/+esm';

export class AIError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.code = code;
  }
}

export const PROVIDERS = {
  gemini: {
    id: 'gemini', label: 'Google Gemini', short: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Schlüssel beginnt mit „AIza…“. Flash-Modelle haben ein kostenloses Kontingent – guter Start.', needsKey: true,
  },
  anthropic: {
    id: 'anthropic', label: 'Anthropic Claude', short: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Schlüssel beginnt mit „sk-ant-…“. Abrechnung pro Nutzung (Guthaben aufladen).', needsKey: true,
  },
  openai: {
    id: 'openai', label: 'OpenAI', short: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Schlüssel beginnt mit „sk-…“. Abrechnung pro Nutzung.', needsKey: true,
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', short: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Ein Schlüssel für hunderte Modelle – inkl. einiger kostenloser (Endung „:free“).', needsKey: true,
  },
  custom: {
    id: 'custom', label: 'Eigener Server (OpenAI-kompatibel)', short: 'Lokal', keyUrl: 'https://ollama.com',
    keyHint: 'z. B. Ollama → http://localhost:11434/v1 oder LM Studio → http://localhost:1234/v1. Läuft nur auf dem Gerät mit dem Server.', needsKey: false,
  },
  demo: {
    id: 'demo', label: 'Demo-Modus (ohne KI)', short: 'Demo', keyHint: 'Liefert feste Beispieltexte – zum Ausprobieren der Oberfläche ohne Schlüssel.', needsKey: false,
  },
};

// Kuratierte Modelle (Stand 09/2026). Über „Modelle laden“ holt die App die aktuelle Liste direkt vom Anbieter.
export const MODELS = [
  { provider: 'anthropic', id: 'claude-fable-5-1', label: 'Claude Fable 5.1', tier: 'Spitze', q: 5, speed: 1, cost: 5, vision: true, note: 'Anthropics stärkstes Modell – für große Kampagnenbögen und maximale Konsistenz. Deutlich teurer.' },
  { provider: 'anthropic', id: 'claude-opus-5', label: 'Claude Opus 5', tier: 'Premium', q: 5, speed: 2, cost: 4, vision: true, note: 'Lebendigste Texte, tiefes Regelwissen – erste Wahl für die Weltenschmiede.' },
  { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Claude Sonnet 5', tier: 'Ausgewogen', q: 4, speed: 3, cost: 2, vision: true, note: 'Sehr gut und günstiger – ideal für Statblocks, NPCs und das Orakel.' },
  { provider: 'anthropic', id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'Schnell', q: 3, speed: 5, cost: 1, vision: true, note: 'Schnell & günstig für kurze Helfer.' },
  { provider: 'gemini', id: 'gemini-pro-latest', label: 'Gemini Pro (neueste)', tier: 'Premium', q: 5, speed: 2, cost: 3, vision: true, note: 'Starker Allrounder mit riesigem Kontextfenster – gut, wenn viel Codex mitgeschickt wird.' },
  { provider: 'gemini', id: 'gemini-flash-latest', label: 'Gemini Flash (neueste)', tier: 'Schnell', q: 4, speed: 4, cost: 1, free: true, vision: true, note: 'Schnell, günstig, kostenloses Kontingent – bester Einstieg.' },
  { provider: 'gemini', id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (neueste)', tier: 'Sehr schnell', q: 3, speed: 5, cost: 1, free: true, vision: true, note: 'Am schnellsten – für Namen & Kleinkram.' },
  { provider: 'gemini', id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', tier: 'Bild', image: true, cost: 2, note: 'Bildgenerierung – Porträts, Szenen, Kartenskizzen.' },
  { provider: 'openai', id: 'gpt-5', label: 'GPT-5', tier: 'Premium', q: 5, speed: 2, cost: 3, vision: true, note: 'Sehr stark bei Struktur und Regeln.' },
  { provider: 'openai', id: 'gpt-5-mini', label: 'GPT-5 mini', tier: 'Ausgewogen', q: 4, speed: 4, cost: 1, vision: true, note: 'Günstiger Allrounder.' },
  { provider: 'openai', id: 'gpt-image-1', label: 'GPT Image 1', tier: 'Bild', image: true, cost: 3, note: 'OpenAI-Bildmodell (Organisation muss verifiziert sein).' },
  { provider: 'openrouter', id: 'openrouter/auto', label: 'OpenRouter Auto', tier: 'Ausgewogen', q: 4, speed: 3, cost: 2, note: 'Wählt automatisch ein passendes Modell.' },
  { provider: 'demo', id: 'demo', label: 'Demo-Generator', tier: 'Demo', q: 1, speed: 5, cost: 0, note: 'Feste Beispieltexte ohne KI.' },
];

export const TASKS = {
  world: {
    label: 'Weltenschmiede', icon: 'anvil', desc: 'Orte, Tavernen, Läden, Reiche, Fraktionen, Quests – lange, kreative Texte.',
    temperature: 0.95, maxTokens: 32000,
    recommend: ['anthropic:claude-opus-5', 'gemini:gemini-pro-latest', 'openai:gpt-5', 'anthropic:claude-sonnet-5', 'gemini:gemini-flash-latest', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Kreativität und lange, stimmige Texte. Opus 5 schreibt am lebendigsten; Gemini Pro ist günstiger und verarbeitet sehr viel Codex-Kontext; Gemini Flash für kleines Budget.',
  },
  encounter: {
    label: 'Encounter & Statblocks', icon: 'swords', desc: 'Regelgenaue 5e-Statblocks (JSON) und Schwierigkeitsbewertung.',
    temperature: 0.3, json: true, maxTokens: 24000,
    recommend: ['anthropic:claude-sonnet-5', 'anthropic:claude-opus-5', 'gemini:gemini-pro-latest', 'openai:gpt-5', 'gemini:gemini-flash-latest', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Präzision und sauberes JSON zählen mehr als Prosa. Sonnet 5 ist hier Preis-Leistungs-Sieger.',
  },
  npc: {
    label: 'NPC-Schmiede', icon: 'mask', desc: 'Detailreiche NPCs inkl. Stimme, Geheimnis und Bemal-Guide.',
    temperature: 0.9, effort: 'medium', maxTokens: 12000,
    recommend: ['anthropic:claude-sonnet-5', 'gemini:gemini-flash-latest', 'anthropic:claude-opus-5', 'gemini:gemini-pro-latest', 'openai:gpt-5-mini', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Mittlere Länge, viel Persönlichkeit – ein Mittelklasse-Modell reicht völlig.',
  },
  quick: {
    label: 'Schnelle Helfer', icon: 'zap', desc: 'Namen, Gerüchte, Kurzbeschreibungen, Zufallstabellen.',
    temperature: 1.0, effort: 'low', maxTokens: 4000,
    recommend: ['gemini:gemini-flash-lite-latest', 'anthropic:claude-haiku-4-5', 'gemini:gemini-flash-latest', 'openai:gpt-5-mini', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Kurz und schnell – das günstigste Modell genügt.',
  },
  summary: {
    label: 'Sitzungs-Rückblick', icon: 'scroll', desc: 'Stichpunkte → „Was bisher geschah“, Sitzungsvorbereitung.',
    temperature: 0.5, effort: 'medium', maxTokens: 12000,
    recommend: ['gemini:gemini-flash-latest', 'anthropic:claude-sonnet-5', 'openai:gpt-5-mini', 'gemini:gemini-pro-latest', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Lange Eingaben verdichten: großer Kontext, niedrige Kosten.',
  },
  oracle: {
    label: 'Orakel (Codex-Chat)', icon: 'sparkles', desc: 'Fragen an deine Welt – mit deinen Notizen als Kontext.',
    temperature: 0.6, maxTokens: 16000,
    recommend: ['anthropic:claude-sonnet-5', 'gemini:gemini-pro-latest', 'anthropic:claude-opus-5', 'openai:gpt-5', 'gemini:gemini-flash-latest', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Muss viel Codex-Kontext lesen und widerspruchsfrei antworten.',
  },
  rules: {
    label: 'Regelfragen', icon: 'book', desc: 'Regelauslegung und Schiedsrichter-Hilfe.',
    temperature: 0.2, maxTokens: 8000,
    recommend: ['anthropic:claude-sonnet-5', 'openai:gpt-5', 'gemini:gemini-pro-latest', 'gemini:gemini-flash-latest', 'openrouter:openrouter/auto', 'custom:*'],
    why: 'Genauigkeit vor Kreativität.',
  },
  image: {
    label: 'Bilder', icon: 'image', desc: 'Porträts, Szenen, Kartenskizzen.', image: true,
    recommend: ['gemini:gemini-2.5-flash-image', 'openai:gpt-image-1'],
    why: 'Gemini Flash Image ist schnell und günstig; GPT Image 1 als Alternative.',
  },
};

// ───────────────────────── Modellauswahl ─────────────────────────
export function parseRef(ref) {
  const i = String(ref || '').indexOf(':');
  if (i < 0) return null;
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

export function providerReady(id) {
  const ai = settings.get().ai;
  if (id === 'demo') return !!ai.demo;
  if (id === 'custom') return !!(ai.providers.custom?.baseUrl && ai.providers.custom?.model);
  return !!ai.providers[id]?.key?.trim();
}

export function readyProviders() {
  return Object.keys(PROVIDERS).filter(providerReady);
}

export function anyAIReady() {
  return readyProviders().length > 0;
}

function refAvailable(ref) {
  const p = parseRef(ref);
  return !!p && providerReady(p.provider);
}

export function modelsFor(task) {
  const wantImage = !!TASKS[task]?.image;
  const ai = settings.get().ai;
  const out = [];
  const seen = new Set();
  const add = (m) => {
    const key = `${m.provider}:${m.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...m, ref: key, ready: providerReady(m.provider) });
  };
  for (const m of MODELS) if (!!m.image === wantImage) add(m);
  for (const [prov, list] of Object.entries(ai.loaded || {})) {
    for (const m of list || []) if (!!m.image === wantImage) add({ provider: prov, id: m.id, label: m.label || m.id, loaded: true, free: m.free });
  }
  if (!wantImage && ai.providers.custom?.model) add({ provider: 'custom', id: ai.providers.custom.model, label: `${ai.providers.custom.model} (eigener Server)` });
  return out;
}

export function recommendedRefs(task) {
  const t = TASKS[task];
  if (!t) return [];
  const custom = settings.get().ai.providers.custom?.model;
  return t.recommend.map((r) => (r === 'custom:*' ? (custom ? `custom:${custom}` : null) : r)).filter(Boolean);
}

export function resolveModel(task, override) {
  const ai = settings.get().ai;
  const chosen = override || ai.tasks?.[task];
  if (chosen && refAvailable(chosen)) return parseRef(chosen);
  // bevorzugtes Modell aus den Einstellungen (Text bzw. Bild) vor den Empfehlungen
  const pref = TASKS[task]?.image ? ai.preferredImage : ai.preferred;
  if (pref && refAvailable(pref)) return parseRef(pref);
  for (const r of recommendedRefs(task)) if (refAvailable(r)) return parseRef(r);
  if (!TASKS[task]?.image) {
    for (const prov of readyProviders()) {
      if (prov === 'demo') continue;
      const m = modelsFor(task).find((x) => x.provider === prov);
      if (m) return { provider: prov, model: m.id };
    }
  }
  if (ai.demo) return { provider: 'demo', model: 'demo' };
  return null;
}

export function modelLabel(sel) {
  if (!sel) return 'Kein Modell';
  const m = MODELS.find((x) => x.provider === sel.provider && x.id === sel.model);
  const loaded = settings.get().ai.loaded?.[sel.provider]?.find((x) => x.id === sel.model);
  return m?.label || loaded?.label || sel.model;
}

export function applyRecommendations() {
  const tasks = {};
  for (const task of Object.keys(TASKS)) {
    const r = recommendedRefs(task).find(refAvailable);
    if (r) tasks[task] = r;
  }
  updateSettings({ ai: { tasks } });
  return tasks;
}

// ───────────────────────── Nutzungsstatistik ─────────────────────────
function trackUsage(provider, usage) {
  try {
    const u = JSON.parse(localStorage.getItem('ws.usage') || '{}');
    const p = (u[provider] ||= { calls: 0, input: 0, output: 0 });
    p.calls++;
    p.input += usage?.input || 0;
    p.output += usage?.output || 0;
    localStorage.setItem('ws.usage', JSON.stringify(u));
  } catch { /* ignore */ }
}

export function usageStats() {
  try {
    return JSON.parse(localStorage.getItem('ws.usage') || '{}');
  } catch {
    return {};
  }
}

// ───────────────────────── Hauptfunktion ─────────────────────────
/**
 * @param {object} o
 * @param {string} o.task       Aufgabe (world, encounter, npc, quick, summary, oracle, rules)
 * @param {string} [o.system]   System-Anweisung
 * @param {string} [o.prompt]   Nutzer-Nachricht (alternativ messages)
 * @param {Array}  [o.messages] [{role:'user'|'assistant', content, images:[{mime,data}]}]
 * @param {Array}  [o.images]   Bilder zur Nutzer-Nachricht [{mime, data(base64)}]
 * @param {boolean}[o.json]     JSON-Ausgabe erzwingen
 * @param {Function}[o.onDelta] (delta, fullText) => void
 * @param {AbortSignal}[o.signal]
 * @param {string} [o.model]    'provider:modell' – überschreibt die Zuordnung
 */
export async function generate(o) {
  const task = o.task || 'world';
  const sel = resolveModel(task, o.model);
  if (!sel) throw new AIError('Kein KI-Modell eingerichtet. Öffne Einstellungen → KI & Modelle und trage einen API-Schlüssel ein – oder aktiviere dort den Demo-Modus.', 'nokey');
  const t = TASKS[task] || {};
  const opts = {
    system: o.system || '',
    messages: o.messages || [{ role: 'user', content: o.prompt || '', images: o.images || [] }],
    json: o.json ?? !!t.json,
    temperature: o.temperature ?? t.temperature ?? 0.8,
    maxTokens: o.maxTokens || t.maxTokens || 16000,
    effort: t.effort,
    onDelta: o.onDelta || (() => {}),
    signal: o.signal,
    task,
  };
  const started = performance.now();
  let res;
  switch (sel.provider) {
    case 'gemini': res = await callGemini(sel.model, opts); break;
    case 'anthropic': res = await callAnthropic(sel.model, opts); break;
    case 'openai':
    case 'openrouter':
    case 'custom': res = await callOpenAICompat(sel.provider, sel.model, opts); break;
    case 'demo': res = await callDemo(opts); break;
    default: throw new AIError(`Unbekannter Anbieter: ${sel.provider}`);
  }
  res.provider = sel.provider;
  res.model = sel.model;
  res.ms = Math.round(performance.now() - started);
  trackUsage(sel.provider, res.usage);
  return res;
}

export async function generateJSON(o) {
  const res = await generate({ ...o, json: true });
  res.data = extractJSON(res.text);
  return res;
}

export function extractJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let v = tryParse(t);
  if (v !== undefined) return v;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    const slice = t.slice(a, b + 1);
    v = tryParse(slice);
    if (v !== undefined) return v;
    v = tryParse(slice.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"'));
    if (v !== undefined) return v;
  }
  throw new AIError('Die KI-Antwort war kein gültiges JSON. Bitte erneut versuchen (oder ein anderes Modell wählen).', 'json');
}

// ───────────────────────── Server-Sent Events ─────────────────────────
async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (chunk) => {
    const ev = { event: 'message', data: '' };
    const data = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (line.startsWith('event:')) ev.event = line.slice(6).trim();
    }
    ev.data = data.join('\n');
    return ev;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf))) {
      const chunk = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const ev = parse(chunk);
      if (ev.data) yield ev;
    }
  }
  if (buf.trim()) {
    const ev = parse(buf);
    if (ev.data) yield ev;
  }
}

async function httpError(res, provider) {
  let msg = '';
  try {
    const j = await res.json();
    msg = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
  } catch {
    try { msg = (await res.text()).slice(0, 300); } catch { /* ignore */ }
  }
  const name = PROVIDERS[provider]?.short || provider;
  if (res.status === 401 || res.status === 403) return new AIError(`${name}: Schlüssel ungültig oder ohne Berechtigung. ${msg}`, 'auth');
  if (res.status === 429) return new AIError(`${name}: Limit erreicht (zu viele Anfragen oder Guthaben leer). ${msg}`, 'rate');
  if (res.status === 404) return new AIError(`${name}: Modell nicht gefunden – Modellname prüfen oder Liste in den Einstellungen neu laden. ${msg}`, 'model');
  return new AIError(`${name}-Fehler ${res.status}: ${msg}`, 'http');
}

function key(provider) {
  return settings.get().ai.providers[provider]?.key?.trim() || '';
}

// ───────────────────────── Google Gemini ─────────────────────────
async function callGemini(model, o) {
  const contents = o.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [...(m.images || []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })), { text: m.content || ' ' }],
  }));
  const body = { contents, generationConfig: { temperature: o.temperature, maxOutputTokens: Math.max(o.maxTokens, 8192) } };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.json) body.generationConfig.responseMimeType = 'application/json';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key('gemini') },
    body: JSON.stringify(body),
    signal: o.signal,
  });
  if (!res.ok) throw await httpError(res, 'gemini');
  let text = '';
  let usage = null;
  let finish = null;
  for await (const ev of sse(res)) {
    let j;
    try { j = JSON.parse(ev.data); } catch { continue; }
    if (j.error) throw new AIError(`Gemini: ${j.error.message}`);
    if (j.promptFeedback?.blockReason) throw new AIError(`Gemini hat die Anfrage blockiert (${j.promptFeedback.blockReason}).`, 'blocked');
    const cand = j.candidates?.[0];
    const d = (cand?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
    if (d) {
      text += d;
      o.onDelta(d, text);
    }
    if (cand?.finishReason) finish = cand.finishReason;
    if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount || 0, output: (j.usageMetadata.candidatesTokenCount || 0) + (j.usageMetadata.thoughtsTokenCount || 0) };
  }
  if (!text && finish && finish !== 'STOP') throw new AIError(`Gemini hat ohne Text beendet (${finish}).`);
  return { text, usage, finish };
}

// ───────────────────────── Anthropic Claude (offizielles SDK) ─────────────────────────
let anthropicModule = null;
async function anthropicClient() {
  if (!anthropicModule) {
    try {
      anthropicModule = await import(ANTHROPIC_SDK);
    } catch (e) {
      throw new AIError('Das Claude-SDK konnte nicht geladen werden (Internetverbindung?).', 'sdk');
    }
  }
  const Anthropic = anthropicModule.default || anthropicModule.Anthropic;
  const client = new Anthropic({ apiKey: key('anthropic'), dangerouslyAllowBrowser: true, maxRetries: 2 });
  return { Anthropic, client };
}

const claudeSampling = (model) => /^claude-(haiku|3)/.test(model);
const claudeEffort = (model) => /^claude-(opus-5|sonnet-5|fable|mythos|opus-4-[5-8])/.test(model);
const claudeFallback = (model) => /^claude-(opus-5|fable-5-1)$/.test(model);

function mapAnthropicError(e, Anthropic) {
  if (e instanceof AIError) return e;
  if (Anthropic.APIUserAbortError && e instanceof Anthropic.APIUserAbortError) return new AIError('Abgebrochen.', 'abort');
  if (e instanceof Anthropic.AuthenticationError) return new AIError('Claude: API-Schlüssel ungültig.', 'auth');
  if (e instanceof Anthropic.PermissionDeniedError) return new AIError('Claude: Keine Berechtigung für dieses Modell.', 'auth');
  if (e instanceof Anthropic.NotFoundError) return new AIError('Claude: Modell nicht gefunden – Modellname prüfen.', 'model');
  if (e instanceof Anthropic.RateLimitError) return new AIError('Claude: Ratenlimit erreicht – kurz warten und erneut versuchen.', 'rate');
  if (e instanceof Anthropic.BadRequestError) return new AIError(`Claude: Ungültige Anfrage – ${e.message}`, 'bad');
  if (e instanceof Anthropic.APIConnectionError) return new AIError('Claude: Keine Verbindung zum Server.', 'network');
  if (e instanceof Anthropic.APIError) return new AIError(`Claude-Fehler ${e.status ?? ''}: ${e.message}`, 'http');
  if (e?.name === 'AbortError') return new AIError('Abgebrochen.', 'abort');
  return new AIError(`Claude: ${e?.message || e}`);
}

async function callAnthropic(model, o) {
  const { Anthropic, client } = await anthropicClient();
  const messages = o.messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.images?.length
      ? [...m.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })), { type: 'text', text: m.content || ' ' }]
      : m.content || ' ',
  }));
  const params = { model, max_tokens: 64000, messages };
  const system = o.json ? `${o.system}\n\nAntworte ausschließlich mit einem gültigen JSON-Objekt – ohne Markdown-Codeblock, ohne Text davor oder danach.` : o.system;
  if (system) params.system = system;
  if (claudeSampling(model) && o.temperature != null) params.temperature = Math.min(1, o.temperature);
  if (claudeEffort(model) && o.effort) params.output_config = { effort: o.effort };
  try {
    const stream = claudeFallback(model)
      ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: o.signal })
      : client.messages.stream(params, { signal: o.signal });
    let text = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        text += ev.delta.text;
        o.onDelta(ev.delta.text, text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new AIError(`Claude hat diese Anfrage abgelehnt${final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : '.'}`, 'refusal');
    }
    return { text, usage: { input: final.usage?.input_tokens || 0, output: final.usage?.output_tokens || 0 }, finish: final.stop_reason, servedBy: final.model };
  } catch (e) {
    throw mapAnthropicError(e, Anthropic);
  }
}

// ───────────────────────── OpenAI / OpenRouter / eigener Server ─────────────────────────
function compatConfig(provider) {
  const p = settings.get().ai.providers[provider] || {};
  if (provider === 'openai') return { base: 'https://api.openai.com/v1', headers: { authorization: `Bearer ${key('openai')}` } };
  if (provider === 'openrouter') {
    return { base: 'https://openrouter.ai/api/v1', headers: { authorization: `Bearer ${key('openrouter')}`, 'HTTP-Referer': location.origin, 'X-Title': 'Weltenschmiede' } };
  }
  const base = (p.baseUrl || '').replace(/\/+$/, '');
  return { base, headers: p.key ? { authorization: `Bearer ${p.key}` } : {} };
}

async function callOpenAICompat(provider, model, o) {
  const { base, headers } = compatConfig(provider);
  if (!base) throw new AIError('Für den eigenen Server fehlt die Adresse (Einstellungen → KI).', 'config');
  const messages = [];
  if (o.system) messages.push({ role: 'system', content: o.system });
  for (const m of o.messages) {
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.images?.length
        ? [{ type: 'text', text: m.content || ' ' }, ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } }))]
        : m.content || ' ',
    });
  }
  const body = { model, messages, stream: true };
  const reasoning = /^(gpt-5|o\d)/.test(model);
  if (provider === 'openai') {
    body.max_completion_tokens = o.maxTokens;
    body.stream_options = { include_usage: true };
    if (!reasoning && o.temperature != null) body.temperature = o.temperature;
  } else {
    body.max_tokens = Math.min(o.maxTokens, 16000);
    if (o.temperature != null) body.temperature = o.temperature;
  }
  if (o.json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: o.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AIError('Abgebrochen.', 'abort');
    throw new AIError(provider === 'custom' ? `Eigener Server nicht erreichbar (${base}). Läuft er? Bei Ollama: OLLAMA_ORIGINS="*" setzen.` : `Keine Verbindung zu ${PROVIDERS[provider].short}.`, 'network');
  }
  if (!res.ok) throw await httpError(res, provider);
  let text = '';
  let usage = null;
  let finish = null;
  for await (const ev of sse(res)) {
    if (ev.data === '[DONE]') break;
    let j;
    try { j = JSON.parse(ev.data); } catch { continue; }
    if (j.error) throw new AIError(`${PROVIDERS[provider].short}: ${j.error.message || j.error}`);
    const d = j.choices?.[0]?.delta?.content;
    if (d) {
      text += d;
      o.onDelta(d, text);
    }
    if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
    if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0 };
  }
  return { text, usage, finish };
}

// ───────────────────────── Demo ─────────────────────────
async function callDemo(o) {
  const full = demoResponse(o.task, o);
  let text = '';
  const step = 28;
  for (let i = 0; i < full.length; i += step) {
    if (o.signal?.aborted) throw new AIError('Abgebrochen.', 'abort');
    const d = full.slice(i, i + step);
    text += d;
    o.onDelta(d, text);
    await sleep(10);
  }
  return { text, usage: { input: 0, output: 0 }, finish: 'stop' };
}

// ───────────────────────── Bilder ─────────────────────────
export async function generateImage({ prompt, model: override, aspect = '1:1', signal } = {}) {
  const sel = resolveModel('image', override);
  if (!sel) {
    if (settings.get().ai.demo) return { dataUrl: demoImage(prompt), provider: 'demo', model: 'demo' };
    throw new AIError('Kein Bildmodell eingerichtet – dafür wird ein Gemini- oder OpenAI-Schlüssel benötigt.', 'nokey');
  }
  const fullPrompt = aspect !== '1:1' ? `${prompt}\n\nBildformat: ${aspect === '16:9' ? 'Querformat 16:9' : aspect === '9:16' ? 'Hochformat 9:16' : aspect}.` : prompt;
  if (sel.provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(sel.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key('gemini') },
      body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      signal,
    });
    if (!res.ok) throw await httpError(res, 'gemini');
    const j = await res.json();
    const parts = j.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData?.data);
    if (!img) throw new AIError(`Gemini hat kein Bild geliefert. ${parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200)}`);
    trackUsage('gemini', { input: j.usageMetadata?.promptTokenCount, output: j.usageMetadata?.candidatesTokenCount });
    return { dataUrl: `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`, provider: 'gemini', model: sel.model };
  }
  if (sel.provider === 'openai') {
    const size = aspect === '16:9' ? '1536x1024' : aspect === '9:16' ? '1024x1536' : '1024x1024';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key('openai')}` },
      body: JSON.stringify({ model: sel.model, prompt: fullPrompt, size, n: 1 }),
      signal,
    });
    if (!res.ok) throw await httpError(res, 'openai');
    const j = await res.json();
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new AIError('OpenAI hat kein Bild geliefert.');
    trackUsage('openai', {});
    return { dataUrl: `data:image/png;base64,${b64}`, provider: 'openai', model: sel.model };
  }
  if (sel.provider === 'demo') return { dataUrl: demoImage(prompt), provider: 'demo', model: 'demo' };
  throw new AIError(`${PROVIDERS[sel.provider]?.short || sel.provider} unterstützt hier keine Bilder.`);
}

// ───────────────────────── Modelllisten & Test ─────────────────────────
export async function listModels(provider) {
  if (provider === 'gemini') {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key('gemini') } });
    if (!res.ok) throw await httpError(res, 'gemini');
    const j = await res.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => {
        const id = m.name.replace(/^models\//, '');
        return { id, label: m.displayName || id, image: /image/.test(id) && !/imagen/.test(id) };
      })
      .filter((m) => !/embedding|aqa|tts|audio|live/.test(m.id));
  }
  if (provider === 'anthropic') {
    const { Anthropic, client } = await anthropicClient();
    const out = [];
    try {
      for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name || m.id });
    } catch (e) {
      throw mapAnthropicError(e, Anthropic);
    }
    return out;
  }
  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw await httpError(res, 'openrouter');
    const j = await res.json();
    return (j.data || []).map((m) => ({
      id: m.id,
      label: m.name || m.id,
      free: m.id.endsWith(':free') || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0),
      image: (m.architecture?.output_modalities || []).includes('image') && !(m.architecture?.output_modalities || []).includes('text'),
    }));
  }
  const { base, headers } = compatConfig(provider);
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw await httpError(res, provider);
  const j = await res.json();
  let list = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name }));
  if (provider === 'openai') {
    list = list
      .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) || /image|dall-e/.test(m.id))
      .filter((m) => !/audio|realtime|transcribe|tts|search|embedding/.test(m.id))
      .map((m) => ({ ...m, image: /image|dall-e/.test(m.id) }));
  }
  return list;
}

export async function refreshModels(provider) {
  const list = await listModels(provider);
  updateSettings({ ai: { loaded: { [provider]: list } } });
  return list;
}

export async function testProvider(provider) {
  if (provider === 'demo') return 'Demo aktiv';
  const list = await listModels(provider);
  return `Verbunden – ${list.length} Modelle verfügbar`;
}
