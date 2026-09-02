/*
  Static wiring check for index.html. Catches the class of breakage a model
  test cannot see: JS reaching for an element id that the markup no longer
  has, duplicate ids, dangling ARIA references, and any smuggled-in external
  dependency.

    node tests/dom.test.mjs
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const scriptStart = html.indexOf('<script>');
const markup = html.slice(0, scriptStart);
const script = html.slice(scriptStart);

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? ' — ' + detail : '')); };

/* ---------- every id the markup declares ---------- */
const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const idSet = new Set(ids);
ok('no duplicate ids', ids.length === idSet.size,
  'dupes: ' + ids.filter((v, i) => ids.indexOf(v) !== i).join(', '));

/* ---------- every id the script reaches for must exist ---------- */
const wanted = new Set();
for (const m of script.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) wanted.add(m[1]);
for (const m of script.matchAll(/getElementById\('([^']+)'\)/g)) wanted.add(m[1]);
for (const m of script.matchAll(/querySelector\('#([A-Za-z][\w-]*)'\)/g)) wanted.add(m[1]);
ok('script only reaches for ids that exist', [...wanted].every(id => idSet.has(id)),
  'missing: ' + [...wanted].filter(id => !idSet.has(id)).join(', '));
ok('script actually wires something up', wanted.size > 15, wanted.size + ' ids referenced');

/* ---------- ARIA and anchor references must resolve ---------- */
for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
  const refs = [...markup.matchAll(new RegExp(attr + '="([^"]+)"', 'g'))].flatMap(m => m[1].split(/\s+/));
  ok('every ' + attr + ' target exists', refs.every(r => idSet.has(r)),
    'dangling: ' + refs.filter(r => !idSet.has(r)).join(', '));
}
const anchors = [...markup.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
ok('every in-page anchor resolves', anchors.every(a => idSet.has(a)),
  'dangling: ' + anchors.filter(a => !idSet.has(a)).join(', '));

/* ---------- the file has to stay standalone ---------- */
ok('no external scripts', !/<script[^>]+src=/i.test(html));
ok('no external stylesheets', !/<link[^>]+stylesheet/i.test(html));
ok('no webfonts', !/@font-face|fonts\.googleapis|fonts\.gstatic/i.test(html));
ok('no network calls', !/\bfetch\(|XMLHttpRequest|WebSocket|import\s*\(/.test(script));

/* ---------- structural expectations ---------- */
ok('model block is delimited for the model test',
  /MODEL START/.test(html) && /MODEL END/.test(html));
ok('one main landmark', (markup.match(/<main\b/g) || []).length === 1);
ok('skip link points at the main landmark', /class="skip" href="#main"/.test(markup) && idSet.has('main'));
ok('a polite status region exists', /id="statusLive"[^>]*role="status"/.test(markup));
ok('the detail panel is not a live region',
  !/id="detail"[^>]*aria-live/.test(markup), 'hover would spam it');
ok('charts have a text alternative', idSet.has('macroAlt') && idSet.has('scheduleTable'));
ok('viewport meta present', /name="viewport"/.test(markup));
ok('page declares a language', /<html lang="/.test(html));
ok('title is set', /<title>[^<]{10,}<\/title>/.test(markup));

/* tabs semantics were removed deliberately: role=tab without the pattern
   announces conflicting state, so it must not creep back in */
ok('no half-implemented tab pattern',
  !/role="tab(list)?"/.test(markup) && !/role': 'tab/.test(script));

console.log((fails.length ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m')
  + ' — ' + pass + ' wiring checks passed, ' + fails.length + ' failures');
if (fails.length) {
  for (const f of fails) console.log('  • ' + f);
  process.exit(1);
}
