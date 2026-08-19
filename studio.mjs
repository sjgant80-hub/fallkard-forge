// fallkard-forge · studio.mjs — the COMPOSER: build a sovereign single-file app from estate organs.
//
// Not a Replit-killer — its opposite: you own the workshop and keep the outputs. The bound, stated
// plainly: web-native, single-file, local-first builds only. No servers, no external assets, no
// network calls in the composed output — that is the estate's shape, and validateComposition
// REFUSES anything that breaks it.
//
// The palette is small and real: every organ is working code, not a mock. The oracle is the
// fall-os t0 pattern (signals → stances) trimmed for the studio and labeled as such; notes is a
// real localStorage persistence organ. Composition is DETERMINISTIC — same organs, same name,
// same bytes — so a composed build can be sealed and its seal means something.

export const ORGANS = [
  { id: 'oracle', name: 'the oracle', says: 'lay out the ways a decision could go — the fall-os t0 pattern, trimmed' },
  { id: 'notes', name: 'notes that stay', says: 'write things down; they persist on this machine and nowhere else' },
  { id: 'tally', name: 'the tally', says: 'count anything, keep the count — a sovereign scoreboard' },
];

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── the organ bodies: each a self-contained section + script, no outside world ──────────────────
const BODIES = {
  oracle: {
    html: `<section id="org-oracle"><h2>the oracle</h2>
<p class="quiet">Type a real decision. It looks for signals it can name and ranks a few honest stances — with no signal it says so and ranks by stated defaults.</p>
<textarea id="oq" rows="3" placeholder="should I …"></textarea>
<button id="ogo" type="button">think it through</button>
<div id="oout"></div></section>`,
    js: `(() => {
  const CUES = [
    ['reversible', ['undo', 'reversible', 'try', 'experiment', 'temporary']],
    ['irreversible', ['permanent', 'forever', 'cannot undo', 'irreversible', 'sell', 'quit', 'sign']],
    ['cost', ['cost', 'price', 'expensive', 'cheap', 'money', 'afford']],
    ['deadline', ['deadline', 'by monday', 'urgent', 'soon', 'today', 'this week']],
    ['people', ['family', 'team', 'partner', 'boss', 'kids', 'wife', 'husband', 'friend']],
    ['unknown', ['maybe', 'not sure', 'unsure', 'unknown', 'depends', '?']],
  ];
  const STANCES = [
    { n: 'Start with the smallest step you can undo', p: 0.64, w: ['reversible', 'unknown'], a: ['irreversible'] },
    { n: 'Verify before you commit', p: 0.62, w: ['irreversible', 'cost'], a: ['reversible'] },
    { n: 'Talk to whoever it lands on', p: 0.48, w: ['people', 'irreversible'], a: [] },
    { n: 'Set a stop rule before you start', p: 0.52, w: ['cost', 'unknown'], a: [] },
    { n: 'Do nothing \\u2014 waiting is cheap here', p: 0.40, w: ['unknown', 'reversible'], a: ['deadline'] },
  ];
  document.getElementById('ogo').addEventListener('click', () => {
    const s = document.getElementById('oq').value.toLowerCase();
    const found = CUES.filter(([, ws]) => ws.some(w => s.includes(w))).map(([id]) => id);
    const ranked = STANCES.map(st => ({
      ...st,
      score: Math.max(0, Math.min(1, st.p + st.w.filter(x => found.includes(x)).length * 0.12 - st.a.filter(x => found.includes(x)).length * 0.15)),
    })).sort((x, y) => y.score - x.score);
    const out = document.getElementById('oout');
    out.innerHTML = (found.length ? '<p>signals: <b>' + found.join(', ') + '</b></p>'
      : '<p class="quiet">no signals found \\u2014 ranked by stated defaults only; say more about what is at stake</p>')
      + ranked.slice(0, 3).map(r => '<p><b>' + r.n + '</b> \\u00b7 ' + r.score.toFixed(2) + '</p>').join('');
  });
})();`,
  },
  notes: {
    html: `<section id="org-notes"><h2>notes that stay</h2>
<p class="quiet">Everything typed here is saved on this machine, in this browser, and nowhere else.</p>
<textarea id="nb" rows="6" placeholder="write \\u2014 it keeps"></textarea>
<div id="nstat" class="quiet"></div></section>`,
    js: `(() => {
  const K = 'studio-notes';
  const nb = document.getElementById('nb'), st = document.getElementById('nstat');
  try { nb.value = localStorage.getItem(K) || ''; } catch {}
  nb.addEventListener('input', () => {
    try { localStorage.setItem(K, nb.value); st.textContent = 'kept \\u00b7 ' + nb.value.length + ' characters, on your machine'; }
    catch { st.textContent = 'private mode \\u2014 nothing persists, and that is your call'; }
  });
})();`,
  },
  tally: {
    html: `<section id="org-tally"><h2>the tally</h2>
<p class="quiet">A count that keeps. Name it, press the button, own the number.</p>
<input id="tname" placeholder="what are you counting?">
<button id="tup" type="button">+1</button>
<div id="tshow"></div></section>`,
    js: `(() => {
  const K = 'studio-tally';
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch { return {}; } };
  const show = () => {
    const t = load();
    document.getElementById('tshow').innerHTML = Object.keys(t).sort().map(k => '<p><b>' + k.replace(/[<>&]/g, '') + '</b> \\u00b7 ' + t[k] + '</p>').join('') || '<p class="quiet">nothing counted yet</p>';
  };
  document.getElementById('tup').addEventListener('click', () => {
    const name = (document.getElementById('tname').value || 'things').slice(0, 40);
    const t = load(); t[name] = (t[name] || 0) + 1;
    try { localStorage.setItem(K, JSON.stringify(t)); } catch {}
    show();
  });
  show();
})();`,
  },
};

/**
 * Compose a single-file sovereign build. Deterministic: the same name + organs yield the same
 * bytes, so the seal of a composition is a fact about the composition. Unknown organ ids are
 * skipped silently-never: they come back in `skipped` so the caller can say so.
 */
export function compose(opts) {
  const o = obj(opts);
  const name = (typeof o.name === 'string' && o.name.trim()) ? o.name.trim().slice(0, 48) : 'a sovereign build';
  const wanted = Array.isArray(o.organs) ? o.organs.map(String) : [];
  const picked = ORGANS.filter(g => wanted.includes(g.id));
  const skipped = wanted.filter(id => !ORGANS.some(g => g.id === id));
  const sections = picked.map(g => BODIES[g.id].html).join('\n');
  const scripts = picked.map(g => BODIES[g.id].js).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title>
<style>
body{font-family:Georgia,serif;background:#0b0a0f;color:#d8d2c4;max-width:640px;margin:0 auto;padding:24px 18px;line-height:1.5}
h1{font-size:1.3rem;color:#d4a017}h2{font-size:1.05rem;color:#d4a017;margin-top:1.6rem}
textarea,input{width:100%;background:#141218;color:#d8d2c4;border:1px solid #3a3630;border-radius:6px;padding:8px;font:inherit;box-sizing:border-box}
button{background:#d4a017;color:#0b0a0f;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer;margin:8px 0}
.quiet{opacity:.6;font-size:.9em}footer{margin-top:2.2rem;padding-top:1rem;border-top:1px solid #3a3630;font-size:.8em;opacity:.65}
</style></head><body>
<h1>${esc(name)}</h1>
<p class="quiet">A sovereign single-file build: it runs from this one file, works offline, and sends nothing anywhere.</p>
${sections}
<footer>composed in the Forge Studio · powered by fall·os · Konomi Architecture</footer>
` + '<scr' + 'ipt>' + `
${scripts}
` + '</scr' + 'ipt>' + `
</body></html>`;
  return { name, html, organs: picked.map(g => g.id), skipped };
}

/**
 * The sovereignty check a build must pass before it may mint. REFUSES, with the reason, anything
 * that: is not a document; reaches for the outside world (external src/href, fetch, sockets); or
 * dropped the architecture line. A generated build goes through the same gate as a composed one.
 */
export function validateComposition(html) {
  const s = typeof html === 'string' ? html : '';
  const reasons = [];
  if (!/^\s*<!doctype html>/i.test(s)) reasons.push('not a document — a build starts with <!doctype html>');
  if (/\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(s)) reasons.push('it reaches for the outside world — an external src/href breaks offline-forever');
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/i.test(s)) reasons.push('it phones home — fetch/XHR/sockets have no place in a sovereign single file');
  if (!/Konomi Architecture/.test(s)) reasons.push('the architecture line is missing — every estate build carries it');
  return { ok: reasons.length === 0, reasons };
}

export default compose;
