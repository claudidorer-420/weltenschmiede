// Import & Export: Obsidian-Vault (ZIP/Ordner/Dateien) importieren, als Vault exportieren, Kampagnen-Backup,
// persönliche Daten sichern und lokale Daten in die Cloud übertragen.
import { html, useState } from '../lib/preact.js';
import { useStore } from '../core/store.js';
import {
  app, vault, col, myUid, myName, importNotes, addFolders, createCampaign, openCampaign, refreshCampaigns,
} from '../core/app.js';
import { db, localDb } from '../core/db.js';
import { saveFile, fileDataUrl } from '../core/files.js';
import { readZip, writeZip } from '../lib/zip.js';
import { parseFrontmatter, setFrontmatter, IMAGE_RE } from '../lib/markdown.js';
import { ViewFrame } from '../ui/frame.js';
import { Icon, Btn, Segmented, Toggle, toast, confirmDialog, pickFiles } from '../ui/components.js';
import { now, download, dataURLToBlob, readFileAsText } from '../lib/util.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
const SKIP = /(^|\/)(\.obsidian|\.trash|\.git|__MACOSX|node_modules)(\/|$)|(^|\/)\.DS_Store$/;
const COLLS = ['notes', 'secrets', 'trash', 'files', 'sessions', 'quests', 'maps', 'pins', 'tokens', 'handouts', 'monsters', 'encounters', 'combat', 'gm', 'chat', 'posts', 'party'];

async function entriesFromZip(file) {
  const zip = await readZip(await file.arrayBuffer());
  return zip.filter((e) => !e.dir).map((e) => ({ path: e.name, text: () => e.text(), blob: async () => new Blob([await e.data()], { type: MIME[e.name.split('.').pop().toLowerCase()] || 'application/octet-stream' }) }));
}
function entriesFromFiles(files) {
  return files.map((f) => ({ path: f.webkitRelativePath || f.name, text: () => readFileAsText(f), blob: async () => f }));
}

function analyze(entries) {
  const list = entries.filter((e) => !SKIP.test(e.path));
  const md = list.filter((e) => /\.md$/i.test(e.path));
  const img = list.filter((e) => IMAGE_RE.test(e.path));
  const other = list.length - md.length - img.length;
  const firsts = new Set(list.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')));
  const root = firsts.size === 1 && [...firsts][0] && list.every((e) => e.path.includes('/')) ? `${[...firsts][0]}/` : '';
  return { md, img, other, root, total: list.length };
}

function visibilityFrom(props, fallback) {
  const v = String(props.sichtbarkeit ?? props.visibility ?? '').toLowerCase();
  if (['spieler', 'players', 'player', 'öffentlich', 'public'].includes(v) || props.publish === true) return 'players';
  if (['sl', 'gm', 'dm', 'geheim', 'private'].includes(v)) return 'gm';
  return fallback;
}

export function ImportView({ tabId }) {
  const cid = useStore(app, (s) => s.cid);
  const campaign = useStore(app, (s) => s.campaign);
  const mode = useStore(app, (s) => s.mode);
  const [plan, setPlan] = useState(null);
  const [conflict, setConflict] = useState('rename');
  const [vis, setVis] = useState('gm');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState(null);
  const [withSecrets, setWithSecrets] = useState(true);

  const choose = async (kind) => {
    setReport(null);
    try {
      let entries = [];
      if (kind === 'zip') {
        const [f] = await pickFiles({ accept: '.zip,application/zip' });
        if (!f) return;
        setBusy('read');
        entries = await entriesFromZip(f);
      } else if (kind === 'dir') {
        entries = entriesFromFiles(await pickFiles({ directory: true, multiple: true }));
      } else {
        entries = entriesFromFiles(await pickFiles({ accept: '.md,.markdown,.txt,image/*', multiple: true }));
      }
      if (!entries.length) return;
      setPlan(analyze(entries));
    } catch (e) {
      toast(`Konnte nicht gelesen werden: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const run = async () => {
    const { md, img, root } = plan;
    setBusy('import');
    const rep = { notes: 0, updated: 0, skipped: 0, images: 0, imgSkipped: 0, folders: 0, errors: [] };
    try {
      const existingFiles = new Set(Object.values(vault.get().files).map((f) => String(f.name).toLowerCase()));
      let i = 0;
      for (const e of img) {
        i++;
        setProgress(`Bilder ${i}/${img.length}`);
        const rel = e.path.slice(root.length);
        const name = rel.split('/').pop();
        const folder = rel.split('/').slice(0, -1).join('/') || 'attachments';
        if (existingFiles.has(name.toLowerCase())) { rep.imgSkipped++; continue; }
        try {
          await saveFile(cid, await e.blob(), { name, folder, visibility: vis, createdBy: myUid(), maxDim: 3000 });
          existingFiles.add(name.toLowerCase());
          rep.images++;
        } catch (err) {
          rep.errors.push(`${name}: ${err.message}`);
        }
      }
      const notes = [];
      const folders = new Set();
      i = 0;
      for (const e of md) {
        i++;
        setProgress(`Notizen lesen ${i}/${md.length}`);
        const rel = e.path.slice(root.length);
        const parts = rel.split('/');
        const title = parts.pop().replace(/\.md$/i, '');
        const folder = parts.join('/');
        if (folder) folders.add(folder);
        const body = (await e.text()).replace(/\r\n/g, '\n');
        const { props } = parseFrontmatter(body);
        notes.push({ title, folder, body, visibility: visibilityFrom(props, vis) });
      }
      const r = await importNotes(notes, { conflict, onProgress: (d, t) => setProgress(`Speichern ${d}/${t}`) });
      rep.notes = r.created;
      rep.updated = r.updated;
      rep.skipped = r.skipped;
      if (folders.size) await addFolders([...folders]);
      rep.folders = folders.size;
      setReport(rep);
      setPlan(null);
      toast(`Import fertig: ${rep.notes} Notizen, ${rep.images} Bilder`, 'success');
    } catch (e) {
      toast(`Import abgebrochen: ${e.message}`, 'error');
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const exportVault = async () => {
    setBusy('export');
    try {
      const entries = [];
      for (const n of Object.values(vault.get().notes)) {
        let body = n.body || '';
        if (n.visibility === 'players') body = setFrontmatter(body, { sichtbarkeit: 'spieler' });
        entries.push({ name: `${n.folder ? `${n.folder}/` : ''}${n.title}.md`, data: body });
      }
      if (withSecrets) {
        for (const s of await db.list(col('secrets'))) {
          const n = vault.get().notes[s.id];
          if (n && s.body) entries.push({ name: `_SL-Geheimnisse/${n.title}.md`, data: `Geheimnisse zu [[${n.title}]]\n\n${s.body}` });
        }
      }
      const files = Object.values(vault.get().files);
      let i = 0;
      for (const f of files) {
        setProgress(`Bilder ${++i}/${files.length}`);
        const d = await fileDataUrl(cid, f.id);
        if (d) entries.push({ name: `${f.folder ? `${f.folder}/` : ''}${f.name}`, data: dataURLToBlob(d) });
      }
      setProgress('ZIP wird erstellt …');
      download(`${campaign?.name || 'Weltenschmiede'} (Obsidian).zip`, await writeZip(entries));
    } catch (e) {
      toast(`Export fehlgeschlagen: ${e.message}`, 'error');
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const backup = async () => {
    setBusy('backup');
    try {
      const out = { format: 'weltenschmiede-backup', version: 1, exportedAt: now(), campaign: app.get().campaign, collections: {}, chunks: {} };
      for (const c of COLLS) out.collections[c] = await db.list(col(c)).catch(() => []);
      for (const f of out.collections.files) out.chunks[f.id] = await db.list(`${col('files')}/${f.id}/chunks`);
      download(`${campaign?.name || 'Kampagne'} – Backup ${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), 'application/json');
    } catch (e) {
      toast(`Backup fehlgeschlagen: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const restore = async () => {
    const [f] = await pickFiles({ accept: '.json,application/json' });
    if (!f) return;
    setBusy('restore');
    try {
      const data = JSON.parse(await readFileAsText(f));
      if (data.format !== 'weltenschmiede-backup') throw new Error('Das ist kein Weltenschmiede-Backup.');
      const name = `${data.campaign?.name || 'Kampagne'} (wiederhergestellt)`;
      if (!(await confirmDialog(`Backup als neue Kampagne „${name}“ einspielen?`, { ok: 'Einspielen' }))) return;
      const newCid = await createCampaign({ name, description: data.campaign?.description || '', world: data.campaign?.world || '' });
      await openCampaign(newCid);
      for (const [c, docs] of Object.entries(data.collections || {})) {
        const ops = docs.map(({ id, ...d }) => ({ op: 'set', col: `campaigns/${newCid}/${c}`, id, data: d }));
        for (let i = 0; i < ops.length; i += 200) {
          setProgress(`${c}: ${Math.min(ops.length, i + 200)}/${ops.length}`);
          await db.batch(ops.slice(i, i + 200));
        }
      }
      for (const [fid, chunks] of Object.entries(data.chunks || {})) await db.batch(chunks.map(({ id, ...d }) => ({ op: 'set', col: `campaigns/${newCid}/files/${fid}/chunks`, id, data: d })));
      if (data.campaign?.folders?.length) await addFolders(data.campaign.folders);
      toast('Backup eingespielt', 'success');
    } catch (e) {
      toast(`Wiederherstellen fehlgeschlagen: ${e.message}`, 'error');
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const personal = async () => {
    const me = myUid();
    const out = { format: 'weltenschmiede-personal', exportedAt: now(), characters: await db.list(`users/${me}/characters`), notes: await db.list(`users/${me}/notes`) };
    download(`Weltenschmiede – ${myName()} – Charaktere & Tagebuch.json`, JSON.stringify(out, null, 1), 'application/json');
  };

  return html`<${ViewFrame} tabId=${tabId} title="Import & Export">
    <div class="page narrow stack lg">
      <div class="page-head"><h1><${Icon} name="upload" size=${24} />Import & Export</h1><span class="sub">Ziel: <b>${campaign?.name}</b>. Deine Obsidian-Notizen bleiben kompatibel – du kannst jederzeit wieder als Vault exportieren.</span></div>

      <div class="card stack">
        <div class="card-head" style="margin:0"><h3><${Icon} name="folder-open" size=${18} />Obsidian-Vault importieren</h3></div>
        <div class="small muted" style="line-height:1.6">
          <b>Am Tablet/Handy:</b> Den Vault-Ordner (z. B. <code>Documents/Obsidian/DnD</code>) in der Dateien-App als ZIP komprimieren und hier wählen.<br />
          <b>Am PC:</b> Ordner direkt wählen oder ZIP. Ordnerstruktur, [[Links]], Bilder (<code>![[bild.png]]</code>), Eigenschaften und #Tags bleiben erhalten; <code>.obsidian</code> wird übersprungen.
        </div>
        <div class="btn-row">
          <${Btn} kind="primary" icon="archive" loading=${busy === 'read'} onClick=${() => choose('zip')}>ZIP wählen<//>
          <${Btn} icon="folder-open" onClick=${() => choose('dir')}>Ordner wählen<//>
          <${Btn} icon="file-text" onClick=${() => choose('files')}>Einzelne Dateien<//>
        </div>
        ${plan ? html`<div class="card tight stack">
          <div><b>${plan.md.length}</b> Notizen · <b>${plan.img.length}</b> Bilder${plan.other ? ` · ${plan.other} andere Dateien (werden übersprungen)` : ''}${plan.root ? html` · Vault-Ordner „${plan.root.slice(0, -1)}“` : ''}</div>
          <div class="row"><span class="small muted" style="width:170px">Gleichnamige Notizen</span><${Segmented} value=${conflict} onChange=${setConflict} options=${[{ value: 'rename', label: 'Umbenennen' }, { value: 'skip', label: 'Überspringen' }, { value: 'overwrite', label: 'Überschreiben' }]} /></div>
          <div class="row"><span class="small muted" style="width:170px">Sichtbarkeit</span><${Segmented} value=${vis} onChange=${setVis} options=${[{ value: 'gm', label: 'Nur SL', icon: 'lock' }, { value: 'players', label: 'Für Spieler', icon: 'users' }]} /></div>
          <div class="tiny faint">Tipp: Eigenschaft <code>sichtbarkeit: spieler</code> in einer Notiz gibt sie beim Import automatisch frei.</div>
          <div class="btn-row"><${Btn} kind="primary" icon="upload" loading=${busy === 'import'} onClick=${run}>Jetzt importieren<//><${Btn} kind="ghost" onClick=${() => setPlan(null)}>Abbrechen<//>${progress ? html`<span class="small muted">${progress}</span>` : null}</div>
        </div>` : null}
        ${report ? html`<div class="callout callout-green"><div class="callout-title"><${Icon} name="check-circle" size=${16} />Import abgeschlossen</div><div class="callout-content small">
          ${report.notes} neue Notizen${report.updated ? `, ${report.updated} überschrieben` : ''}${report.skipped ? `, ${report.skipped} übersprungen` : ''} · ${report.images} Bilder${report.imgSkipped ? ` (${report.imgSkipped} schon vorhanden)` : ''} · ${report.folders} Ordner
          ${report.errors.length ? html`<br /><span class="danger-text">${report.errors.length} Fehler: ${report.errors.slice(0, 3).join('; ')}</span>` : null}
        </div></div>` : null}
      </div>

      <div class="card stack">
        <div class="card-head" style="margin:0"><h3><${Icon} name="download" size=${18} />Export</h3></div>
        <${Toggle} checked=${withSecrets} onChange=${setWithSecrets} label="SL-Geheimnisse als eigenen Ordner mit exportieren" />
        <div class="btn-row">
          <${Btn} icon="archive" loading=${busy === 'export'} onClick=${exportVault}>Als Obsidian-Vault (ZIP)<//>
          <${Btn} icon="save" loading=${busy === 'backup'} onClick=${backup}>Komplett-Backup (JSON)<//>
          <${Btn} icon="upload" loading=${busy === 'restore'} onClick=${restore}>Backup einspielen<//>
          ${progress && busy !== 'import' ? html`<span class="small muted">${progress}</span>` : null}
        </div>
        <div class="small faint">Das Komplett-Backup enthält Notizen, Geheimnisse, Bilder, Karten, Sitzungen, Quests, Bestiarium und Chat. Einspielen erzeugt immer eine <i>neue</i> Kampagne – nichts wird überschrieben.</div>
        <div class="hr"></div>
        <div class="row"><span class="grow small muted">Deine Charaktere und dein Tagebuch (gehören dir, unabhängig von Kampagnen):</span><${Btn} size="sm" icon="download" onClick=${personal}>Sichern<//></div>
      </div>
      ${mode === 'cloud' ? html`<${MigrationCard} />` : null}
    </div>
  <//>`;
}

// ───────────────────────── Lokal → Cloud ─────────────────────────
export async function localSummary() {
  try {
    return await localDb.list('users/local/campaigns');
  } catch {
    return [];
  }
}

export async function migrateLocalToCloud(onProgress = () => {}) {
  const uid = myUid();
  const strip = ({ id, ...d }) => d;
  const list = await localDb.list('users/local/campaigns');
  let done = 0;
  for (const entry of list) {
    const cid = entry.id;
    const c = await localDb.get('campaigns', cid);
    if (!c) continue;
    onProgress(`Kampagne „${c.name}“ …`);
    await db.set('campaigns', cid, { ...strip(c), ownerUid: uid });
    await db.set(`campaigns/${cid}/members`, uid, { uid, name: myName(), role: 'gm', joinedAt: now() });
    await db.set(`users/${uid}/campaigns`, cid, { name: c.name, role: 'gm', joinedAt: now() });
    for (const coll of COLLS) {
      const docs = await localDb.list(`campaigns/${cid}/${coll}`);
      if (!docs.length) continue;
      onProgress(`„${c.name}“: ${coll} (${docs.length})`);
      await db.batch(docs.map((d) => ({ op: 'set', col: `campaigns/${cid}/${coll}`, id: d.id, data: strip(d) })));
      if (coll === 'files') {
        for (const f of docs) {
          const chunks = await localDb.list(`campaigns/${cid}/files/${f.id}/chunks`);
          await db.batch(chunks.map((ch) => ({ op: 'set', col: `campaigns/${cid}/files/${f.id}/chunks`, id: ch.id, data: strip(ch) })));
        }
      }
    }
    done++;
  }
  for (const coll of ['characters', 'notes', 'archive']) {
    const docs = await localDb.list(`users/local/${coll}`);
    if (docs.length) {
      onProgress(`Persönlich: ${coll} (${docs.length})`);
      await db.batch(docs.map((d) => ({ op: 'set', col: `users/${uid}/${coll}`, id: d.id, data: strip(d) })));
    }
  }
  await refreshCampaigns();
  return done;
}

function MigrationCard() {
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (list === null) localSummary().then(setList);
  if (!list?.length) return null;
  const run = async () => {
    if (!(await confirmDialog(`${list.length} lokale Kampagne(n) in deine Cloud kopieren? Die lokalen Daten bleiben zusätzlich erhalten.`, { ok: 'Übertragen' }))) return;
    setBusy(true);
    try {
      const n = await migrateLocalToCloud(setMsg);
      toast(`${n} Kampagne(n) übertragen`, 'success');
      setList([]);
    } catch (e) {
      toast(`Übertragung fehlgeschlagen: ${e.message}`, 'error');
    } finally {
      setBusy(false);
      setMsg('');
    }
  };
  return html`<div class="card stack accent-left">
    <div class="card-head" style="margin:0"><h3><${Icon} name="cloud" size=${18} />Lokale Daten in die Cloud übertragen</h3></div>
    <div class="small muted">Auf diesem Gerät liegen noch ${list.length} Kampagne(n) aus dem Offline-Modus: ${list.map((c) => c.name).join(', ')}.</div>
    <div class="row"><${Btn} kind="primary" icon="upload" loading=${busy} onClick=${run}>In die Cloud kopieren<//>${msg ? html`<span class="small muted">${msg}</span>` : null}</div>
  </div>`;
}
