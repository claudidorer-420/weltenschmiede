// NPC-Schmiede: Schnell-NPCs offline + KI-Dossiers mit Stimme, Geheimnis, Bemal-Guide, Porträt und Statblock.
import { html, useState } from '../lib/preact.js';
import { noteById, createNote, allFolders } from '../core/app.js';
import { openNote } from '../core/workspace.js';
import { generate, generateImage, extractJSON } from '../core/ai.js';
import { npcSystemPrompt, buildNpcPrompt, encounterSystemPrompt } from '../core/prompts.js';
import { saveToArchive, titleFromMarkdown } from '../core/archive.js';
import { SPECIES, ALIGNMENTS } from '../data/rules5e.js';
import { npcQuick, SPECIES_NAMES } from '../data/tables.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, Select, Segmented, Toggle, ModelPicker, NotePicker, DictateButton, AutoTextarea, Statblock, toast, openLightbox, Empty,
} from '../ui/components.js';
import { useGeneration, GenStatus, OutputToolbar, OutputView, saveTextAsNote } from '../ui/aiout.js';
import { monsterToMarkdown } from '../ui/statblock.js';
import { uploadImage } from './codex.js';
import { dataURLToBlob, pick } from '../lib/util.js';

const PERSONALITY = ['herzlich', 'mürrisch', 'paranoid', 'geschwätzig', 'ehrgeizig', 'melancholisch', 'fromm', 'gierig', 'loyal', 'feige', 'charmant', 'rätselhaft', 'jähzornig', 'naiv', 'weise', 'zynisch'];
const RELATIONS = ['neutral', 'Verbündeter', 'Auftraggeber', 'Rivale', 'Feind', 'Informant', 'Händler', 'Liebesinteresse'];
const FM = '---\ntyp: npc\ntags: [npc]\n---\n';

// Zielordner für NPC-Notizen: erst „NPCs“, sonst „NPC“ – gibt es beides nicht, wird „NPCs“ angelegt
export function npcFolder() {
  const alle = allFolders();
  const treffer = (name) => alle.find((f) => f.split('/').pop().toLowerCase() === name);
  return treffer('npcs') || treffer('npc') || 'NPCs';
}

export function NpcView({ tabId }) {
  const [qSpecies, setQSpecies] = useState('Zufall');
  const [qGender, setQGender] = useState('x');
  const [quick, setQuick] = useState(null);
  const [crowd, setCrowd] = useState(null);
  const [f, setF] = useState({ name: '', volk: '', geschlecht: '', alter: '', rolle: '', gesinnung: '', persoenlichkeit: [], beziehung: 'neutral', ort: null });
  const [core, setCore] = useState('');
  const [ctx, setCtx] = useState([]);
  const [count, setCount] = useState(1);
  const [paint, setPaint] = useState(true);
  const [stats, setStats] = useState(false);
  const [length, setLength] = useState('normal');
  const [model, setModel] = useState(null);
  const [portrait, setPortrait] = useState(null);
  const [pBusy, setPBusy] = useState(false);
  const [sb, setSb] = useState(null);
  const [sbBusy, setSbBusy] = useState(false);
  const gen = useGeneration('npc');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const rollQuick = () => {
    const sp = qSpecies === 'Zufall' ? pick(SPECIES_NAMES) : qSpecies;
    const g = qGender === 'x' ? pick(['m', 'w']) : qGender;
    setQuick(npcQuick(sp, g));
  };
  const quickToNote = async (q) => {
    const body = `${FM}- **Volk:** ${q.species}\n- **Beruf:** ${q.job}\n- **Aussehen:** ${q.look}\n- **Marotte:** ${q.quirk}\n- **Motivation:** ${q.motive}\n\n> [!gm] Geheimnis\n> ${q.name.split(' ')[0]} ${q.secret}.\n`;
    const n = await createNote({ title: q.name, folder: npcFolder(), body });
    toast(`„${n.title}“ angelegt`, 'success', { action: { label: 'Öffnen', onClick: () => openNote(n.id) } });
  };
  const quickToAI = (q) => {
    set({ name: q.name, volk: q.species, geschlecht: q.gender === 'w' ? 'weiblich' : 'männlich', rolle: q.job });
    setCore(`Aussehen: ${q.look}. Marotte: ${q.quirk}. Motivation: ${q.motive}. Geheimnis: ${q.secret}.`);
  };
  const rollCrowd = () => setCrowd(Array.from({ length: 6 }, () => npcQuick(pick(SPECIES_NAMES))));
  const crowdToNote = async () => {
    const body = crowd.map((q) => `- **${q.name}** (${q.species}, ${q.job}) – ${q.look}; ${q.quirk}.`).join('\n');
    const n = await createNote({ title: `Passanten ${new Date().toLocaleDateString('de-DE')}`, folder: npcFolder(), body });
    openNote(n.id);
  };

  const run = async () => {
    setPortrait(null);
    setSb(null);
    const fields = {
      Name: f.name, Volk: f.volk, Geschlecht: f.geschlecht, Alter: f.alter, 'Beruf/Rolle': f.rolle, Gesinnung: f.gesinnung,
      Persönlichkeit: f.persoenlichkeit.join(', '), 'Beziehung zur Gruppe': f.beziehung !== 'neutral' ? f.beziehung : '', Aufenthaltsort: f.ort ? `[[${f.ort.title}]]` : '',
    };
    const prompt = buildNpcPrompt({ fields, core, contextIds: [...ctx, ...(f.ort ? [f.ort.id] : [])], count, paint, stats, words: length === 'kurz' ? 300 : length === 'lang' ? 1000 : 600 });
    const res = await gen.run({ system: npcSystemPrompt(), model, prompt });
    if (res?.text) saveToArchive({ kind: 'npc', title: titleFromMarkdown(res.text, 'NPC'), text: res.text, provider: res.provider, model: res.model });
  };

  const makePortrait = async () => {
    setPBusy(true);
    try {
      const look = /##\s*Aussehen\s*\n+([\s\S]+?)(\n##|$)/i.exec(gen.out)?.[1] || gen.out.slice(0, 800);
      const name = titleFromMarkdown(gen.out, 'Figur');
      const r = await generateImage({ prompt: `Fantasy-Charakterporträt (Brustbild) von ${name}: ${look.replace(/[#*>[\]]/g, ' ').slice(0, 700)}. Detailreiche digitale Malerei, neutraler dunkler Hintergrund.` });
      setPortrait(r.dataUrl);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPBusy(false);
    }
  };
  const embedPortrait = async () => {
    const name = titleFromMarkdown(gen.out, 'NPC');
    const meta = await uploadImage(dataURLToBlob(portrait), { folder: 'attachments' });
    const lines = gen.out.split('\n');
    const i = lines.findIndex((l) => /^#\s/.test(l));
    lines.splice(i >= 0 ? i + 1 : 0, 0, '', `![[${meta.name}|260]]`);
    gen.setOut(lines.join('\n'));
    setPortrait(null);
    toast(`Porträt von ${name} eingebettet`, 'success');
  };

  const makeStatblock = async () => {
    setSbBusy(true);
    try {
      const res = await generate({ task: 'encounter', json: true, system: encounterSystemPrompt(), prompt: `Erstelle für den folgenden NPC genau EINEN passenden Statblock (monsters mit genau einem Eintrag, qty 1). difficulty.score = 0, terrain/loot leer.\n\n${gen.out.slice(0, 7000)}` });
      const data = extractJSON(res.text);
      if (!data.monsters?.[0]) throw new Error('Kein Statblock erhalten.');
      setSb(data.monsters[0]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSbBusy(false);
    }
  };

  const saveAllSplit = async () => {
    const parts = gen.out.split(/\n(?=#\s)/).map((s) => s.trim()).filter((s) => /^#\s/.test(s));
    for (const p of parts) await saveTextAsNote({ text: p.replace(/\n-{3,}\s*$/, ''), title: titleFromMarkdown(p, 'NPC'), folder: npcFolder(), frontmatter: FM });
    toast(`${parts.length} NPCs gespeichert`, 'success');
  };

  const title = titleFromMarkdown(gen.out, 'NPC');
  return html`<${ViewFrame} tabId=${tabId} title="NPC-Schmiede">
    <div class="page wide">
      <div class="split">
        <div class="stack lg">
          <div class="page-head" style="margin:0"><h1><${Icon} name="mask" size=${26} />NPC-Schmiede</h1><span class="sub">Blitz-NPCs ohne KI für spontane Begegnungen – oder ausgearbeitete Figuren mit Stimme, Geheimnis, Bemal-Guide und Porträt.</span></div>

          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="zap" size=${18} />Schnell-NPC (offline)</h3></div>
            <div class="row">
              <${Select} value=${qSpecies} onChange=${setQSpecies} options=${['Zufall', ...SPECIES_NAMES]} style="max-width:180px" />
              <${Segmented} value=${qGender} onChange=${setQGender} options=${[{ value: 'x', label: 'Egal' }, { value: 'w', label: 'weiblich' }, { value: 'm', label: 'männlich' }]} />
              <${Btn} kind="primary" icon="d20" onClick=${rollQuick}>Würfeln<//>
              <${Btn} icon="users" onClick=${rollCrowd}>6 Passanten<//>
            </div>
            ${quick ? html`<div class="card tight">
              <div class="serif" style="font-size:22px;font-weight:700">${quick.name}</div>
              <div class="small muted">${quick.species} · ${quick.job}</div>
              <ul class="small" style="margin:8px 0;padding-left:18px;line-height:1.6">
                <li><b>Aussehen:</b> ${quick.look}</li><li><b>Marotte:</b> ${quick.quirk}</li><li><b>Motivation:</b> ${quick.motive}</li><li><b>Geheimnis:</b> ${quick.secret}</li>
              </ul>
              <div class="btn-row"><${Btn} size="sm" icon="refresh" onClick=${rollQuick}>Neu<//><${Btn} size="sm" icon="save" onClick=${() => quickToNote(quick)}>Als Notiz<//><${Btn} size="sm" icon="sparkles" onClick=${() => quickToAI(quick)}>Mit KI ausarbeiten<//></div>
            </div>` : null}
            ${crowd ? html`<div class="card tight"><div class="list">${crowd.map((q) => html`<div class="list-item" onClick=${() => { setQuick(q); }}><b>${q.name}</b><span class="meta">${q.species}, ${q.job}</span></div>`)}</div>
              <div class="btn-row"><${Btn} size="sm" icon="save" onClick=${crowdToNote}>Alle als Notiz<//><${Btn} size="sm" kind="ghost" onClick=${() => setCrowd(null)}>Schließen<//></div></div>` : null}
          </div>

          <div class="card stack">
            <div class="card-head" style="margin:0"><h3><${Icon} name="sparkles" size=${18} />KI-Ausarbeitung</h3><span class="grow"></span><${ModelPicker} task="npc" value=${model} onChange=${setModel} /></div>
            <div class="grid two" style="gap:10px">
              <${Field} label="Name (optional)"><input class="input" value=${f.name} onInput=${(e) => set({ name: e.target.value })} placeholder="leer = KI erfindet" /><//>
              <${Field} label="Volk"><input class="input" list="ws-species" value=${f.volk} onInput=${(e) => set({ volk: e.target.value })} placeholder="z. B. Zwerg" /><datalist id="ws-species">${SPECIES.map((s) => html`<option value=${s} />`)}</datalist><//>
              <${Field} label="Beruf / Rolle"><input class="input" value=${f.rolle} onInput=${(e) => set({ rolle: e.target.value })} placeholder="z. B. Kartenmacher" /><//>
              <${Field} label="Alter & Geschlecht"><div class="input-group"><input class="input" value=${f.alter} onInput=${(e) => set({ alter: e.target.value })} placeholder="Alter" /><input class="input" value=${f.geschlecht} onInput=${(e) => set({ geschlecht: e.target.value })} placeholder="Geschlecht" /></div><//>
              <${Field} label="Gesinnung"><${Select} value=${f.gesinnung} onChange=${(v) => set({ gesinnung: v })} options=${[{ value: '', label: '– egal –' }, ...ALIGNMENTS]} /><//>
              <${Field} label="Beziehung zur Gruppe"><${Select} value=${f.beziehung} onChange=${(v) => set({ beziehung: v })} options=${RELATIONS} /><//>
            </div>
            <${Field} label="Persönlichkeit">
              <div class="chips">${PERSONALITY.map((p) => html`<button type="button" class=${`chip${f.persoenlichkeit.includes(p) ? ' selected' : ' suggest'}`} onClick=${() => set({ persoenlichkeit: f.persoenlichkeit.includes(p) ? f.persoenlichkeit.filter((x) => x !== p) : [...f.persoenlichkeit, p] })}>${p}</button>`)}</div>
            <//>
            <${Field} label="Aufenthaltsort (verlinkt)">
              ${f.ort ? html`<span class="chip accent">${f.ort.title}<span class="x" onClick=${() => set({ ort: null })}><${Icon} name="x" size=${12} /></span></span>` : html`<${NotePicker} onPick=${(n) => set({ ort: n })} placeholder="Ort aus dem Codex wählen …" />`}
            <//>
            <div class="row"><b class="grow small">Kreativer Kern</b><${DictateButton} onText=${(t) => setCore(`${core}${core ? ' ' : ''}${t}`)} /></div>
            <${AutoTextarea} value=${core} onInput=${(e) => setCore(e.target.value)} minRows=${3} placeholder="z. B. Der gut gekleidete Kartenmacher trägt eine einäugige Lupenbrille und verkauft heimlich Karten an beide Seiten eines Krieges." />
            <${Field} label="Weitere Codex-Notizen als Kontext">
              <${NotePicker} onPick=${(n) => setCtx([...new Set([...ctx, n.id])])} exclude=${ctx} />
              ${ctx.length ? html`<div class="chips" style="margin-top:6px">${ctx.map(noteById).filter(Boolean).map((n) => html`<span class="chip accent">${n.title}<span class="x" onClick=${() => setCtx(ctx.filter((x) => x !== n.id))}><${Icon} name="x" size=${12} /></span></span>`)}</div>` : null}
            <//>
            <div class="row">
              <div class="inline-field"><span class="small muted">Anzahl</span><${IconBtn} icon="minus" onClick=${() => setCount(Math.max(1, count - 1))} /><b>${count}</b><${IconBtn} icon="plus" onClick=${() => setCount(Math.min(5, count + 1))} /></div>
              <${Segmented} value=${length} onChange=${setLength} options=${[{ value: 'kurz', label: 'Kurz' }, { value: 'normal', label: 'Normal' }, { value: 'lang', label: 'Ausführlich' }]} />
            </div>
            <div class="row"><${Toggle} checked=${paint} onChange=${setPaint} label="Bemal-Guide (Miniatur)" /><${Toggle} checked=${stats} onChange=${setStats} label="Kurz-Spielwerte" /></div>
            <${Btn} kind="primary" size="lg" block icon="sparkles" loading=${gen.busy} onClick=${run}>${count > 1 ? `${count} NPCs erschaffen` : 'NPC erschaffen'}<//>
          </div>
        </div>

        <div class="gen-output sticky stack">
          <${GenStatus} gen=${gen} label="Die Figur nimmt Gestalt an …" />
          <${OutputToolbar} gen=${gen} title=${title} folder=${npcFolder()} frontmatter=${FM} onRegenerate=${run}
            extra=${html`
              <${Btn} icon="image" loading=${pBusy} onClick=${makePortrait}>Porträt<//>
              <${Btn} icon="ghost" loading=${sbBusy} onClick=${makeStatblock}>Statblock<//>
              ${count > 1 ? html`<${Btn} icon="layers" onClick=${saveAllSplit}>Einzeln speichern<//>` : null}`} />
          ${portrait ? html`<div class="card tight row top"><img src=${portrait} alt="" style="width:160px;border-radius:12px;cursor:zoom-in" onClick=${() => openLightbox(portrait)} />
            <div class="stack sm"><b>Porträt</b><${Btn} size="sm" icon="save" onClick=${embedPortrait}>In den Text einbetten<//><${Btn} size="sm" kind="ghost" onClick=${() => setPortrait(null)}>Verwerfen<//></div></div>` : null}
          ${sb ? html`<${Statblock} monster=${sb} tools=${html`<${Btn} size="sm" icon="plus" onClick=${() => { gen.setOut(`${gen.out.trimEnd()}\n\n## Spielwerte\n${monsterToMarkdown(sb)}`); setSb(null); toast('Statblock angehängt', 'success'); }}>Anhängen<//>`} />` : null}
          <${OutputView} gen=${gen} placeholder=${html`<div class="card"><${Empty} icon="mask" title="Noch kein NPC">Würfle einen Schnell-NPC oder lass die KI eine Figur mit Tiefgang schreiben. Gespeicherte NPCs landen im Ordner „NPCs“ – mit [[Links]] zu Orten und Fraktionen.<//></div>`} />
        </div>
      </div>
    </div>
  <//>`;
}
