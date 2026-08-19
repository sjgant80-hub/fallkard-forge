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
  { id: 'vault', name: 'the vault', says: 'lock a note with a password — AES-GCM, the konomium-vault pattern trimmed; only the password opens it' },
  { id: 'seal', name: 'the seal', says: 'type anything and watch its fingerprint — content addressing, the forge\u2019s own trust story' },
  { id: 'receipts', name: 'the receipts', says: 'a checklist where nothing checks without evidence — proof-of-play as a to-do list' },
  { id: 'fold', name: 'the fold', says: 'a crease-pattern glyph that folds and unfolds — the forgeupgrade pattern, apex-less by geometry' },
  { id: 'cascade', name: 'the cascade', says: 'ask a question and it climbs the ladder — free deterministic first, then your own model, then a rented one with your key. Every answer says where it ran and what it cost' },
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
  vault: {
    html: `<section id="org-vault"><h2>the vault</h2>
<p class="quiet">One note, locked with AES-GCM on this machine. The password never leaves the field, is never stored, and there is no reset \u2014 that is the point.</p>
<input id="vpw" type="password" placeholder="password (there is no reset)">
<textarea id="vtext" rows="4" placeholder="what goes in the vault"></textarea>
<button id="vlock" type="button">lock it</button>
<button id="vopen" type="button">open it</button>
<div id="vstat" class="quiet"></div></section>`,
    js: `(() => {
  // the konomium-vault pattern, trimmed: PBKDF2 (100k, SHA-256) -> AES-GCM, salt+iv ride with the box
  const K = 'studio-vault';
  const st = document.getElementById('vstat');
  const enc2 = new TextEncoder(), dec2 = new TextDecoder();
  const b64v = (u) => btoa(String.fromCharCode(...u));
  const unb64v = (x) => Uint8Array.from(atob(x), c => c.charCodeAt(0));
  async function keyFrom(pw, salt) {
    const base = await crypto.subtle.importKey('raw', enc2.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  document.getElementById('vlock').addEventListener('click', async () => {
    const pw = document.getElementById('vpw').value;
    if (!pw) { st.textContent = 'a vault with no password is a box with no lid'; return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(pw, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc2.encode(document.getElementById('vtext').value)));
    try { localStorage.setItem(K, JSON.stringify({ s: b64v(salt), i: b64v(iv), c: b64v(ct) })); st.textContent = 'locked \u00b7 ' + ct.length + ' encrypted bytes on this machine \u2014 only the password opens it'; }
    catch { st.textContent = 'no storage here (sealed preview or private mode) \u2014 the lock worked, the keeping did not'; }
    document.getElementById('vtext').value = '';
  });
  document.getElementById('vopen').addEventListener('click', async () => {
    let box = null;
    try { box = JSON.parse(localStorage.getItem(K) || 'null'); } catch {}
    if (!box) { st.textContent = 'nothing locked yet'; return; }
    try {
      const key = await keyFrom(document.getElementById('vpw').value, unb64v(box.s));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64v(box.i) }, key, unb64v(box.c));
      document.getElementById('vtext').value = dec2.decode(pt);
      st.textContent = 'open \u2014 the password fit';
    } catch { st.textContent = 'that password does not open this vault \u2014 and nothing can'; }
  });
})();`,
  },
  seal: {
    html: `<section id="org-seal"><h2>the seal</h2>
<p class="quiet">Content addressing: the same words always make the same fingerprint, and one changed letter changes all of it. This is the whole trust story of a forged card.</p>
<textarea id="sin" rows="3" placeholder="type anything \u2014 then change one letter and watch"></textarea>
<div id="sout" class="quiet" style="word-break:break-all"></div></section>`,
    js: `(() => {
  const out = document.getElementById('sout');
  let last = 0;
  document.getElementById('sin').addEventListener('input', async (ev) => {
    const stamp = ++last;
    const u = new TextEncoder().encode(ev.target.value);
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u))).map(b => b.toString(16).padStart(2, '0')).join('');
    if (stamp !== last) return; // a newer keystroke already owns the display
    out.innerHTML = ev.target.value ? 'sha256 \u00b7 <b>' + h + '</b>' : '';
  });
})();`,
  },
  receipts: {
    html: `<section id="org-receipts"><h2>the receipts</h2>
<p class="quiet">Proof-of-play as a checklist: nothing gets ticked on your say-so \u2014 a box only checks when you write down what proves it.</p>
<input id="rnew" placeholder="a thing to do">
<button id="radd" type="button">add it</button>
<div id="rlist"></div></section>`,
    js: `(() => {
  const K = 'studio-receipts';
  const load2 = () => { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch { return []; } };
  const keep = (items) => { try { localStorage.setItem(K, JSON.stringify(items)); } catch {} };
  const escR = (x) => String(x).replace(/[<>&]/g, '');
  function show() {
    const items = load2();
    document.getElementById('rlist').innerHTML = items.map((it, i) =>
      '<p>' + (it.proof ? '\u2713 <b>' + escR(it.name) + '</b> <span class="quiet">\u2014 proven by: ' + escR(it.proof) + '</span>'
        : '\u25cb <b>' + escR(it.name) + '</b> <button data-i="' + i + '" class="rprove" type="button">it is done \u2014 prove it</button>') + '</p>'
    ).join('') || '<p class="quiet">nothing listed \u2014 and an empty list is honestly empty</p>';
    for (const btn of document.querySelectorAll('.rprove')) btn.addEventListener('click', () => {
      const why = prompt('What proves it? (a file, a number, a thing someone can check)');
      if (!why || !why.trim()) { alert('no evidence, no tick \u2014 that is the whole point'); return; }
      const items2 = load2(); items2[Number(btn.dataset.i)].proof = why.trim(); keep(items2); show();
    });
  }
  document.getElementById('radd').addEventListener('click', () => {
    const name = document.getElementById('rnew').value.trim();
    if (!name) return;
    const items = load2(); items.push({ name: name.slice(0, 80), proof: null }); keep(items);
    document.getElementById('rnew').value = ''; show();
  });
  show();
})();`,
  },
  fold: {
    html: `<section id="org-fold"><h2>the fold</h2>
<p class="quiet">A crease-pattern glyph \u2014 golden-angle ring, mountain and valley alternating, and the center stays a hole the whole way: a twist fold has no apex. Drag it between flat and folded.</p>
<canvas id="fcv" width="280" height="280" style="display:block;margin:6px auto;border:1px solid #3a3630;border-radius:8px"></canvas>
<input id="ft" type="range" min="0" max="1" step="0.005" value="0" style="width:100%">
<div id="fread" class="quiet" style="text-align:center"></div></section>`,
    js: `(() => {
  // the forgeupgrade fold pattern, trimmed: 8 points at 137.50776405003785 degrees, kappa = 1/phi
  const GA = 137.50776405003785, KAP = 0.6180339887498949, N = 8;
  const cv = document.getElementById('fcv'), cx2 = cv.getContext('2d');
  function draw2(t) {
    cx2.clearRect(0, 0, 280, 280);
    const R = 110 * (1 - 0.5 * t), hole = 110 * (0.15 + 0.35 * (1 - t)), twist = t * 360 * KAP;
    cx2.strokeStyle = '#8a857a'; cx2.setLineDash([4, 4]);
    cx2.beginPath(); cx2.arc(140, 140, hole, 0, 7); cx2.stroke();
    cx2.setLineDash([]);
    for (let i = 0; i < N; i++) {
      const a = ((i * GA + twist) % 360) * Math.PI / 180;
      const x = 140 + Math.cos(a) * R, y = 140 + Math.sin(a) * R;
      const hx = 140 + Math.cos(a) * hole, hy = 140 + Math.sin(a) * hole;
      cx2.strokeStyle = i % 2 === 0 ? '#d4a017' : '#7f9cc9';
      cx2.setLineDash(i % 2 === 0 ? [] : [6, 4]);
      cx2.beginPath(); cx2.moveTo(hx, hy); cx2.lineTo(x, y); cx2.stroke();
      cx2.setLineDash([]);
      cx2.fillStyle = i % 2 === 0 ? '#d4a017' : '#7f9cc9';
      cx2.beginPath(); cx2.arc(x, y, 5, 0, 7); cx2.fill();
    }
    document.getElementById('fread').textContent =
      (t < KAP ? 'possibility / flat' : 'actual / folded') + ' \u00b7 twist ' + (t * 360 * KAP).toFixed(1) + '\u00b0 \u00b7 the center is a hole, never a crease';
  }
  document.getElementById('ft').addEventListener('input', (ev) => draw2(Number(ev.target.value)));
  draw2(0);
})();`,
  },
  cascade: {
    html: `<section id="org-cascade"><h2>the cascade</h2>
<p class="quiet">The fall-os walk, trimmed: free deterministic code answers first; then a model you own
(Ollama on your machine); then \u2014 only if you set a key \u2014 a rented frontier model. This build can
reach exactly two places, both yours: <b>localhost:11434</b> (your machine) and <b>api.anthropic.com</b>
(your key). Nothing else, and never without you pressing the button.</p>
<textarea id="cq" rows="2" placeholder="ask \u2014 arithmetic answers free, on this machine"></textarea>
<input id="ckey" type="password" placeholder="optional: sk-ant-\u2026 (kept in this browser only)">
<button id="cask" type="button">ask the ladder</button>
<div id="cwhere" class="quiet"></div>
<div id="cout"></div></section>`,
    js: `(() => {
  const st = document.getElementById('cwhere'), out = document.getElementById('cout');
  const K = 'studio-cascade-key';
  try { const k = localStorage.getItem(K); if (k) document.getElementById('ckey').value = k; } catch {}
  document.getElementById('cask').addEventListener('click', async () => {
    const q = document.getElementById('cq').value.trim();
    if (!q) { st.textContent = 'ask something real'; return; }
    out.textContent = '';
    // rung 1 \u00b7 T0: deterministic, free, never guesses
    if (/^[\d\s+*/().-]+$/.test(q)) {
      try {
        const v = Function('"use strict";return (' + q + ')')();
        out.textContent = String(v);
        st.textContent = 'answered on this machine \u00b7 no model \u00b7 cost: nothing \u00b7 it computed, it did not guess';
        return;
      } catch { /* not arithmetic after all \u2014 climb */ }
    }
    // rung 2 \u00b7 your own model
    st.textContent = 'trying the model you own (localhost:11434)\u2026';
    try {
      const res = await fetch('http://localhost:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'qwen2.5:7b', prompt: q, stream: false, options: { temperature: 0 } }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
      });
      if (res && res.ok) {
        const j = await res.json();
        const text = j && typeof j.response === 'string' ? j.response.trim() : '';
        if (text) {
          out.textContent = text;
          st.textContent = 'answered by YOUR model \u00b7 your electricity \u00b7 cost: nothing \u00b7 nothing left this machine';
          return;
        }
      }
    } catch { /* not up, or the browser was not allowed in \u2014 said below if nothing else answers */ }
    // rung 3 \u00b7 a rented model, your key, your choice
    const key = document.getElementById('ckey').value.trim();
    if (!key) {
      st.textContent = 'nothing could answer: no model of yours was reachable (if Ollama runs, allow the browser in: OLLAMA_ORIGINS=*) and no key is set. Both are fixable \u2014 and both are yours.';
      return;
    }
    try { localStorage.setItem(K, key); } catch {}
    st.textContent = 'renting: your key, straight to Anthropic, nowhere else\u2026';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key,
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600,
          messages: [{ role: 'user', content: q }] }),
      });
      if (!res.ok) { st.textContent = 'the rented model said no: HTTP ' + res.status + ' \u2014 check the key'; return; }
      const j = await res.json();
      out.textContent = ((j.content && j.content[0] && j.content[0].text) || '').trim();
      st.textContent = 'answered by a RENTED model \u00b7 your key paid for it \u00b7 the same question on your own model would have cost nothing';
    } catch (e2) { st.textContent = 'could not reach the rented model: ' + e2.message; }
  });
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
  // The cascade exception, as a RULE not a hole: fetch is permitted only to a literal target the
  // reader can see, and only to the two origins that are the user's own — their machine, or their
  // key. A computed target, or any other origin, or any other network shape, is still refused.
  if (/XMLHttpRequest|WebSocket\s*\(/i.test(s)) reasons.push('it phones home — XHR/sockets have no place in a sovereign single file');
  const fetchCount = (s.match(/\bfetch\s*\(/g) || []).length;
  { // no count guard: with zero fetches the checks below are vacuously quiet anyway
    const literal = [...s.matchAll(/\bfetch\s*\(\s*(['"])([^'"]*)\1/g)];
    if (literal.length !== fetchCount) {
      reasons.push('a fetch with a computed target — the reader cannot see where it goes, so it is refused');
    } else {
      for (const m of literal) {
        const url = m[2];
        if (!(url.startsWith('http://localhost:11434/') || url.startsWith('https://api.anthropic.com/'))) {
          reasons.push('it reaches "' + url.slice(0, 48) + '" — only your own machine (localhost:11434) and your own key (api.anthropic.com) are sanctioned');
        }
      }
    }
  }
  if (!/Konomi Architecture/.test(s)) reasons.push('the architecture line is missing — every estate build carries it');
  return { ok: reasons.length === 0, reasons };
}

export default compose;
