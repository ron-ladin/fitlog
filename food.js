'use strict';

/* =========================================================
   Food: search the Israeli national nutrition DB (bundled, offline),
   choose a portion, barcode lookup via Open Food Facts, and "my foods".
   Loaded after app.js and uses its helpers ($, db, ui, save, render...).
   ========================================================= */

let FOODDB = null, FOODKEYS = null, foodDbPromise = null;
const normHe = (s) => String(s || '').toLowerCase().replace(/["'׳״`]/g, '').replace(/[,()\-/]/g, ' ').replace(/\s+/g, ' ').trim();
const r1 = (v) => Math.round(num(v) * 10) / 10;

function loadFoodDb() {
  if (!foodDbPromise) {
    foodDbPromise = fetch('foods-il.json')
      .then((r) => { if (!r.ok) throw new Error('load'); return r.json(); })
      .then((d) => { FOODDB = d; FOODKEYS = d.foods.map((f) => normHe(f[0])); return d; })
      .catch((err) => { foodDbPromise = null; throw err; });
  }
  return foodDbPromise;
}
const ilFood = (a) => ({ name: a[0], kcal: a[1], p: a[2], c: a[3], f: a[4], units: (a[5] || []).map(([i, g]) => [FOODDB.units[i], g]), src: 'il' });

// transient UI state for the food tab
const fs = { q: '', results: [], recent: [], sel: null, mode: null, unit: -1, amt: '100', meal: null, customBarcode: '', customName: '' };

function defaultMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'בוקר' : h < 16 ? 'צהריים' : h < 21 ? 'ערב' : 'נשנוש';
}

/* ---------------- search ---------------- */
function searchFoods(q) {
  const nq = normHe(q);
  if (nq.length < 2) return [];
  const toks = nq.split(' ');
  const match = (k) => toks.every((t) => k.includes(t));
  const mine = db.myFoods.filter((f) => match(normHe(f.name))).map((f) => ({ ...f, src: 'my' }));
  const hits = [];
  if (FOODDB) {
    FOODKEYS.forEach((k, i) => {
      if (!match(k)) return;
      const rank = k === nq ? 0 : k.startsWith(nq) ? 1 : k.startsWith(toks[0]) ? 2 : (' ' + k).includes(' ' + toks[0]) ? 3 : 4;
      hits.push([rank * 1000 + k.length, i]);
    });
    hits.sort((a, b) => a[0] - b[0]);
  }
  return [...mine, ...hits.slice(0, 40).map((h) => ilFood(FOODDB.foods[h[1]]))];
}

function frequentFoods() {
  const map = new Map();
  [...db.foods].sort(byDateDesc).forEach((f) => {
    const k = norm(f.name);
    if (!k) return;
    const cur = map.get(k);
    if (cur) cur.count++;
    else map.set(k, { entry: f, count: 1 });
  });
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 14).map((x) => x.entry);
}

/* ---------------- portion math ---------------- */
function portionGrams() {
  const f = fs.sel;
  const g = fs.unit < 0 ? 1 : (f.units[fs.unit] || [0, 0])[1];
  return num(fs.amt) * g;
}
function portionValues() {
  const k = portionGrams() / 100, f = fs.sel;
  return { kcal: num(f.kcal) * k, p: num(f.p) * k, c: num(f.c) * k, f: num(f.f) * k };
}

/* ---------------- render ---------------- */
function renderFood() {
  const day = ui.foodDate;
  const items = db.foods.filter((f) => f.date === day);
  const tot = (k) => sum(items, (f) => num(f[k]));
  const kcal = tot('kcal'), prot = tot('protein');
  const { kcalGoal, proteinGoal } = db.settings;
  const pct = (v, g) => (g ? Math.min(100, (v / g) * 100) : 0);
  if (!fs.meal) fs.meal = defaultMeal();

  loadFoodDb().then(() => { if (fs.q && !fs.mode) { fs.results = searchFoods(fs.q); updateFoodUi(); } }).catch(() => {});

  const groups = MEALS.map((m) => {
    const list = items.filter((f) => (f.meal || 'נשנוש') === m);
    if (!list.length) return '';
    return `
      <div class="section-title"><span>${m}</span><span class="num">${fmtNum(sum(list, (f) => num(f.kcal)), 0)} קל׳</span></div>
      <div class="list">${list.map((f) => `
        <div class="list-item" style="cursor:default">
          <div class="grow">
            <div class="bold">${esc(f.name)}</div>
            ${f.amount ? `<div class="muted tiny">${esc(f.amount)}</div>` : ''}
            <div class="muted small"><span class="num">${fmtNum(f.kcal, 0)}</span> קל׳ · חלבון <span class="num">${fmtNum(f.protein)}</span> · פחמ׳ <span class="num">${fmtNum(f.carbs)}</span> · שומן <span class="num">${fmtNum(f.fat)}</span></div>
          </div>
          <button class="x-btn" data-action="food-del" data-id="${f.id}" aria-label="מחק">${ICON.x}</button>
        </div>`).join('')}
      </div>`;
  }).join('');

  return `
    <div class="date-nav" style="margin-top:8px">
      <button class="btn sm ghost" data-action="food-day" data-n="-1">${ICON.chevR}יום קודם</button>
      <div class="label">${fmtDate(day)}</div>
      <button class="btn sm ghost" data-action="food-day" data-n="1" ${day >= todayStr() ? 'disabled style="opacity:.35"' : ''}>יום הבא${ICON.chevL}</button>
    </div>

    <div class="card stack" style="margin-top:12px">
      <div>
        <div class="row between small"><span class="bold">קלוריות</span><span class="num muted">${fmtNum(kcal, 0)} / ${fmtNum(kcalGoal, 0)}</span></div>
        <div class="bar-track" style="margin-top:6px"><div class="bar-fill food" style="width:${pct(kcal, kcalGoal)}%"></div></div>
      </div>
      <div>
        <div class="row between small"><span class="bold">חלבון${proteinGoal && prot >= proteinGoal ? ` <span class="pr">יעד${penCircle()}</span>` : ''}</span><span class="num muted">${fmtNum(prot)} / ${fmtNum(proteinGoal, 0)} ג׳</span></div>
        <div class="bar-track" style="margin-top:6px"><div class="bar-fill protein" style="width:${pct(prot, proteinGoal)}%"></div></div>
      </div>
      <div class="row small muted" style="gap:16px">
        <span>פחמימות <b class="num" style="color:var(--text)">${fmtNum(tot('carbs'), 0)}</b> ג׳</span>
        <span>שומן <b class="num" style="color:var(--text)">${fmtNum(tot('fat'), 0)}</b> ג׳</span>
      </div>
    </div>

    <div class="section-title">הוספת מזון</div>
    <div class="card stack">
      <div class="seg">${MEALS.map((m) => `<button class="${m === fs.meal ? 'active' : ''}" data-action="food-meal" data-m="${m}">${m}${penCircle()}</button>`).join('')}</div>
      <div class="search-row">
        <input class="input" id="food-q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(fs.q)}" placeholder="חפש: חזה עוף, אורז, קוטג׳...">
        <button class="icon-btn scan-btn" data-action="scan-open" aria-label="סריקת ברקוד">
          <svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10.5 8v8M14 8v8M17 8v8"/></svg>
        </button>
      </div>
      <div id="food-panel">${renderFoodPanel()}</div>
      <div id="food-results">${renderResults()}</div>
      <div class="row between">
        <button class="link-btn" data-action="food-manual">הזנה ידנית</button>
        <button class="link-btn" data-action="food-custom">${ICON.plus}מזון חדש משלי</button>
      </div>
    </div>

    ${groups || '<div class="card empty" style="margin-top:12px">לא הוזן מזון ביום הזה.</div>'}
  `;
}

function renderResults() {
  if (fs.mode) return '';
  if (!fs.q.trim()) {
    fs.recent = frequentFoods();
    return fs.recent.length
      ? `<div class="muted tiny" style="margin:0 2px 6px">אכלת לאחרונה</div>
         <div class="chips">${fs.recent.map((q, i) => `<button class="chip food-chip" data-action="food-recent" data-i="${i}">${esc(q.name)}</button>`).join('')}</div>`
      : `<div class="muted tiny" style="margin:0 2px">חיפוש במאגר התזונה של משרד הבריאות (כ-4,600 מזונות), או סריקת ברקוד של מוצר ארוז.</div>`;
  }
  if (!FOODDB) return '<div class="empty">טוען מאגר מזון...</div>';
  if (normHe(fs.q).length < 2) return '';
  if (!fs.results.length) {
    return `<div class="empty">לא נמצא "${esc(fs.q)}". נסה מילה אחרת, סרוק ברקוד, או <button class="link-btn" data-action="food-custom">צור מזון חדש</button></div>`;
  }
  return `<div class="list results">${fs.results.map((f, i) => `
    <div class="list-item" data-action="food-pick" data-i="${i}">
      <div class="grow">
        <div class="small bold">${f.src === 'my' ? '<span class="pill food">שלי</span> ' : ''}${esc(f.name)}</div>
        <div class="muted tiny"><span class="num">${fmtNum(f.kcal, 0)}</span> קל׳ · חלבון <span class="num">${fmtNum(f.p)}</span> ג׳ · ל-100 ג׳</div>
      </div>
    </div>`).join('')}</div>`;
}

function renderFoodPanel() {
  if (fs.mode === 'portion') return portionPanel();
  if (fs.mode === 'manual') return manualPanel();
  if (fs.mode === 'custom') return customPanel();
  return '';
}

function macroBoxes() {
  const v = portionValues();
  return `
    <div class="macro"><div class="v num" style="color:var(--food)">${fmtNum(v.kcal, 0)}</div><div class="l">קלוריות</div></div>
    <div class="macro"><div class="v num" style="color:var(--accent)">${fmtNum(v.p)}</div><div class="l">חלבון</div></div>
    <div class="macro"><div class="v num">${fmtNum(v.c)}</div><div class="l">פחמ׳</div></div>
    <div class="macro"><div class="v num">${fmtNum(v.f)}</div><div class="l">שומן</div></div>`;
}

function portionPanel() {
  const f = fs.sel;
  const opts = (f.fixed ? [] : [`<option value="-1" ${fs.unit < 0 ? 'selected' : ''}>גרם</option>`])
    .concat((f.units || []).map(([n, g, hide], i) => `<option value="${i}" ${i === fs.unit ? 'selected' : ''}>${esc(n)}${hide ? '' : ` (${fmtNum(g)} ג׳)`}</option>`));
  return `
    <div class="panel stack">
      <div class="row"><div class="grow bold">${esc(f.name)}</div><button class="x-btn" data-action="food-close" aria-label="סגור">${ICON.x}</button></div>
      ${f.fixed ? '' : `<div class="muted tiny">ל-100 ג׳: <span class="num">${fmtNum(f.kcal, 0)}</span> קל׳ · חלבון <span class="num">${fmtNum(f.p)}</span> · פחמ׳ <span class="num">${fmtNum(f.c)}</span> · שומן <span class="num">${fmtNum(f.f)}</span></div>`}
      <div class="grid-2">
        <label class="field"><span>כמות</span><input class="input num center" id="fp-amt" type="text" inputmode="decimal" value="${esc(fs.amt)}"></label>
        <label class="field"><span>יחידה</span><select class="input" id="fp-unit">${opts.join('')}</select></label>
      </div>
      <div class="macros" id="fp-calc">${macroBoxes()}</div>
      ${f.fixed ? '' : `<div class="muted tiny" id="fp-grams" style="text-align:center">סה״כ <span class="num">${fmtNum(portionGrams(), 0)}</span> גרם</div>`}
      <button class="btn food block" data-action="food-add-portion">הוסף ל${esc(fs.meal)}</button>
    </div>`;
}

function manualPanel() {
  return `
    <div class="panel stack">
      <div class="row"><div class="grow bold">הזנה ידנית</div><button class="x-btn" data-action="food-close" aria-label="סגור">${ICON.x}</button></div>
      <label class="field"><span>מה אכלת</span><input class="input" id="mf-name" placeholder="למשל: ארוחה במסעדה"></label>
      <div class="grid-2">
        <label class="field"><span>קלוריות</span><input class="input num center" inputmode="decimal" id="mf-kcal" placeholder="0"></label>
        <label class="field"><span>חלבון (ג׳)</span><input class="input num center" inputmode="decimal" id="mf-p" placeholder="0"></label>
        <label class="field"><span>פחמימות (ג׳)</span><input class="input num center" inputmode="decimal" id="mf-c" placeholder="0"></label>
        <label class="field"><span>שומן (ג׳)</span><input class="input num center" inputmode="decimal" id="mf-f" placeholder="0"></label>
      </div>
      <button class="btn food block" data-action="food-add-manual">הוסף ל${esc(fs.meal)}</button>
    </div>`;
}

function customPanel() {
  return `
    <div class="panel stack">
      <div class="row"><div class="grow bold">מזון חדש משלי</div><button class="x-btn" data-action="food-close" aria-label="סגור">${ICON.x}</button></div>
      <div class="muted tiny">הזן את הערכים מהתווית <b>ל-100 גרם</b>. המזון יישמר ותוכל למצוא אותו בחיפוש${fs.customBarcode ? ' ובסריקה' : ''}.</div>
      <label class="field"><span>שם</span><input class="input" id="cf-name" value="${esc(fs.customName)}" placeholder="למשל: חטיף חלבון שוקולד"></label>
      <div class="grid-2">
        <label class="field"><span>קלוריות</span><input class="input num center" inputmode="decimal" id="cf-kcal" placeholder="0"></label>
        <label class="field"><span>חלבון (ג׳)</span><input class="input num center" inputmode="decimal" id="cf-p" placeholder="0"></label>
        <label class="field"><span>פחמימות (ג׳)</span><input class="input num center" inputmode="decimal" id="cf-c" placeholder="0"></label>
        <label class="field"><span>שומן (ג׳)</span><input class="input num center" inputmode="decimal" id="cf-f" placeholder="0"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>יחידה (לא חובה)</span><input class="input" id="cf-unit" placeholder="יחידה / פרוסה"></label>
        <label class="field"><span>משקל יחידה (ג׳)</span><input class="input num center" inputmode="decimal" id="cf-unit-g" placeholder="60"></label>
      </div>
      <label class="field"><span>ברקוד (לא חובה)</span><input class="input num" inputmode="numeric" id="cf-barcode" value="${esc(fs.customBarcode)}"></label>
      <button class="btn food block" data-action="food-save-custom">שמור והמשך</button>
    </div>`;
}

function updateFoodUi() {
  const panel = $('#food-panel'), res = $('#food-results');
  if (panel) panel.innerHTML = renderFoodPanel();
  if (res) res.innerHTML = renderResults();
}

function pickFood(f, unit, amt) {
  fs.sel = f;
  fs.mode = 'portion';
  if (unit !== undefined && amt !== undefined && (unit < 0 ? !f.fixed : f.units?.[unit])) { fs.unit = unit; fs.amt = String(amt); }
  else if (f.units?.length) { fs.unit = 0; fs.amt = '1'; }
  else { fs.unit = -1; fs.amt = '100'; }
  updateFoodUi();
  $('#food-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function openCustom(barcode = '', name = '') {
  fs.mode = 'custom'; fs.customBarcode = barcode; fs.customName = name;
  updateFoodUi();
  $('#food-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function resetFoodForm() {
  fs.q = ''; fs.results = []; fs.mode = null; fs.sel = null;
}
function pushFoodEntry(entry) {
  db.foods.push({ id: uid(), date: ui.foodDate, meal: fs.meal, createdAt: new Date().toISOString(), ...entry });
  save();
  toast('נוסף', true);
  resetFoodForm();
  render();
}

/* ---------------- my foods (settings) ---------------- */
function renderMyFoodsSettings() {
  return `
    <div class="section-title">המזונות שלי <span>${db.myFoods.length}</span></div>
    ${db.myFoods.length
      ? `<div class="list">${db.myFoods.map((f) => `
          <div class="list-item" style="cursor:default">
            <div class="grow">
              <div class="bold small">${esc(f.name)}</div>
              <div class="muted tiny"><span class="num">${fmtNum(f.kcal, 0)}</span> קל׳ · חלבון <span class="num">${fmtNum(f.p)}</span> ג׳ ל-100 ג׳${f.barcode ? ` · <span class="num">${esc(f.barcode)}</span>` : ''}</div>
            </div>
            <button class="x-btn" data-action="my-del" data-id="${f.id}" aria-label="מחק">${ICON.x}</button>
          </div>`).join('')}</div>`
      : '<div class="card empty">מוצרים שתסרוק או תיצור יישמרו כאן.</div>'}`;
}

/* ---------------- barcode ---------------- */
let scanner = null, scanBusy = false;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function setScanStatus(html) { const el = $('#scan-status'); if (el) el.innerHTML = html; }

async function openScanner() {
  if ($('#scan-overlay')) return;
  const ov = document.createElement('div');
  ov.className = 'scan-overlay';
  ov.id = 'scan-overlay';
  ov.innerHTML = `
    <div class="row between">
      <div class="bold" style="font-size:18px">סריקת ברקוד</div>
      <button class="btn sm" data-action="scan-close">סגור</button>
    </div>
    <div id="scan-reader"></div>
    <div id="scan-status" class="muted small" style="text-align:center">מפעיל מצלמה...</div>
    <div class="search-row">
      <input class="input num" id="scan-code" inputmode="numeric" placeholder="או הקלד את מספר הברקוד">
      <button class="btn food" data-action="scan-manual">חפש</button>
    </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  try {
    if (!window.__Html5QrcodeLibrary__) await loadScript('vendor/html5-qrcode.min.js');
    const lib = window.__Html5QrcodeLibrary__;
    const F = lib.Html5QrcodeSupportedFormats;
    scanner = new lib.Html5Qrcode('scan-reader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => ({ width: Math.floor(Math.min(320, w * 0.85)), height: Math.floor(Math.min(170, h * 0.5)) }) },
      (code) => onBarcode(code),
      () => {}
    );
    setScanStatus('כוון את הברקוד למסגרת');
  } catch {
    scanner = null;
    setScanStatus('לא ניתן לפתוח את המצלמה (צריך לאשר גישה למצלמה). אפשר להקליד את מספר הברקוד למטה.');
  }
}
async function stopScanner() {
  const s = scanner; scanner = null;
  if (!s) return;
  try { await s.stop(); } catch { /* not running */ }
  try { s.clear(); } catch { /* ignore */ }
}
async function closeScanner() {
  await stopScanner();
  $('#scan-overlay')?.remove();
  document.body.style.overflow = '';
}

async function onBarcode(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  if (scanBusy || code.length < 6) return;
  scanBusy = true;
  await stopScanner();
  setScanStatus(`נסרק <span class="num">${code}</span> — מחפש...`);
  try {
    const r = await lookupBarcode(code);
    await closeScanner();
    if (ui.tab !== 'food') go('food');
    if (r.food) { pickFood(r.food); toast('נמצא', true); }
    else { openCustom(code, r.name || ''); toast('המוצר לא במאגר — הזן ערכים מהתווית'); }
  } catch {
    setScanStatus(`אין חיבור לאינטרנט. <button class="link-btn" data-action="scan-custom" data-code="${code}">הזן ערכים ידנית</button>`);
  } finally {
    scanBusy = false;
  }
}

async function lookupBarcode(code) {
  const mine = db.myFoods.find((f) => f.barcode === code);
  if (mine) return { food: { ...mine, src: 'my' } };
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_he,generic_name,brands,nutriments,serving_quantity`;
  const res = await fetch(url);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error('network');
  const j = await res.json();
  const p = j.product, n = p?.nutriments || {};
  if (j.status !== 1 || !p) return {};
  const name = [p.product_name_he || p.product_name || p.generic_name, (p.brands || '').split(',')[0].trim()].filter(Boolean).join(' · ');
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  if (kcal == null) return { name };
  const food = {
    id: uid(), name: name || `מוצר ${code}`, barcode: code,
    kcal: r1(kcal), p: r1(n.proteins_100g), c: r1(n.carbohydrates_100g), f: r1(n.fat_100g),
    units: num(p.serving_quantity) > 0 ? [['מנה', r1(p.serving_quantity)]] : []
  };
  db.myFoods.push(food); // remember it so next time works offline
  save();
  return { food: { ...food, src: 'my' } };
}

/* ---------------- events (called from app.js) ---------------- */
function handleFoodAction(a, el) {
  switch (a) {
    case 'food-day': ui.foodDate = addDays(ui.foodDate, +el.dataset.n); render(); break;
    case 'food-meal':
      fs.meal = el.dataset.m;
      document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.m === fs.meal));
      document.querySelectorAll('[data-action^="food-add"]').forEach((b) => { b.textContent = 'הוסף ל' + fs.meal; });
      break;
    case 'food-pick': pickFood(fs.results[+el.dataset.i]); break;
    case 'food-recent': {
      const e = fs.recent[+el.dataset.i];
      if (e.ref) pickFood(e.ref, e.unitIdx, e.amt);
      else pickFood({ name: e.name, kcal: e.kcal, p: e.protein, c: e.carbs, f: e.fat, units: [['מנה כמו בפעם הקודמת', 100, true]], fixed: true });
      break;
    }
    case 'food-close': fs.mode = null; updateFoodUi(); break;
    case 'food-manual': fs.mode = 'manual'; updateFoodUi(); $('#mf-name')?.focus(); break;
    case 'food-custom': openCustom('', fs.q.trim()); break;
    case 'food-add-portion': {
      const f = fs.sel, grams = portionGrams();
      if (grams <= 0) { toast('הזן כמות'); return; }
      const v = portionValues(), a2 = fmtNum(num(fs.amt));
      const amount = fs.unit < 0 ? `${a2} גרם` : `${a2} × ${f.units[fs.unit][0]}${f.fixed ? '' : ` (${fmtNum(grams, 0)} ג׳)`}`;
      pushFoodEntry({
        name: f.name, amount,
        kcal: Math.round(v.kcal), protein: r1(v.p), carbs: r1(v.c), fat: r1(v.f),
        ref: f.fixed ? undefined : { name: f.name, kcal: f.kcal, p: f.p, c: f.c, f: f.f, units: f.units || [] },
        unitIdx: fs.unit, amt: num(fs.amt)
      });
      break;
    }
    case 'food-add-manual': {
      const name = $('#mf-name').value.trim(), kcal = num($('#mf-kcal').value);
      if (!name && !kcal) { toast('הזן מה אכלת'); return; }
      pushFoodEntry({ name: name || 'ללא שם', kcal: Math.round(kcal), protein: r1($('#mf-p').value), carbs: r1($('#mf-c').value), fat: r1($('#mf-f').value) });
      break;
    }
    case 'food-save-custom': {
      const name = $('#cf-name').value.trim();
      if (!name) { toast('תן שם למזון'); return; }
      const ug = num($('#cf-unit-g').value), un = $('#cf-unit').value.trim() || 'יחידה';
      const barcode = $('#cf-barcode').value.replace(/\D/g, '');
      const food = {
        id: uid(), name, barcode: barcode || undefined,
        kcal: r1($('#cf-kcal').value), p: r1($('#cf-p').value), c: r1($('#cf-c').value), f: r1($('#cf-f').value),
        units: ug > 0 ? [[un, ug]] : []
      };
      if (barcode) db.myFoods = db.myFoods.filter((x) => x.barcode !== barcode);
      db.myFoods.push(food);
      save();
      toast('נשמר במזונות שלי', true);
      pickFood({ ...food, src: 'my' });
      break;
    }
    case 'food-del':
      db.foods = db.foods.filter((f) => f.id !== el.dataset.id); save(); render(); break;
    case 'my-del':
      if (!confirm('למחוק את המזון מהרשימה? רשומות שכבר הוזנו לא יימחקו.')) return;
      db.myFoods = db.myFoods.filter((f) => f.id !== el.dataset.id); save(); render(); break;
    case 'scan-open': openScanner(); break;
    case 'scan-close': closeScanner(); break;
    case 'scan-manual': onBarcode($('#scan-code').value); break;
    case 'scan-custom': closeScanner().then(() => openCustom(el.dataset.code)); break;
  }
}

function handleFoodInput(e) {
  const t = e.target;
  if (t.id === 'food-q') {
    if (e.type !== 'input') return true;
    fs.q = t.value;
    fs.mode = null;
    fs.results = searchFoods(fs.q);
    updateFoodUi();
    if (!FOODDB) loadFoodDb().then(() => { fs.results = searchFoods(fs.q); updateFoodUi(); }).catch(() => toast('שגיאה בטעינת מאגר המזון'));
    return true;
  }
  if (t.id === 'fp-amt' || t.id === 'fp-unit') {
    if (t.id === 'fp-unit') {
      const nu = +t.value;
      if (nu !== fs.unit) {
        if (nu < 0) fs.amt = '100';
        else if (fs.unit < 0) fs.amt = '1';
        fs.unit = nu;
        $('#fp-amt').value = fs.amt;
      }
    } else fs.amt = t.value;
    $('#fp-calc').innerHTML = macroBoxes();
    const g = $('#fp-grams');
    if (g) g.innerHTML = `סה״כ <span class="num">${fmtNum(portionGrams(), 0)}</span> גרם`;
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'scan-code') onBarcode(e.target.value);
  if (e.key === 'Enter' && e.target.id === 'food-q') e.target.blur();
});

// first paint (app.js defers it until this file is loaded)
render();
