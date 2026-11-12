// Genera app.bundle.js (script classico, niente moduli ES) da js/app.js.
// Motivo: i moduli ES richiedono un MIME JavaScript; alcuni server locali (es. python -m http.server
// su Windows con .js = text/plain nel registro) li bloccano. Gli script classici no.
// Uso: node tools/build.mjs   (rieseguire dopo ogni modifica a js/)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mods = new Map(); // id -> { deps, code }
const order = [];

function load(id, stack = []) {
  if (mods.has(id)) { if (!mods.get(id).done) throw new Error('Dipendenza circolare: ' + [...stack, id].join(' -> ')); return; }
  const rec = { done: false };
  mods.set(id, rec);
  let src = readFileSync(path.join(ROOT, id), 'utf8').replace(/^\uFEFF/, '');
  const dir = path.posix.dirname(id);
  const exportsList = [];
  src = src.replace(/^import\s+(\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'([^']+)';?[ \t]*$/gm, (m, what, ns, names, spec) => {
    const dep = path.posix.normalize(path.posix.join(dir, spec));
    load(dep, [...stack, id]);
    return ns ? `const ${ns} = __req('${dep}');` : `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = __req('${dep}');`;
  });
  src = src.replace(/^export\s+((?:async\s+)?function\*?\s+(\w+)|(?:const|let|class)\s+(\w+))/gm, (m, rest, fn, other) => {
    exportsList.push(fn || other);
    return rest;
  });
  src = src.replace(/^export\s+\{([^}]*)\};?[ \t]*$/gm, (m, names) => {
    names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exportsList.push(n));
    return '';
  });
  if (/^(import|export)\s/m.test(src)) throw new Error('Sintassi import/export non gestita in ' + id);
  rec.code = `__def('${id}', function (__exp) {\n${src}\n${exportsList.map((n) => `__exp.${n} = ${n};`).join('\n')}\n});`;
  rec.done = true;
  order.push(id);
}

load('js/app.js');
const out = `/* GENERATO da tools/build.mjs: non modificare a mano (modifica js/ e riesegui il build). */
(function () {
'use strict';
var __defs = {}, __cache = {};
function __def(id, fn) { __defs[id] = fn; }
function __req(id) {
  if (__cache[id]) return __cache[id];
  var exp = __cache[id] = {};
  __defs[id](exp);
  return exp;
}
${order.map((id) => mods.get(id).code).join('\n')}
__req('js/app.js');
})();
`;
writeFileSync(path.join(ROOT, 'app.bundle.js'), out);
console.log(`app.bundle.js: ${order.length} moduli, ${out.length} byte`);
if (!existsSync(path.join(ROOT, 'vendor', 'supabase.js'))) {
  console.warn('ATTENZIONE: vendor/supabase.js mancante: accesso e sincronizzazione saranno disattivati (l\'app resta utilizzabile in locale).');
}



