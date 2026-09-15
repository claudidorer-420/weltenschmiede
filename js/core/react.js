// Rückfragen im Kampf (Reaktionen wie „Schild wirken?“ oder „Gelegenheitsangriff?“):
// Die SL-Seite stellt die Frage und wartet auf die Antwort – lokal als Dialog oder beim Spieler über den Kampfzustand.
import { createStore } from './store.js';
import { now, uid } from '../lib/util.js';

export const promptStore = createStore({ items: [] });
const pending = new Map();
const receivers = new Map(); // Frage → Nutzer, der antworten darf
let remotePost = null; // (prompt) => Promise – schreibt die Frage in den Kampfzustand (setzt relay.js)
let remoteDrop = null;

export function setRemotePrompts(post, drop) {
  remotePost = post;
  remoteDrop = drop;
}

// Frage stellen. p: { to: uid|null, local: bool, kind, title, text, options: [{ id, label, kind }], timeout, wait }
// Antwort: id der gewählten Option oder null (abgelehnt / Zeit abgelaufen)
export function askPrompt(p) {
  const id = uid(8);
  const timeout = p.timeout || 30000;
  const pr = { id, ts: now(), expires: now() + timeout, ...p };
  delete pr.local;
  const local = !!p.local || !remotePost;
  receivers.set(id, p.to || null);
  if (local) promptStore.set({ items: [...promptStore.get().items, pr] });
  else remotePost(pr).catch(() => answerPrompt(id, null));
  if (p.wait === false) {
    setTimeout(() => answerPrompt(id, null), timeout + 600);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => answerPrompt(id, null), timeout + 600);
  });
}

export function answerPrompt(id, choice) {
  if (!receivers.has(id) && !pending.has(id)) return;
  const r = pending.get(id);
  pending.delete(id);
  receivers.delete(id);
  const had = promptStore.get().items.some((q) => q.id === id);
  if (had) promptStore.set({ items: promptStore.get().items.filter((q) => q.id !== id) });
  else if (remoteDrop) remoteDrop(id).catch(() => {});
  if (r) r(choice ?? null);
}

export const isPending = (id) => pending.has(id);
// undefined = unbekannte Frage, null = beliebiger Empfänger
export const promptTarget = (id) => (receivers.has(id) ? receivers.get(id) : undefined);
