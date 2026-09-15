// Rückfragen im Kampf (Reaktionen): „Schild wirken?“, „Gelegenheitsangriff?“, „Unglaubliches Ausweichen?“ …
// Mit Countdown, unabhängig von der offenen Ansicht. Lokale Fragen (SL/offline) kommen aus react.js, die der Spieler
// aus dem öffentlichen Kampfzustand – die Antwort geht als Signal an die SL.
import { html, useState, useEffect } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, col, myUid } from '../core/app.js';
import { useDoc } from '../core/hooks.js';
import { promptStore, answerPrompt } from '../core/react.js';
import { sendEvent } from '../core/relay.js';
import { Btn } from './components.js';
import { now } from '../lib/util.js';

export function PromptHost() {
  const cid = useStore(app, (s) => s.cid);
  const role = useStore(app, (s) => s.role);
  const local = useStore(promptStore, (s) => s.items);
  const pub = useDoc(cid && role !== 'gm' ? col('combat') : null, 'public');
  const [done, setDone] = useState([]);
  const [, tick] = useState(0);
  const me = myUid();
  const t = now();
  const remote = (pub?.prompts || []).filter((p) => p.to === me && (p.expires || 0) > t && !done.includes(p.id));
  const items = [...local.map((p) => ({ ...p, local: true })), ...remote];
  useEffect(() => {
    if (!items.length) return undefined;
    const i = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [items.length]);
  if (!items.length) return null;
  const choose = async (p, choice) => {
    if (p.local) answerPrompt(p.id, choice);
    else {
      setDone((d) => [...d, p.id].slice(-40));
      sendEvent({ type: 'answer', promptId: p.id, choice }).catch(() => {});
    }
    // Gelegenheitsangriff: der Reagierende würfelt seinen Angriff selbst
    if (p.kind === 'oa' && choice === 'yes') {
      const A = await import('../core/actions.js');
      A.reactionAttack(p.cb, p.target, p.pos || null).catch((e) => console.warn('[Reaktion]', e));
    }
  };
  return html`<div class="pr-host">${items.map((p) => {
    const span = Math.max(1, (p.expires || 0) - (p.ts || 0));
    const pct = Math.max(0, Math.min(100, (((p.expires || 0) - t) / span) * 100));
    return html`<div class="pr-card" key=${p.id} role="alertdialog" aria-label=${p.title}>
      <div class="pr-head"><span class="pr-ico"></span><b>${p.title}</b><span class="grow"></span><span class="pr-tag">Reaktion</span></div>
      <p>${p.text}</p>
      <div class="pr-btns">${(p.options || []).map((o) => html`<${Btn} key=${o.id} size="sm" kind=${o.kind === 'primary' ? 'primary' : 'ghost'} onClick=${() => choose(p, o.id)}>${o.label}<//>`)}</div>
      <i class="pr-bar"><i style=${{ width: `${pct}%` }}></i></i>
    </div>`;
  })}</div>`;
}
