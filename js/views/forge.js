// Weltenschmiede: KI-Weltenbau mit kombinierbaren Themenblöcken, Codex-Kontext, Inspirationsbildern, Rezepten.
import { html, useState, useEffect, useMemo } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import { app, noteById, userCol } from '../core/app.js';
import { settings, updateSettings } from '../core/settings.js';
import { generateImage } from '../core/ai.js';
import { worldSystemPrompt, buildWorldPrompt, imagePromptFrom } from '../core/prompts.js';
import { saveToArchive, titleFromMarkdown } from '../core/archive.js';
import { db } from '../core/db.js';
import { BLOCKS, SECTIONS, EXTRA_SECTIONS, GEN_TYPES, DETAIL, WEIGHT_LABELS } from '../data/blocks.js';
import { ViewFrame } from '../ui/frame.js';
import {
  Icon, IconBtn, Btn, Field, ModelPicker, NotePicker, DictateButton, AutoTextarea, Segmented, openMenu, openModal,
  promptDialog, confirmDialog, toast, pickFiles, Empty, openLightbox,
} from '../ui/components.js';
import { useGeneration, GenStatus, OutputToolbar, OutputView } from '../ui/aiout.js';
import { uid, pick, copyText, debounce, estimateTokens, readFileAsText, dataURLToBlob } from '../lib/util.js';
import { dataUrlFromImageFile } from '../lib/image.js';
import { uploadImage } from './codex.js';

function blockFromKey(key, custom) {
  const def = BLOCKS[key] || custom;
  return { id: uid(6), key, label: def?.label || key, values: [], weight: 1, muted: false, custom: custom || null };
}

function typeBlocks(typeId) {
  const t = GEN_TYPES.find((x) => x.id === typeId) || GEN_TYPES[0];
  return t.blocks.map((k) => blockFromKey(k));
}

function defaultConfig(typeId = 'ort') {
  const t = GEN_TYPES.find((x) => x.id === typeId) || GEN_TYPES[0];
  return { typeId: t.id, blocks: typeBlocks(t.id), core: '', freeTask: '', contextIds: [], sections: [...t.sections], extras: ['bemal'], detail: 'normal', npcs: 2 };
}

function BlockCard({ b, onChange, onRemove, onMove, customBlocks }) {
  const def = BLOCKS[b.key] || b.custom || customBlocks.find((c) => c.key === b.key) || { options: [], icon: 'feather', color: '#95a5a6' };
  const [input, setInput] = useState('');
  const [all, setAll] = useState(false);
  const add = (v) => {
    const val = v.trim();
    if (val && !b.values.includes(val)) onChange({ ...b, values: [...b.values, val] });
  };
  const remove = (v) => onChange({ ...b, values: b.values.filter((x) => x !== v) });
  const options = (def.options || []).filter((o) => !b.values.includes(o));
  const menu = (e) => openMenu(e, [
    { label: b.muted ? 'Aktivieren' : 'Deaktivieren (ignorieren)', icon: b.muted ? 'eye' : 'eye-off', onClick: () => onChange({ ...b, muted: !b.muted }) },
    { label: 'Leeren', icon: 'eraser', onClick: () => onChange({ ...b, values: [] }) },
    { label: 'Nach oben', icon: 'arrow-up', onClick: () => onMove(-1) },
    { label: 'Nach unten', icon: 'arrow-down', onClick: () => onMove(1) },
    { divider: true },
    { label: 'Block entfernen', icon: 'trash', danger: true, onClick: onRemove },
  ]);
  return html`<div class=${`block${b.muted ? ' muted-block' : ''}`} style=${{ '--block-c': def.color || 'var(--accent)' }}>
    <div class="block-head">
      <span class="ttl"><${Icon} name=${def.icon || 'feather'} size=${16} /><span class="ellipsis">${b.label}</span></span>
      <button type="button" class="weight-dots" title=${`Gewichtung: ${WEIGHT_LABELS[b.weight]} (klicken zum Ändern)`} onClick=${() => onChange({ ...b, weight: (b.weight + 1) % 3 })}>
        ${[0, 1, 2].map((i) => html`<b class=${i <= b.weight ? 'on' : ''}></b>`)}
      </button>
      <${IconBtn} icon="d20" size=${16} class="sm" title="Zufällig wählen" onClick=${() => options.length && onChange({ ...b, values: [...b.values, pick(options)] })} />
      <${IconBtn} icon="more-vertical" size=${16} class="sm" title="Mehr" onClick=${menu} />
    </div>
    <div class="picked chips">${b.values.map((v) => html`<span class="chip selected" key=${v}><span class="txt">${v}</span><span class="x" onClick=${() => remove(v)}><${Icon} name="x" size=${12} /></span></span>`)}</div>
    <input class="input sm" value=${input} placeholder="Eigene Eingabe + Enter" onInput=${(e) => setInput(e.target.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input); setInput(''); } }} />
    ${options.length ? html`<div class=${`suggestions${all ? ' open' : ''}`}>${options.map((o) => html`<button type="button" class="chip suggest" key=${o} onClick=${() => add(o)}>+ ${o}</button>`)}</div>
      ${options.length > 6 ? html`<button type="button" class="small faint" style="text-align:left" onClick=${() => setAll(!all)}>${all ? 'weniger' : `alle ${options.length} Vorschläge`}</button>` : null}` : null}
  </div>`;
}

export function ForgeView({ params, tabId }) {
  const saved = settings.get().forge.lastConfig;
  const [cfg, setCfg] = useState(() => (saved?.blocks ? { ...defaultConfig(saved.typeId), ...saved } : defaultConfig()));
  const [model, setModel] = useState(null);
  const [images, setImages] = useState([]);
  const [image, setImage] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);
  const customBlocks = useStore(settings, (s) => s.forge.customBlocks || []);
  const recipes = useStore(settings, (s) => s.forge.recipes || []);
  const gen = useGeneration('world');
  const type = GEN_TYPES.find((t) => t.id === cfg.typeId) || GEN_TYPES[0];

  const persist = useMemo(() => debounce((c) => updateSettings({ forge: { lastConfig: c } }), 800), []);
  const set = (patch) => setCfg((c) => {
    const n = { ...c, ...patch };
    persist(n);
    return n;
  });

  // Aus dem Archiv laden
  useEffect(() => {
    if (!params.archiveId) return;
    db.get(userCol('archive'), params.archiveId).then((a) => {
      if (!a) return;
      if (a.config?.blocks) setCfg({ ...defaultConfig(a.config.typeId), ...a.config });
      gen.setOut(a.text || '');
    });
  }, [params.archiveId]);

  const chooseType = (id) => {
    const t = GEN_TYPES.find((x) => x.id === id);
    const keep = new Map(cfg.blocks.filter((b) => b.values.length).map((b) => [b.key, b]));
    const blocks = t.blocks.map((k) => keep.get(k) || blockFromKey(k));
    for (const b of keep.values()) if (!t.blocks.includes(b.key)) blocks.push(b);
    set({ typeId: id, blocks, sections: [...t.sections] });
  };

  const updateBlock = (i, b) => set({ blocks: cfg.blocks.map((x, j) => (j === i ? b : x)) });
  const moveBlock = (i, d) => {
    const arr = [...cfg.blocks];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ blocks: arr });
  };
  const addBlockMenu = (e) => {
    const used = new Set(cfg.blocks.map((b) => b.key));
    openMenu(e, [
      { header: true, label: 'Themenblock hinzufügen' },
      ...Object.entries(BLOCKS).filter(([k]) => !used.has(k)).map(([k, d]) => ({ label: d.label, icon: d.icon, onClick: () => set({ blocks: [...cfg.blocks, blockFromKey(k)] }) })),
      ...customBlocks.filter((c) => !used.has(c.key)).map((c) => ({ label: `${c.label} (eigener)`, icon: 'feather', onClick: () => set({ blocks: [...cfg.blocks, blockFromKey(c.key, c)] }) })),
      { divider: true },
      { label: 'Eigenen Block erstellen …', icon: 'plus', onClick: createCustomBlock },
    ]);
  };
  const createCustomBlock = async () => {
    const label = await promptDialog('Name des Blocks', '', { title: 'Eigener Themenblock', placeholder: 'z. B. Kulinarik, Handelsrouten, Kreaturen' });
    if (!label) return;
    const opts = await promptDialog('Vorschläge (durch Komma getrennt, optional)', '', { title: label, multiline: true, placeholder: 'Pilzbier, Salzfisch, Honigkuchen' });
    const custom = { key: `c_${uid(5)}`, label, icon: 'feather', color: '#95a5a6', options: (opts || '').split(',').map((s) => s.trim()).filter(Boolean) };
    updateSettings({ forge: { customBlocks: [...customBlocks, custom] } });
    set({ blocks: [...cfg.blocks, blockFromKey(custom.key, custom)] });
  };

  const randomizeAll = () => {
    set({
      blocks: cfg.blocks.map((b) => {
        if (b.values.length || b.muted) return b;
        const def = BLOCKS[b.key] || b.custom;
        return def?.options?.length ? { ...b, values: [pick(def.options)] } : b;
      }),
    });
  };
  const resetAll = async () => {
    if (await confirmDialog('Alle Bausteine und Eingaben zurücksetzen?', { ok: 'Zurücksetzen' })) setCfg(defaultConfig(cfg.typeId));
  };

  const saveRecipe = async () => {
    const name = await promptDialog('Name des Rezepts', '', { title: 'Rezept speichern', placeholder: 'z. B. Zwergische Bergbaustadt' });
    if (!name) return;
    updateSettings({ forge: { recipes: [...recipes, { id: uid(6), name, config: { ...cfg, contextIds: [] } }] } });
    toast('Rezept gespeichert', 'success');
  };
  const recipeMenu = (e) => openMenu(e, recipes.length ? [
    { header: true, label: 'Rezepte' },
    ...recipes.map((r) => ({ label: r.name, icon: 'book-open', onClick: () => set({ ...defaultConfig(r.config.typeId), ...r.config }) })),
    { divider: true },
    ...recipes.map((r) => ({ label: `„${r.name}“ löschen`, icon: 'trash', danger: true, onClick: () => updateSettings({ forge: { recipes: recipes.filter((x) => x.id !== r.id) } }) })),
  ] : [{ label: 'Noch keine Rezepte gespeichert', disabled: true }]);

  const sections = cfg.sections.map((k) => SECTIONS[k]).filter(Boolean);
  const extras = cfg.extras.map((k) => EXTRA_SECTIONS[k]).filter(Boolean);
  const words = DETAIL.find((d) => d.value === cfg.detail)?.words || 1000;
  const prompt = useMemo(() => buildWorldPrompt({
    typeLabel: type.label, blocks: cfg.blocks, core: cfg.core, contextIds: cfg.contextIds, sections, extras, words, npcs: cfg.npcs,
    freeTask: cfg.typeId === 'frei' ? cfg.freeTask || cfg.core : '',
  }), [cfg]);

  const run = async () => {
    setImage(null);
    const res = await gen.run({ system: worldSystemPrompt(), model, prompt, images: images.map(({ mime, data }) => ({ mime, data })) });
    if (res?.text) saveToArchive({ kind: 'forge', title: titleFromMarkdown(res.text, type.label), text: res.text, config: cfg, provider: res.provider, model: res.model });
  };

  const addImages = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    for (const f of files) {
      const url = await dataUrlFromImageFile(f, { maxDim: 1280, quality: 0.8 });
      const [head, data] = url.split(',');
      const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg';
      setImages((arr) => [...arr, { id: uid(5), url, mime, data, name: f.name }]);
    }
  };
  const loadTextFile = async () => {
    const [f] = await pickFiles({ accept: '.md,.txt,text/*' });
    if (f) set({ core: `${cfg.core}${cfg.core ? '\n\n' : ''}${await readFileAsText(f)}` });
  };

  const makeImage = async () => {
    setImgBusy(true);
    try {
      const m = /##\s*Bild-Prompt\s*\n+([\s\S]+?)(\n##|$)/i.exec(gen.out);
      const p = m ? m[1].trim() : imagePromptFrom(gen.out.slice(0, 1200));
      const r = await generateImage({ prompt: p, aspect: '16:9' });
      setImage(r.dataUrl);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setImgBusy(false);
    }
  };
  const saveImage = async () => {
    const meta = await uploadImage(dataURLToBlob(image), {});
    await copyText(`![[${meta.name}]]`);
    toast(`Bild „${meta.name}“ gespeichert – Einbettung kopiert`, 'success');
  };

  const showPrompt = () => openModal(() => html`<div class="modal-body stack">
    <p class="small muted" style="margin:0">So wird die Anfrage an die KI geschickt (System + Nachricht). ~${estimateTokens(worldSystemPrompt() + prompt).toLocaleString('de-DE')} Tokens.</p>
    <pre class="markdown" style="white-space:pre-wrap;max-height:60vh;overflow:auto;background:var(--bg-2);padding:12px;border-radius:10px;font-size:13px">${worldSystemPrompt()}\n\n────────\n\n${prompt}</pre>
    <div class="btn-row end"><${Btn} icon="copy" onClick=${() => { copyText(`${worldSystemPrompt()}\n\n${prompt}`); toast('Kopiert'); }}>Kopieren<//></div>
  </div>`, { title: 'Prompt ansehen', icon: 'eye', size: 'lg' });

  const ctxNotes = cfg.contextIds.map(noteById).filter(Boolean);
  const title = titleFromMarkdown(gen.out, type.label);

  return html`<${ViewFrame} tabId=${tabId} title="Weltenschmiede" actions=${html`<div class="row nowrap" style="gap:2px">
      <${IconBtn} icon="book-open" title="Rezepte laden" onClick=${recipeMenu} />
      <${IconBtn} icon="archive" title="Archiv der Welten" onClick=${() => import('../core/workspace.js').then((m) => m.openView('archive'))} />
    </div>`}>
    <div class="page wide">
      <div class="split">
        <div class="stack lg">
          <div class="page-head" style="margin:0">
            <h1><${Icon} name="anvil" size=${26} />Weltenschmiede</h1>
            <span class="sub">Kombiniere Themenblöcke, gib der KI deinen Codex als Kontext – und speichere das Ergebnis direkt als verlinkte Notizen.</span>
          </div>

          <div class="gen-types">
            ${GEN_TYPES.map((t) => html`<button type="button" class=${`gen-type${t.id === cfg.typeId ? ' active' : ''}`} onClick=${() => chooseType(t.id)}><${Icon} name=${t.icon} size=${20} />${t.label}</button>`)}
          </div>

          ${cfg.typeId === 'frei' ? html`<${Field} label="Deine Anfrage"><${AutoTextarea} value=${cfg.freeTask} onInput=${(e) => set({ freeTask: e.target.value })} minRows=${3} placeholder="z. B. Erfinde ein Kartenspiel, das in den Tavernen des Frostreichs gespielt wird – mit Regeln und Einsätzen." /><//>` : null}

          <div>
            <div class="section-title" style="margin-top:0"><${Icon} name="layers" size=${14} />Themenblöcke
              <span class="grow"></span>
              <${Btn} size="sm" kind="ghost" icon="d20" onClick=${randomizeAll}>Leere würfeln<//>
              <${Btn} size="sm" kind="ghost" icon="plus" onClick=${addBlockMenu}>Block<//>
            </div>
            <div class="blocks">
              ${cfg.blocks.map((b, i) => html`<${BlockCard} key=${b.id} b=${b} customBlocks=${customBlocks} onChange=${(nb) => updateBlock(i, nb)} onRemove=${() => set({ blocks: cfg.blocks.filter((_, j) => j !== i) })} onMove=${(d) => moveBlock(i, d)} />`)}
            </div>
          </div>

          <div class="card stack">
            <div class="row"><b class="grow"><${Icon} name="feather" size=${16} /> Kreativer Kern</b>
              <${DictateButton} onText=${(t) => set({ core: `${cfg.core}${cfg.core && !/\s$/.test(cfg.core) ? ' ' : ''}${t}` })} />
              <${IconBtn} icon="file-text" title="Text-/Markdown-Datei laden" onClick=${loadTextFile} />
              <${IconBtn} icon="image" title="Inspirationsbild anhängen (für Modelle mit Bildverständnis)" onClick=${addImages} />
            </div>
            <${AutoTextarea} value=${cfg.core} onInput=${(e) => set({ core: e.target.value })} minRows=${4} maxHeight=${700}
              placeholder="Alles, was unbedingt hinein soll: Ideen, Namen, Stimmung, Stichpunkte, ganze Absätze … z. B. „Ein magischer Unfall hat die Schwerkraft im Nordviertel umgekehrt.“" />
            ${images.length ? html`<div class="row">${images.map((im) => html`<span class="chip"><img src=${im.url} style="width:28px;height:28px;object-fit:cover;border-radius:6px" alt="" />${im.name || 'Bild'}<span class="x" onClick=${() => setImages(images.filter((x) => x.id !== im.id))}><${Icon} name="x" size=${12} /></span></span>`)}</div>` : null}
          </div>

          <div class="card stack">
            <b><${Icon} name="link" size=${16} /> Kontext aus dem Codex</b>
            <div class="small faint">Wähle Notizen (z. B. das Reich, benachbarte Städte), damit das Ergebnis zu deiner Welt passt. Der Welt-Kontext der Kampagne wird immer mitgeschickt.</div>
            <${NotePicker} onPick=${(n) => set({ contextIds: [...new Set([...cfg.contextIds, n.id])] })} exclude=${cfg.contextIds} placeholder="Notiz als Kontext hinzufügen …" />
            ${ctxNotes.length ? html`<div class="context-notes">${ctxNotes.map((n) => html`<span class="chip accent"><${Icon} name="file-text" size=${12} />${n.title}<span class="x" onClick=${() => set({ contextIds: cfg.contextIds.filter((x) => x !== n.id) })}><${Icon} name="x" size=${12} /></span></span>`)}</div>` : null}
          </div>

          <div class="card stack">
            <b><${Icon} name="list" size=${16} /> Ausgabe</b>
            <${Field} label="Umfang"><${Segmented} value=${cfg.detail} onChange=${(v) => set({ detail: v })} options=${DETAIL.map((d) => ({ value: d.value, label: d.label }))} /><//>
            ${type.sections.length ? html`<${Field} label="Abschnitte">
              <div class="chips">${Object.entries(SECTIONS).filter(([k]) => type.sections.includes(k) || cfg.sections.includes(k)).map(([k, s]) => html`<button type="button" class=${`chip${cfg.sections.includes(k) ? ' selected' : ' suggest'}`} onClick=${() => set({ sections: cfg.sections.includes(k) ? cfg.sections.filter((x) => x !== k) : [...cfg.sections, k] })}>${s.label}</button>`)}
                <button type="button" class="chip suggest" onClick=${(e) => openMenu(e, Object.entries(SECTIONS).filter(([k]) => !cfg.sections.includes(k) && !type.sections.includes(k)).map(([k, s]) => ({ label: s.label, onClick: () => set({ sections: [...cfg.sections, k] }) })))}>+ weitere</button>
              </div>
            <//>` : null}
            <${Field} label="Extras">
              <div class="chips">${Object.entries(EXTRA_SECTIONS).map(([k, s]) => html`<button type="button" class=${`chip${cfg.extras.includes(k) ? ' selected' : ' suggest'}`} onClick=${() => set({ extras: cfg.extras.includes(k) ? cfg.extras.filter((x) => x !== k) : [...cfg.extras, k] })}>${s.label}</button>`)}</div>
            <//>
            ${cfg.sections.includes('npcs') ? html`<div class="inline-field"><span class="small muted">Anzahl NPCs</span><${IconBtn} icon="minus" onClick=${() => set({ npcs: Math.max(1, cfg.npcs - 1) })} /><b>${cfg.npcs}</b><${IconBtn} icon="plus" onClick=${() => set({ npcs: Math.min(6, cfg.npcs + 1) })} /></div>` : null}
          </div>

          <div class="row">
            <${ModelPicker} task="world" value=${model} onChange=${setModel} />
            <span class="token-meter">~${estimateTokens(prompt).toLocaleString('de-DE')} Tokens Eingabe</span>
            <span class="grow"></span>
            <${IconBtn} icon="eye" title="Prompt ansehen" onClick=${showPrompt} />
            <${IconBtn} icon="save" title="Als Rezept speichern" onClick=${saveRecipe} />
            <${IconBtn} icon="eraser" title="Zurücksetzen" onClick=${resetAll} />
          </div>
          <${Btn} kind="primary" size="xl" block icon="sparkles" loading=${gen.busy} onClick=${run}>${type.id === 'frei' ? 'Anfrage senden' : `${type.label} erschaffen`}<//>
        </div>

        <div class="gen-output sticky stack">
          <${GenStatus} gen=${gen} label="Die Esse glüht – Welt wird geschmiedet …" />
          <${OutputToolbar} gen=${gen} title=${title} folder=${type.folder} onRegenerate=${run}
            extra=${html`<${Btn} icon="image" loading=${imgBusy} onClick=${makeImage}>Bild<//>`} />
          ${image ? html`<div class="card tight stack"><img src=${image} alt="" style="border-radius:10px;cursor:zoom-in" onClick=${() => openLightbox(image)} /><div class="btn-row"><${Btn} size="sm" icon="save" onClick=${saveImage}>In Anhänge speichern<//><${Btn} size="sm" kind="ghost" onClick=${() => setImage(null)}>Verwerfen<//></div></div>` : null}
          <${OutputView} gen=${gen} placeholder=${html`<div class="card"><${Empty} icon="anvil" title="Bereit zum Schmieden">Wähle einen Typ, kombiniere Themenblöcke (leer = die KI entscheidet), ergänze deinen kreativen Kern – dann „Erschaffen“. Alles landet automatisch im <a href="#" onClick=${(e) => { e.preventDefault(); import('../core/workspace.js').then((m) => m.openView('archive')); }}>Archiv der Welten</a>.<//></div>`} />
        </div>
      </div>
    </div>
  <//>`;
}
