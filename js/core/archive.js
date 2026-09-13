// „Archiv der Welten“: automatischer Verlauf aller KI-Generierungen (pro Nutzer, geräteübergreifend in der Cloud).
import { db } from './db.js';
import { app, userCol } from './app.js';
import { now } from '../lib/util.js';

export async function saveToArchive({ kind, title, text, config = null, provider = '', model = '', data = null }) {
  try {
    return await db.add(userCol('archive'), { kind, title: title || 'Ohne Titel', text: text || '', config, provider, model, data, cid: app.get().cid || null, campaign: app.get().campaign?.name || '', ts: now() });
  } catch (e) {
    console.warn('Archiv', e);
    return null;
  }
}

export function titleFromMarkdown(md, fallback = 'Ohne Titel') {
  const m = /^#\s+(.+)$/m.exec(String(md || ''));
  return m ? m[1].replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).trim() : fallback;
}
