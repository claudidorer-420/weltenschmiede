// Zufallsgeneratoren (offline): Namen, Tavernen, Märkte mit Preislisten, Gerüchte, Aufhänger, Wetter, Beute, Kuriositäten, Begegnungen …
import { html, useState } from '../lib/preact.js';
import { createNote } from '../core/app.js';
import { openNote } from '../core/workspace.js';
import { generate } from '../core/ai.js';
import { worldContext } from '../core/prompts.js';
import {
  randomName, SPECIES_NAMES, tavern, marketList, SHOP_GROUPS, RUMORS, HOOKS, TRINKETS, QUIRKS, LOOKS, ENCOUNTERS, DUNGEON, lootFor, weather,
} from '../data/tables.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, IconBtn, Btn, Select, Segmented, MarkdownView, ModelPicker, toast } from '../ui/components.js';
import { appendDialog } from '../ui/aiout.js';
import { pick, pickN, copyText } from '../lib/util.js';

function GenCard({ icon, title, controls, onRoll, result, noteTitle }) {
  const save = async () => {
    const n = await createNote({ title: noteTitle || title, folder: 'Generiert', body: result });
    toast(`„${n.title}“ gespeichert`, 'success', { action: { label: 'Öffnen', onClick: () => openNote(n.id) } });
  };
  return html`<div class="card stack">
    <div class="card-head" style="margin:0"><h3><${Icon} name=${icon} size=${18} />${title}</h3><span class="grow"></span><${Btn} size="sm" kind="primary" icon="d20" onClick=${onRoll}>Würfeln<//></div>
    ${controls || null}
    ${result ? html`<${MarkdownView} src=${result} />
      <div class="btn-row">
        <${IconBtn} icon="copy" title="Kopieren" onClick=${() => { copyText(result); toast('Kopiert'); }} />
        <${IconBtn} icon="save" title="Als Notiz speichern" onClick=${save} />
        <${IconBtn} icon="plus" title="An Notiz anhängen" onClick=${() => appendDialog(result)} />
      </div>` : null}
  </div>`;
}

export function GeneratorsView({ tabId }) {
  const [names, setNames] = useState('');
  const [sp, setSp] = useState('Mensch');
  const [gender, setGender] = useState('x');
  const [tav, setTav] = useState('');
  const [market, setMarket] = useState('');
  const [size, setSize] = useState('Stadt');
  const [factor, setFactor] = useState(0);
  const [groups, setGroups] = useState(Object.keys(SHOP_GROUPS));
  const [rum, setRum] = useState('');
  const [hooks, setHooks] = useState('');
  const [clim, setClim] = useState('gemäßigt');
  const [season, setSeason] = useState('Herbst');
  const [wx, setWx] = useState('');
  const [cr, setCr] = useState(3);
  const [loot, setLoot] = useState('');
  const [trink, setTrink] = useState('');
  const [npcx, setNpcx] = useState('');
  const [terrain, setTerrain] = useState('Wald');
  const [enc, setEnc] = useState('');
  const [dng, setDng] = useState('');
  const [aiQ, setAiQ] = useState('');
  const [aiOut, setAiOut] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [model, setModel] = useState(null);

  const rollNames = () => setNames(Array.from({ length: 10 }, () => `- ${randomName(sp, gender === 'x' ? pick(['m', 'w']) : gender)}`).join('\n'));
  const rollTavern = () => {
    const t = tavern();
    setTav(`### ${t.name}\n- **Wirt/in:** ${t.host}\n- **Spezialität:** ${t.special}\n- **Stimmung:** ${t.mood}\n- **Heute Abend:** ${t.event}`);
  };
  const rollMarket = () => setMarket(marketList({ size, factor: 1 + factor / 100, groups }));
  const rollWeather = () => setWx([1, 2, 3].map((d) => `- **Tag ${d}:** ${weather(clim, season)}`).join('\n'));

  const askAI = async (preset) => {
    const q = preset || aiQ;
    if (!q.trim()) return;
    setAiBusy(true);
    setAiOut('');
    try {
      await generate({
        task: 'quick', model,
        system: `Du bist ein kreativer Assistent für D&D-5e-Spielleitungen und antwortest auf Deutsch in kompaktem Markdown (Listen/Tabellen), ohne Vorrede. Setze Eigennamen als [[Wikilinks]] nur, wenn sie eigene Notizen verdienen.\n${worldContext()}`,
        prompt: q,
        onDelta: (_, full) => setAiOut(full),
      });
    } catch (e) {
      if (e.code !== 'abort') toast(e.message, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  return html`<${ViewFrame} tabId=${tabId} title="Zufallsgeneratoren">
    <div class="page wide stack lg">
      <div class="page-head"><h1><${Icon} name="dices" size=${24} />Zufallsgeneratoren</h1><span class="sub">Funktionieren komplett ohne KI und offline – perfekt für spontane Momente am Tisch. Ergebnisse direkt als Notiz speichern.</span></div>
      <div class="grid three">
        <${GenCard} icon="user" title="Namen" result=${names} onRoll=${rollNames} noteTitle=${`Namen (${sp})`}
          controls=${html`<div class="row"><${Select} value=${sp} onChange=${setSp} options=${SPECIES_NAMES} style="max-width:170px" /><${Segmented} value=${gender} onChange=${setGender} options=${[{ value: 'x', label: 'Egal' }, { value: 'w', label: 'w' }, { value: 'm', label: 'm' }]} /></div>`} />
        <${GenCard} icon="beer" title="Taverne" result=${tav} onRoll=${rollTavern} noteTitle="Taverne" />
        <${GenCard} icon="store" title="Markt & Preise" result=${market} onRoll=${rollMarket} noteTitle=${`Markt (${size})`}
          controls=${html`<div class="stack sm">
            <${Segmented} value=${size} onChange=${setSize} options=${['Dorf', 'Stadt', 'Metropole']} />
            <div class="row small"><span class="muted" style="width:120px">Preise ${factor > 0 ? '+' : ''}${factor} %</span><input type="range" min="-30" max="60" step="5" value=${factor} style="flex:1;accent-color:var(--accent)" onInput=${(e) => setFactor(Number(e.target.value))} /></div>
            <div class="chips">${Object.keys(SHOP_GROUPS).map((g) => html`<button type="button" class=${`chip${groups.includes(g) ? ' selected' : ' suggest'}`} onClick=${() => setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g])}>${g}</button>`)}</div>
          </div>`} />
        <${GenCard} icon="message" title="Gerüchte" result=${rum} onRoll=${() => setRum(`| d6 | Gerücht |\n|---|---|\n${pickN(RUMORS, 6).map((r, i) => `| ${i + 1} | ${r} |`).join('\n')}`)} noteTitle="Gerüchte" />
        <${GenCard} icon="target" title="Abenteuer-Aufhänger" result=${hooks} onRoll=${() => setHooks(pickN(HOOKS, 3).map((h) => `- ${h}`).join('\n'))} noteTitle="Aufhänger" />
        <${GenCard} icon="sun" title="Wetter (3 Tage)" result=${wx} onRoll=${rollWeather} noteTitle="Wetter"
          controls=${html`<div class="row"><${Select} value=${clim} onChange=${setClim} options=${['gemäßigt', 'nordisch', 'tropisch', 'wüste']} style="max-width:150px" /><${Select} value=${season} onChange=${setSeason} options=${['Frühling', 'Sommer', 'Herbst', 'Winter']} style="max-width:150px" /></div>`} />
        <${GenCard} icon="gem" title="Beute" result=${loot} onRoll=${() => setLoot(lootFor(cr).map((l) => `- ${l}`).join('\n'))} noteTitle=${`Beute (HG ${cr})`}
          controls=${html`<div class="row small"><span class="muted">Herausforderungsgrad</span><input class="input tiny" type="number" min="0" max="30" value=${cr} onInput=${(e) => setCr(Number(e.target.value))} /></div>`} />
        <${GenCard} icon="sparkles" title="Kuriositäten" result=${trink} onRoll=${() => setTrink(pickN(TRINKETS, 5).map((t) => `- ${t}`).join('\n'))} noteTitle="Kuriositäten" />
        <${GenCard} icon="mask" title="NPC-Details" result=${npcx} onRoll=${() => setNpcx(`**Aussehen**\n${pickN(LOOKS, 3).map((x) => `- ${x}`).join('\n')}\n\n**Marotten**\n${pickN(QUIRKS, 3).map((x) => `- ${x}`).join('\n')}`)} noteTitle="NPC-Details" />
        <${GenCard} icon="footprints" title="Reisebegegnungen" result=${enc} onRoll=${() => setEnc(`| d4 | ${terrain} |\n|---|---|\n${pickN(ENCOUNTERS[terrain], 4).map((e, i) => `| ${i + 1} | ${e} |`).join('\n')}`)} noteTitle=${`Begegnungen (${terrain})`}
          controls=${html`<${Select} value=${terrain} onChange=${setTerrain} options=${Object.keys(ENCOUNTERS)} />`} />
        <${GenCard} icon="door" title="Dungeon-Atmosphäre" result=${dng} onRoll=${() => setDng(Object.entries(DUNGEON).map(([k, v]) => `- **${k}:** ${pick(v)}`).join('\n'))} noteTitle="Dungeon-Atmosphäre" />
        <div class="card stack">
          <div class="card-head" style="margin:0"><h3><${Icon} name="zap" size=${18} />KI-Schnellhelfer</h3><span class="grow"></span><${ModelPicker} task="quick" value=${model} onChange=${setModel} /></div>
          <div class="chips">${['12 Tavernennamen für eine Hafenstadt', 'Beschreibe in 5 Sätzen einen unheimlichen Wald', '10 Flüche und Ausrufe von Zwergen', 'Speisekarte einer Elfen-Teestube mit Preisen'].map((p) => html`<button type="button" class="chip suggest" onClick=${() => { setAiQ(p); askAI(p); }}>${p}</button>`)}</div>
          <div class="input-group"><input class="input" value=${aiQ} onInput=${(e) => setAiQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && askAI()} placeholder="Wünsch dir was …" /><${Btn} kind="primary" icon="send" loading=${aiBusy} onClick=${() => askAI()} /></div>
          ${aiOut ? html`<${MarkdownView} src=${aiOut} class=${aiBusy ? 'streaming-caret' : ''} />
            ${!aiBusy ? html`<div class="btn-row"><${IconBtn} icon="copy" title="Kopieren" onClick=${() => { copyText(aiOut); toast('Kopiert'); }} /><${IconBtn} icon="save" title="Als Notiz" onClick=${async () => { const n = await createNote({ title: aiQ.slice(0, 60) || 'KI-Helfer', folder: 'Generiert', body: aiOut }); openNote(n.id); }} /><${IconBtn} icon="plus" title="An Notiz anhängen" onClick=${() => appendDialog(aiOut)} /></div>` : null}` : null}
        </div>
      </div>
    </div>
  <//>`;
}
