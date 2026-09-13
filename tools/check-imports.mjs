// Statische Prüfung: Existieren alle benannten Importe zwischen den Modulen? Existieren die in shell.js
// registrierten Ansichten? (Fängt Tippfehler ab, die `node --check` nicht bemerkt.)
// Aufruf: node tools/check-imports.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(join(root, 'js'));

const cache = new Map();
function exportsOf(file) {
  if (cache.has(file)) return cache.get(file);
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = /\s+as\s+([A-Za-z0-9_$]+)$/.exec(p);
      names.add(as ? as[1] : p.split(/\s+/)[0]);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');
  cache.set(file, names);
  return names;
}

let problems = 0;
const fail = (msg) => {
  console.log(`✗ ${msg}`);
  problems++;
};

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), m[2]);
    let ex;
    try {
      ex = exportsOf(target);
    } catch {
      fail(`${rel}: Datei nicht gefunden: ${m[2]}`);
      continue;
    }
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name && !ex.has(name)) fail(`${rel}: „${name}“ wird von ${m[2]} nicht exportiert`);
    }
  }
  for (const m of src.matchAll(/import\(\s*['"`](\.[^'"`$]+)['"`]\s*\)/g)) {
    try { statSync(resolve(dirname(file), m[1])); } catch { fail(`${rel}: dynamischer Import fehlt: ${m[1]}`); }
  }
}

// Ansichten-Registrierung in shell.js prüfen
const shellPath = join(root, 'js', 'ui', 'shell.js');
const shell = readFileSync(shellPath, 'utf8');
const loaders = Object.fromEntries([...shell.matchAll(/(\w+):\s*\(\)\s*=>\s*import\('([^']+)'\)/g)].map((m) => [m[1], resolve(dirname(shellPath), m[2])]));
for (const m of shell.matchAll(/mod:\s*'(\w+)',\s*comp:\s*'(\w+)'/g)) {
  const file = loaders[m[1]];
  if (!file) fail(`shell.js: kein Loader für Modul „${m[1]}“`);
  else if (!exportsOf(file).has(m[2])) fail(`shell.js: ${relative(root, file)} exportiert „${m[2]}“ nicht`);
}

console.log(problems ? `\n${problems} Problem(e) gefunden.` : `✓ Alle Importe und Ansichten in ${files.length} Dateien stimmen.`);
process.exit(problems ? 1 : 0);
