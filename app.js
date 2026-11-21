'use strict';

/* =========================================================
   יומן כושר — personal strength / running / food tracker.
   All data lives on the device (localStorage). No server, no login.
   ========================================================= */

const STORE_KEY = 'fitlog.data.v1';
const DRAFT_KEY = 'fitlog.draft.v1';

const CATEGORIES = [
  { id: 'legs', name: 'רגליים' },
  { id: 'upper', name: 'פלג גוף עליון' },
  { id: 'full', name: 'גוף מלא' },
  { id: 'core', name: 'ליבה' },
  { id: 'other', name: 'אחר' }
];
const MEALS = ['בוקר', 'צהריים', 'ערב', 'נשנוש'];
const PERIODS = [
  { id: 'week', name: 'השבוע' },
  { id: 'month', name: 'החודש' },
  { id: '30', name: '30 יום' },
  { id: '90', name: '3 חודשים' },
  { id: 'year', name: 'שנה' },
  { id: 'all', name: 'הכל' }
];
const TITLES = { home: 'יומן כושר', gym: 'אימוני כוח', run: 'ריצה', food: 'תזונה', stats: 'נתונים', settings: 'הגדרות' };

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);

// One drawn icon set, single stroke weight (inherits currentColor).
const svgI = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
  x: svgI('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  plus: svgI('M12 5v14M5 12h14'),
  chevR: svgI('M9 6l6 6-6 6'),
  chevL: svgI('M15 6l-6 6 6 6'),
  check: svgI('M4.5 12.5l4.5 4.5L19.5 7')
};

// Pen marks share the tally's stroke: an open, overshooting loop and a quick check.
const penCircle = () => '<svg class="pen-circle" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M80 6 C96 9 99 22 90 31 C79 40 24 41 9 32 C-1 25 4 10 23 5 C42 0 72 1 91 11"/></svg>';
const PEN_CHECK = '<svg class="pen-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 13.2 C5.6 14.2 7.6 16 9.2 19.4 C11.6 12.6 15.2 7.6 21 3.8"/></svg>';

// Signature move: counts drawn as ballpoint tally strikes, grouped in fives.
function tally(n, ink = '--blue') {
  n = Math.max(0, Math.round(n));
  if (!n) return '<span class="tally-empty"></span>';
  const shown = Math.min(n, 25);
  const groups = Math.ceil(shown / 5);
  const gw = 34, h = 24;
  let s = `<svg class="tally" viewBox="0 0 ${groups * gw} ${h}" width="${groups * gw}" height="${h}" style="--ink:var(${ink})" aria-label="${n}">`;
  for (let g = 0; g < groups; g++) {
    const inG = Math.min(5, shown - g * 5), x0 = groups * gw - g * gw - 6; // RTL: first group on the right
    for (let k = 0; k < Math.min(inG, 4); k++) {
      const x = x0 - k * 6.5, j = ((g * 5 + k) % 3) * 0.6;
      s += `<path d="M${x + j} ${3 + j} L${x - 1.2} ${h - 3}"/>`;
    }
    if (inG === 5) s += `<path d="M${x0 + 3} ${h - 6} L${x0 - 25} ${6}"/>`;
  }
  return s + '</svg>';
}

// Red ink is rationed: personal records only.
function isPR(w) {
  const earlier = db.workouts.filter((o) => o.id !== w.id && (o.date < w.date || (o.date === w.date && (o.createdAt || '') < (w.createdAt || ''))));
  let top = 0; // returns the heaviest new record in this workout, or 0
  w.exercises.forEach((e) => {
    const best = Math.max(0, ...e.sets.map((s) => num(s.w)));
    if (!best) return;
    const prev = earlier.flatMap((o) => o.exercises.filter((x) => norm(x.name) === norm(e.name)).flatMap((x) => x.sets.map((s) => num(s.w))));
    if (prev.length > 0 && best > Math.max(...prev)) top = Math.max(top, best);
  });
  return top;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const norm = (s) => String(s || '').trim().toLowerCase();

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const todayStr = () => toDateStr(new Date());
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }

function fmtNum(n, digits = 1) {
  return Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: digits });
}
function fmtDate(s) {
  if (s === todayStr()) return 'היום';
  if (s === addDays(todayStr(), -1)) return 'אתמול';
  const d = parseDate(s);
  return `${'אבגדהוש'[d.getDay()]}׳ ${d.getDate()}.${d.getMonth() + 1}`;
}
function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtPace(secPerKm) {
  if (!secPerKm || !Number.isFinite(secPerKm)) return '--';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
function daysAgo(s) {
  const diff = Math.round((parseDate(todayStr()) - parseDate(s)) / 86400000);
  if (diff <= 0) return 'היום';
  if (diff === 1) return 'אתמול';
  return `לפני ${diff} ימים`;
}
const catName = (id) => (CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1]).name;

function periodRange(id) {
  const now = new Date();
  let s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (id) {
    case 'week': s.setDate(s.getDate() - s.getDay()); break; // week starts on Sunday
    case 'month': s = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case '30': s.setDate(s.getDate() - 29); break;
    case '90': s.setDate(s.getDate() - 89); break;
    case 'year': s.setDate(s.getDate() - 364); break;
    default: return { start: '0000-00-00', end: '9999-12-31' };
  }
  return { start: toDateStr(s), end: '9999-12-31' };
}
const inRange = (date, r) => date >= r.start && date <= r.end;

let toastTimer;
function toast(msg, ok = false) {
  const t = $('#toast');
  t.innerHTML = (ok ? ICON.check : '') + esc(msg);
  t.classList.toggle('ok', ok);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

/* ---------------- storage ---------------- */
function defaultData() {
  const ex = (name, sets = 3) => ({ id: uid(), name, sets });
  return {
    templates: [
      { id: uid(), name: 'רגליים', category: 'legs', exercises: [ex('סקוואט', 4), ex('לחיצת רגליים'), ex('דדליפט רומני'), ex('פשיטת ברכיים'), ex('תאומים')] },
      { id: uid(), name: 'פלג גוף עליון', category: 'upper', exercises: [ex('לחיצת חזה', 4), ex('חתירה בכבל'), ex('לחיצת כתפיים'), ex('מתח'), ex('כפיפת מרפקים')] }
    ],
    workouts: [],
    runs: [],
    foods: [],
    myFoods: [],
    settings: { kcalGoal: 2400, proteinGoal: 150 }
  };
}
function normalize(d) {
  const base = defaultData();
  return {
    templates: Array.isArray(d?.templates) ? d.templates : base.templates,
    workouts: Array.isArray(d?.workouts) ? d.workouts : [],
    runs: Array.isArray(d?.runs) ? d.runs : [],
    foods: Array.isArray(d?.foods) ? d.foods : [],
    myFoods: Array.isArray(d?.myFoods) ? d.myFoods : [],
    settings: { ...base.settings, ...(d?.settings || {}) }
  };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
    const fresh = defaultData();
    localStorage.setItem(STORE_KEY, JSON.stringify(fresh)); // keep template ids stable from first launch
    return fresh;
  } catch { return defaultData(); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch { toast('שגיאה בשמירה — האחסון מלא?'); }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function saveDraft() {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

let db = load();
let draft = loadDraft();   // workout being logged right now
const ui = { tab: 'home', sub: null, tplDraft: null, editRunId: null, statsPeriod: '30', foodDate: todayStr(), exercise: null };

/* ---------------- domain helpers ---------------- */
const byDateDesc = (a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || ''));

function lastSetsFor(name, excludeId) {
  const key = norm(name);
  const sorted = [...db.workouts].sort(byDateDesc);
  for (const w of sorted) {
    if (w.id === excludeId) continue;
    const ex = w.exercises.find((e) => norm(e.name) === key);
    if (ex && ex.sets.length) return { sets: ex.sets, date: w.date };
  }
  return null;
}
function prevText(name, excludeId) {
  const last = name && lastSetsFor(name, excludeId);
  if (!last) return '';
  const sets = last.sets.map((s) => `<span class="num">${s.w ? `${fmtNum(s.w)}×${s.r}` : `${s.r}`}</span>`).join(' · ');
  return `פעם קודמת, ${fmtDate(last.date)}: ${sets}`;
}
function allExerciseNames() {
  const set = new Map();
  db.templates.forEach((t) => t.exercises.forEach((e) => e.name && set.set(norm(e.name), e.name.trim())));
  db.workouts.forEach((w) => w.exercises.forEach((e) => e.name && set.set(norm(e.name), e.name.trim())));
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'he'));
}
const exDatalist = () => `<datalist id="ex-names">${allExerciseNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
const catOptions = (sel) => CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.name}</option>`).join('');
const workoutVolume = (w) => sum(w.exercises, (e) => sum(e.sets, (s) => num(s.w) * num(s.r)));
const workoutSets = (w) => sum(w.exercises, (e) => e.sets.length);
const draftSetCount = () => draft ? sum(draft.exercises, (e) => e.sets.filter((s) => num(s.w) || num(s.r)).length) : 0;

/* ---------------- render: shared bits ---------------- */
function draftCard() {
  if (!draft) return '';
  const started = new Date(draft.startedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="card resume row" data-action="wo-resume" style="margin-top:14px;cursor:pointer">
      <div class="grow">
        <div class="bold">${draft.id ? 'עריכת אימון' : 'אימון פעיל'}: ${esc(draft.name || 'ללא שם')}</div>
        <div class="muted small">${draftSetCount()} סטים הוזנו · התחיל ב-${started}</div>
      </div>
      <span class="btn primary sm">המשך</span>
    </div>`;
}
function workoutItem(w) {
  return `
    <button class="list-item" data-action="wo-open" data-id="${w.id}">
      <span class="when">${fmtDate(w.date)}</span>
      <span class="grow">
        <span class="title ink-blue">${esc(w.name)}</span>
        <span class="meta">${norm(w.name) === norm(catName(w.category)) ? '' : esc(catName(w.category)) + ' · '}${w.exercises.length} תרגילים · ${workoutSets(w)} סטים</span>
      </span>
      ${(() => { const p = isPR(w); return p ? `<span class="pr">שיא <span class="num">${fmtNum(p)}</span>${penCircle()}</span>` : ''; })()}
    </button>`;
}
function runItem(r) {
  return `
    <button class="list-item" data-action="run-edit" data-id="${r.id}">
      <span class="when">${fmtDate(r.date)}</span>
      <span class="grow">
        <span class="title ink-green">ריצה <span class="num">${fmtNum(r.km, 2)}</span> ק״מ</span>
        <span class="meta"><span class="num">${fmtDuration(r.sec)}</span> · קצב <span class="num">${fmtPace(r.sec / r.km)}</span> לק״מ</span>
      </span>
    </button>`;
}

// A discipline summary as one notebook sheet: one lead figure in its ink, the rest as ruled rows.
function statSheet({ title, lead, unit, ink, rows, extra = '' }) {
  return `
    <section class="sheet stat">
      <div class="stat-lead"><h3>${title}</h3><div class="figure ${ink}"><span class="num">${lead}</span>${unit ? `<small>${unit}</small>` : ''}</div></div>
      ${rows.map(([label, value, u]) => `<div class="stat-row"><span>${label}</span><span class="val"><span class="num">${value}</span>${u ? ` <small>${u}</small>` : ''}</span></div>`).join('')}
      ${extra}
    </section>`;
}

/* ---------------- render: HOME ---------------- */
function renderHome() {
  const wk = periodRange('week');
  const wkWorkouts = db.workouts.filter((w) => inRange(w.date, wk));
  const wkRuns = db.runs.filter((r) => inRange(r.date, wk));
  const todayFoods = db.foods.filter((f) => f.date === todayStr());
  const todayKcal = sum(todayFoods, (f) => num(f.kcal)), todayProt = sum(todayFoods, (f) => num(f.protein));
  const km = sum(wkRuns, (r) => num(r.km));
  const maxKm = Math.max(1, ...wkRuns.map((r) => num(r.km)));
  const recent = [
    ...db.workouts.map((w) => ({ t: 'w', d: w })),
    ...db.runs.map((r) => ({ t: 'r', d: r }))
  ].sort((a, b) => byDateDesc(a.d, b.d)).slice(0, 6);

  return `
    <header class="page-head">
      <span class="date">${new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <h2 class="display">השבוע</h2>
    </header>
    ${draftCard()}

    <section class="sheet">
      <div class="sheet-head"><h3>אימוני כוח</h3><span class="figure sm ink-blue num">${wkWorkouts.length}</span></div>
      ${CATEGORIES.filter((c) => c.id !== 'other' || wkWorkouts.some((w) => w.category === 'other')).map((c) => {
        const n = wkWorkouts.filter((w) => w.category === c.id).length;
        return `<div class="tally-row ${n ? '' : 'zero'}"><span class="name">${c.name}</span><span class="count num">${n}</span>${tally(n)}</div>`;
      }).join('')}
    </section>

    <div class="duo">
      <section class="sheet tap" data-action="nav" data-tab="run">
        <h3>ריצה</h3>
        <div class="figure ink-green"><span class="num">${fmtNum(km)}</span><small>ק״מ</small></div>
        <div class="runbars">${wkRuns.length
          ? wkRuns.sort((a, b) => a.date.localeCompare(b.date)).map((r) => `<div class="rb"><i style="width:calc(${(num(r.km) / maxKm) * 100}% * .76)"></i><span class="num">${fmtNum(r.km)}</span></div>`).join('')
          : '<span class="meta">אין ריצות השבוע</span>'}</div>
      </section>
      <section class="sheet tap" data-action="nav" data-tab="food">
        <h3>אוכל היום</h3>
        <div class="figure ink-orange"><span class="num">${fmtNum(todayKcal, 0)}</span></div>
        <div class="meta">קלוריות מתוך <span class="num">${fmtNum(db.settings.kcalGoal, 0)}</span></div>
        <div class="meta" style="margin-top:0">חלבון <span class="num">${fmtNum(todayProt, 0)}</span> ג׳</div>
      </section>
    </div>

    <div class="adds">
      <button class="btn primary" data-action="nav" data-tab="gym">${ICON.plus}אימון</button>
      <button class="btn run" data-action="run-new">${ICON.plus}ריצה</button>
      <button class="btn food" data-action="nav" data-tab="food">${ICON.plus}ארוחה</button>
    </div>

    <div class="section-title"><h3>יומן</h3><button class="link-btn" data-action="nav" data-tab="stats">כל הנתונים${ICON.chevL}</button></div>
    ${recent.length
      ? `<div class="list">${recent.map((x) => (x.t === 'w' ? workoutItem(x.d) : runItem(x.d))).join('')}</div>`
      : `<div class="sheet empty">היומן ריק. בחר תבנית בלשונית "כוח" כדי לרשום אימון ראשון, או הוסף ריצה.</div>`}
  `;
}

/* ---------------- render: GYM ---------------- */
function renderGym() {
  if (ui.sub === 'tpl') return renderTplEditor();
  if (ui.sub === 'log' && draft) return renderLog();

  const tpls = db.templates.map((t) => {
    const last = [...db.workouts].filter((w) => w.templateId === t.id).sort(byDateDesc)[0];
    return `
      <div class="card">
        <div class="row between">
          <div class="bold" style="font-size:17px">${esc(t.name)}</div>
          <span class="pill">${esc(catName(t.category))}</span>
        </div>
        <div class="muted small" style="margin:6px 0 12px">${t.exercises.map((e) => esc(e.name)).join(' · ') || 'אין תרגילים'}</div>
        <div class="row between">
          <span class="muted tiny">${last ? 'בוצע ' + daysAgo(last.date) : 'טרם בוצע'}</span>
          <div class="row" style="gap:8px">
            <button class="btn ghost sm" data-action="tpl-edit" data-id="${t.id}">עריכה</button>
            <button class="btn primary sm" data-action="wo-start" data-id="${t.id}">התחל אימון</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const hist = [...db.workouts].sort(byDateDesc);
  return `
    ${draftCard()}
    <div class="section-title">תבניות אימון <button class="link-btn" data-action="tpl-new">${ICON.plus}תבנית חדשה</button></div>
    ${tpls || '<div class="card empty">אין תבניות עדיין — צור תבנית ראשונה.</div>'}
    <button class="btn ghost block" style="margin-top:10px" data-action="wo-free">${ICON.plus}אימון חופשי (בלי תבנית)</button>

    <div class="section-title">היסטוריית אימונים <span>${hist.length}</span></div>
    ${hist.length ? `<div class="list">${hist.map(workoutItem).join('')}</div>` : '<div class="card empty">עוד לא נשמרו אימונים.</div>'}
  `;
}

function renderTplEditor() {
  const d = ui.tplDraft;
  return `
    ${exDatalist()}
    <div class="section-title">${d.id ? 'עריכת תבנית' : 'תבנית חדשה'}</div>
    <div class="card stack">
      <label class="field"><span>שם האימון</span><input class="input" data-tpl="name" value="${esc(d.name)}" placeholder="לדוגמה: רגליים A"></label>
      <label class="field"><span>סוג אימון (משמש לסטטיסטיקה)</span><select class="input" data-tpl="category">${catOptions(d.category)}</select></label>
    </div>
    <div class="section-title"><span>תרגילים</span><span style="width:110px;text-align:center">סטים</span></div>
    <div class="card">
      ${d.exercises.map((e, i) => `
        <div class="tpl-ex">
          <input class="input" list="ex-names" data-tpl="exname" data-i="${i}" value="${esc(e.name)}" placeholder="שם התרגיל">
          <input class="input center num" inputmode="numeric" data-tpl="exsets" data-i="${i}" value="${esc(e.sets)}">
          <button class="x-btn" data-action="tpl-rm-ex" data-i="${i}" aria-label="הסר">${ICON.x}</button>
        </div>`).join('') || '<div class="empty">הוסף תרגיל ראשון</div>'}
      <button class="btn ghost block add-set" data-action="tpl-add-ex">${ICON.plus}הוסף תרגיל</button>
    </div>
    ${d.id ? `<button class="btn danger block" style="margin-top:16px" data-action="tpl-delete">מחק תבנית</button>` : ''}
    <div class="sticky-actions">
      <button class="btn primary" data-action="tpl-save">שמור תבנית</button>
      <button class="btn ghost" data-action="tpl-cancel">ביטול</button>
    </div>
  `;
}

function renderLog() {
  const d = draft;
  const exs = d.exercises.map((e, i) => `
    <div class="card ex-card">
      <div class="ex-head">
        <input class="input bold grow" list="ex-names" data-wo="exname" data-i="${i}" value="${esc(e.name)}" placeholder="שם התרגיל">
        <button class="x-btn" data-action="wo-rm-ex" data-i="${i}" aria-label="הסר תרגיל">${ICON.x}</button>
      </div>
      ${prevText(e.name, d.id) ? `<div class="prev">${prevText(e.name, d.id)}</div>` : ''}
      <div class="set-grid">
        <div class="h">#</div><div class="h">משקל (ק״ג)</div><div class="h">חזרות</div><div></div>
        ${e.sets.map((s, j) => `
          <button class="idx ${s.done ? 'done' : ''}" id="idx-${i}-${j}" data-action="wo-done" data-i="${i}" data-j="${j}" aria-label="סט ${j + 1} בוצע" aria-pressed="${s.done ? 'true' : 'false'}"><span>${j + 1}</span>${PEN_CHECK}</button>
          <input class="input num" type="text" inputmode="decimal" data-wo="w" data-i="${i}" data-j="${j}" value="${esc(s.w)}" placeholder="0">
          <input class="input num" type="text" inputmode="numeric" data-wo="r" data-i="${i}" data-j="${j}" value="${esc(s.r)}" placeholder="0">
          <button class="x-btn" data-action="wo-rm-set" data-i="${i}" data-j="${j}" aria-label="הסר סט">${ICON.x}</button>
        `).join('')}
      </div>
      <button class="btn ghost sm add-set" data-action="wo-add-set" data-i="${i}">${ICON.plus}סט</button>
    </div>`).join('');

  return `
    ${exDatalist()}
    <div class="card stack" style="margin-top:8px">
      <label class="field"><span>שם האימון</span><input class="input" data-wo="name" value="${esc(d.name)}" placeholder="אימון"></label>
      <div class="grid-2">
        <label class="field"><span>תאריך</span><input class="input" type="date" data-wo="date" value="${esc(d.date)}"></label>
        <label class="field"><span>סוג</span><select class="input" data-wo="category">${catOptions(d.category)}</select></label>
      </div>
    </div>
    <div class="section-title">תרגילים</div>
    <div class="stack">${exs || '<div class="card empty">הוסף תרגיל כדי להתחיל</div>'}</div>
    <button class="btn ghost block" style="margin-top:10px" data-action="wo-add-ex">${ICON.plus}הוסף תרגיל</button>
    <label class="field" style="margin-top:16px"><span>הערות</span><textarea class="input" data-wo="notes" placeholder="איך הרגשת?">${esc(d.notes)}</textarea></label>
    ${d.id ? `<button class="btn danger block" style="margin-top:16px" data-action="wo-delete">מחק אימון</button>` : ''}
    <div class="sticky-actions">
      <button class="btn primary" data-action="wo-save">${d.id ? 'שמור שינויים' : 'סיים ושמור'}</button>
      <button class="btn ghost" data-action="wo-discard">${d.id ? 'ביטול' : 'בטל אימון'}</button>
    </div>
  `;
}

/* ---------------- render: RUN ---------------- */
function renderRun() {
  const r = ui.editRunId ? db.runs.find((x) => x.id === ui.editRunId) : null;
  const sec = r ? r.sec : 0;
  const h = r ? Math.floor(sec / 3600) : '', m = r ? Math.floor((sec % 3600) / 60) : '', s = r ? sec % 60 : '';
  const mon = periodRange('month');
  const monRuns = db.runs.filter((x) => inRange(x.date, mon));
  const hist = [...db.runs].sort(byDateDesc);

  return `
    <div class="section-title">${r ? 'עריכת ריצה' : 'ריצה חדשה'}</div>
    <div class="card stack" id="run-form">
      <div class="grid-2">
        <label class="field"><span>תאריך</span><input class="input" type="date" id="run-date" value="${r ? r.date : todayStr()}"></label>
        <label class="field"><span>מרחק (ק״מ)</span><input class="input num center" type="text" inputmode="decimal" id="run-km" value="${r ? r.km : ''}" placeholder="5.0"></label>
      </div>
      <div>
        <div class="muted small bold" style="margin:0 2px 6px">זמן</div>
        <div class="grid-3">
          <label class="field"><span style="text-align:center">שעות</span><input class="input num center" inputmode="numeric" id="run-h" value="${h}" placeholder="0"></label>
          <label class="field"><span style="text-align:center">דקות</span><input class="input num center" inputmode="numeric" id="run-m" value="${m}" placeholder="00"></label>
          <label class="field"><span style="text-align:center">שניות</span><input class="input num center" inputmode="numeric" id="run-s" value="${s}" placeholder="00"></label>
        </div>
      </div>
      <div class="row between card" style="background:var(--surface-2);padding:10px 14px">
        <span class="muted">קצב ממוצע</span>
        <span class="bold" style="color:var(--run)"><span id="pace" class="num">--</span> לק״מ</span>
      </div>
      <label class="field"><span>הערות</span><input class="input" id="run-notes" value="${esc(r?.notes)}" placeholder="אינטרוולים, ריצה קלה..."></label>
      <button class="btn run block" data-action="run-save">${r ? 'שמור שינויים' : 'שמור ריצה'}</button>
      ${r ? `<div class="grid-2"><button class="btn ghost" data-action="run-cancel">ביטול</button><button class="btn danger" data-action="run-delete">מחק</button></div>` : ''}
    </div>

    ${statSheet({
      title: 'החודש', lead: fmtNum(sum(monRuns, (x) => num(x.km))), unit: 'ק״מ', ink: 'ink-green',
      rows: [['ריצות', monRuns.length], ['קצב ממוצע', fmtPace(sum(monRuns, (x) => x.sec) / sum(monRuns, (x) => num(x.km))), 'לק״מ']]
    })}

    <div class="section-title">היסטוריית ריצות <span>${hist.length}</span></div>
    ${hist.length ? `<div class="list">${hist.map(runItem).join('')}</div>` : '<div class="card empty">עוד לא נשמרו ריצות.</div>'}
  `;
}
function readRunTime() {
  return num($('#run-h')?.value) * 3600 + num($('#run-m')?.value) * 60 + num($('#run-s')?.value);
}
function updatePace() {
  const el = $('#pace'); if (!el) return;
  const km = num($('#run-km').value), sec = readRunTime();
  el.textContent = km > 0 && sec > 0 ? fmtPace(sec / km) : '--';
}

/* ---------------- render: FOOD ---------------- */
// Food logic (search DB, portions, barcode, my foods) lives in food.js.

/* ---------------- render: STATS ---------------- */
function barChart(values, labels, color, fmt = (v) => fmtNum(v)) {
  const W = 320, H = 150, pt = 18, pb = 22, px = 4;
  const n = values.length, max = Math.max(...values, 1), bw = (W - px * 2) / n;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="direction:ltr">`;
  s += `<line x1="${px}" x2="${W - px}" y1="${H - pb}" y2="${H - pb}" style="stroke:var(--border)"/>`;
  values.forEach((v, i) => {
    const bh = ((H - pt - pb) * v) / max;
    const x = px + i * bw + bw * 0.2, w = bw * 0.6, y = H - pb - bh;
    if (v > 0) {
      s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(bh, 2)}" rx="4" style="fill:var(${color})"/>`;
      s += `<text x="${x + w / 2}" y="${y - 5}" text-anchor="middle" style="fill:var(--text);font-weight:600">${fmt(v)}</text>`;
    }
    s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`;
  });
  return s + '</svg>';
}
function lineChart(points, color) {
  const W = 320, H = 160, pl = 34, pr = 10, pt = 14, pb = 22;
  if (points.length === 0) return '';
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 5; max += 5; }
  const padv = (max - min) * 0.12; min -= padv; max += padv;
  const X = (i) => (points.length === 1 ? (pl + W - pr) / 2 : pl + (i * (W - pl - pr)) / (points.length - 1));
  const Y = (v) => pt + ((max - v) * (H - pt - pb)) / (max - min);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="direction:ltr">`;
  [max - padv, (max + min) / 2, min + padv].forEach((v) => {
    s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--border);stroke-dasharray:3 4"/>`;
    s += `<text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${fmtNum(v)}</text>`;
  });
  s += `<polyline fill="none" points="${points.map((p, i) => `${X(i)},${Y(p.v)}`).join(' ')}" style="stroke:var(${color});stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>`;
  points.forEach((p, i) => { s += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="3.5" style="fill:var(--bg);stroke:var(${color});stroke-width:2"/>`; });
  s += `<text x="${X(0)}" y="${H - 6}" text-anchor="${points.length === 1 ? 'middle' : 'start'}">${points[0].label}</text>`;
  if (points.length > 1) s += `<text x="${X(points.length - 1)}" y="${H - 6}" text-anchor="end">${points[points.length - 1].label}</text>`;
  return s + '</svg>';
}
const shortDate = (s) => { const d = parseDate(s); return `${d.getDate()}/${d.getMonth() + 1}`; };

function renderStats() {
  const r = periodRange(ui.statsPeriod);
  const ws = db.workouts.filter((w) => inRange(w.date, r));
  const rs = db.runs.filter((x) => inRange(x.date, r));
  const fs = db.foods.filter((f) => inRange(f.date, r));

  const catCounts = CATEGORIES.map((c) => ({ c, n: ws.filter((w) => w.category === c.id).length }));
  const maxCat = Math.max(1, ...catCounts.map((x) => x.n));
  const km = sum(rs, (x) => num(x.km)), sec = sum(rs, (x) => x.sec);
  const longest = rs.reduce((a, x) => Math.max(a, num(x.km)), 0);
  const days = new Set(fs.map((f) => f.date)).size;
  const avgKcal = days ? sum(fs, (f) => num(f.kcal)) / days : 0;
  const avgProt = days ? sum(fs, (f) => num(f.protein)) / days : 0;

  // last 8 weeks (Sunday-based)
  const thisWeek = periodRange('week').start;
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (7 - i)));
  const wkEnd = (s) => addDays(s, 6);
  const wkKm = weeks.map((s) => sum(db.runs.filter((x) => x.date >= s && x.date <= wkEnd(s)), (x) => num(x.km)));
  const wkW = weeks.map((s) => db.workouts.filter((x) => x.date >= s && x.date <= wkEnd(s)).length);

  // exercise progress
  const names = allExerciseNames().filter((n) => db.workouts.some((w) => w.exercises.some((e) => norm(e.name) === norm(n))));
  if (!ui.exercise || !names.some((n) => norm(n) === norm(ui.exercise))) ui.exercise = names[0] || null;
  let exHtml = '<div class="card empty">אחרי שתשמור אימונים יופיע כאן גרף התקדמות לכל תרגיל.</div>';
  if (ui.exercise) {
    const pts = [...db.workouts].sort((a, b) => -byDateDesc(a, b))
      .map((w) => ({ w, e: w.exercises.find((e) => norm(e.name) === norm(ui.exercise)) }))
      .filter((x) => x.e && x.e.sets.length)
      .map((x) => ({ label: shortDate(x.w.date), v: Math.max(...x.e.sets.map((s) => num(s.w))), reps: Math.max(...x.e.sets.map((s) => num(s.r))) }));
    const useReps = pts.every((p) => p.v === 0);
    const series = pts.map((p) => ({ label: p.label, v: useReps ? p.reps : p.v })).slice(-20);
    const pr = Math.max(...series.map((p) => p.v));
    exHtml = `
      <div class="card stack">
        <select class="input" data-action-change="ex-select">${names.map((n) => `<option ${norm(n) === norm(ui.exercise) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <div class="stat-lead"><h3>שיא</h3><div class="figure ink-blue"><span class="num">${fmtNum(pr)}</span><small>${useReps ? 'חזרות' : 'ק״ג'}</small></div></div>
        <div class="stat-row"><span>אחרון</span><span class="val"><span class="num">${fmtNum(series[series.length - 1].v)}</span> <small>${useReps ? 'חזרות' : 'ק״ג'}</small></span></div>
        <div class="stat-row"><span>אימונים</span><span class="val"><span class="num">${pts.length}</span></span></div>
        ${lineChart(series, '--accent')}
        <div class="muted tiny">${useReps ? 'מספר חזרות מקסימלי באימון' : 'המשקל הכבד ביותר באימון'} · עד 20 אימונים אחרונים</div>
      </div>`;
  }

  return `
    <div class="chips" style="margin-top:8px">
      ${PERIODS.map((p) => `<button class="chip ${p.id === ui.statsPeriod ? 'active' : ''}" data-action="period" data-id="${p.id}">${p.name}${penCircle()}</button>`).join('')}
    </div>

    ${statSheet({
      title: 'אימוני כוח', lead: ws.length, unit: 'אימונים', ink: 'ink-blue',
      rows: [['סטים', sum(ws, workoutSets)], ['נפח כולל', fmtNum(sum(ws, workoutVolume) / 1000), 'טון']],
      extra: catCounts.map((x) => `<div class="tally-row ${x.n ? '' : 'zero'}"><span class="name">${x.c.name}</span><span class="count num">${x.n}</span>${tally(x.n)}</div>`).join('')
    })}

    ${statSheet({
      title: 'ריצה', lead: fmtNum(km), unit: 'ק״מ', ink: 'ink-green',
      rows: [
        ['ריצות', rs.length],
        ['קצב ממוצע', fmtPace(sec / km), 'לק״מ'],
        ['זמן ריצה', sec >= 3600 ? `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}` : Math.round(sec / 60), sec >= 3600 ? 'שעות' : 'דקות'],
        ['הריצה הארוכה', fmtNum(longest), 'ק״מ'],
        ['ממוצע לריצה', fmtNum(rs.length ? km / rs.length : 0), 'ק״מ']
      ]
    })}

    ${statSheet({
      title: 'תזונה', lead: fmtNum(avgKcal, 0), unit: 'קל׳ ביום', ink: 'ink-orange',
      rows: [['חלבון ביום', fmtNum(avgProt, 0), 'ג׳'], ['ימים שתועדו', days]]
    })}

    <div class="section-title">8 שבועות אחרונים</div>
    <div class="card">
      <div class="small bold">ק״מ ריצה בשבוע</div>
      ${barChart(wkKm, weeks.map(shortDate), '--run')}
    </div>
    <div class="card">
      <div class="small bold">אימוני כוח בשבוע</div>
      ${barChart(wkW, weeks.map(shortDate), '--accent', (v) => v)}
    </div>

    <div class="section-title">התקדמות בתרגיל</div>
    ${exHtml}
  `;
}

/* ---------------- render: SETTINGS ---------------- */
function renderSettings() {
  const s = db.settings;
  return `
    <div class="section-title">יעדים יומיים</div>
    <div class="card stack">
      <div class="grid-2">
        <label class="field"><span>קלוריות</span><input class="input num center" inputmode="numeric" id="goal-kcal" value="${s.kcalGoal}"></label>
        <label class="field"><span>חלבון (ג׳)</span><input class="input num center" inputmode="numeric" id="goal-protein" value="${s.proteinGoal}"></label>
      </div>
      <button class="btn primary block" data-action="goals-save">שמור יעדים</button>
    </div>

    ${renderMyFoodsSettings()}

    <div class="section-title">גיבוי</div>
    <div class="card stack">
      <div class="small muted">כל הנתונים נשמרים רק על המכשיר הזה. מומלץ לייצא גיבוי מדי פעם (למשל לשמור ב-iCloud Drive) — כך אפשר לשחזר אם מחקת את האפליקציה או החלפת טלפון.</div>
      <div class="small">
        <span class="num">${db.workouts.length}</span> אימוני כוח · <span class="num">${db.runs.length}</span> ריצות · <span class="num">${db.foods.length}</span> רשומות מזון · <span class="num">${db.templates.length}</span> תבניות
      </div>
      <div class="grid-2">
        <button class="btn" data-action="export">ייצוא גיבוי</button>
        <label class="btn" style="cursor:pointer">ייבוא גיבוי<input type="file" accept="application/json,.json" id="import-file" hidden></label>
      </div>
    </div>

    <div class="section-title">איפוס</div>
    <div class="card stack">
      <button class="btn danger block" data-action="reset">מחק את כל הנתונים</button>
    </div>
    <div class="muted tiny" style="text-align:center;margin-top:20px">יומן כושר · גרסה 1.0 · עובד גם ללא אינטרנט</div>
  `;
}

/* ---------------- main render ---------------- */
function render() {
  const view = $('#view');
  const renderers = { home: renderHome, gym: renderGym, run: renderRun, food: renderFood, stats: renderStats, settings: renderSettings };
  view.innerHTML = renderers[ui.tab]();
  $('#title').textContent = ui.tab === 'gym' && ui.sub === 'log' ? (draft?.id ? 'עריכת אימון' : 'אימון פעיל') : TITLES[ui.tab];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  if (ui.tab === 'run') updatePace();
}
function go(tab, sub = null) {
  ui.tab = tab; ui.sub = sub;
  render();
  window.scrollTo(0, 0);
}

/* ---------------- workout actions ---------------- */
function startWorkout(tpl) {
  if (draft && !confirm('יש אימון פעיל שלא נשמר. להחליף אותו באימון חדש?')) return;
  draft = {
    id: null,
    templateId: tpl?.id || null,
    name: tpl?.name || 'אימון חופשי',
    category: tpl?.category || 'other',
    date: todayStr(),
    startedAt: Date.now(),
    notes: '',
    exercises: tpl
      ? tpl.exercises.map((e) => {
          const last = lastSetsFor(e.name)?.sets || [];
          const n = Math.max(1, parseInt(e.sets, 10) || 3);
          return {
            name: e.name,
            sets: Array.from({ length: n }, (_, i) => {
              const p = last[i] || last[last.length - 1];
              return { w: p ? String(p.w || '') : '', r: p ? String(p.r || '') : '' };
            })
          };
        })
      : [{ name: '', sets: [{ w: '', r: '' }] }]
  };
  saveDraft();
  go('gym', 'log');
}
function openWorkout(id) {
  const w = db.workouts.find((x) => x.id === id);
  if (!w) return;
  if (draft && !confirm('יש אימון פעיל שלא נשמר. לפתוח במקומו את האימון הזה לעריכה?')) return;
  draft = {
    id: w.id, templateId: w.templateId, name: w.name, category: w.category, date: w.date,
    startedAt: Date.now(), notes: w.notes || '', durationMin: w.durationMin, createdAt: w.createdAt,
    exercises: w.exercises.map((e) => ({ name: e.name, sets: e.sets.map((s) => ({ w: String(s.w || ''), r: String(s.r || ''), done: true })) }))
  };
  saveDraft();
  go('gym', 'log');
}
function saveWorkout() {
  const exercises = draft.exercises
    .map((e) => ({ name: e.name.trim(), sets: e.sets.map((s) => ({ w: num(s.w), r: Math.round(num(s.r)) })).filter((s) => s.w > 0 || s.r > 0) }))
    .filter((e) => e.name && e.sets.length);
  if (!exercises.length) { toast('הזן לפחות תרגיל אחד עם סט'); return; }
  const rec = {
    id: draft.id || uid(),
    templateId: draft.templateId,
    name: draft.name.trim() || 'אימון',
    category: draft.category,
    date: draft.date || todayStr(),
    exercises,
    notes: draft.notes.trim(),
    durationMin: draft.id ? draft.durationMin : Math.round((Date.now() - draft.startedAt) / 60000),
    createdAt: draft.createdAt || new Date().toISOString()
  };
  const i = db.workouts.findIndex((w) => w.id === rec.id);
  if (i >= 0) db.workouts[i] = rec; else db.workouts.push(rec);
  save();
  const wasEdit = !!draft.id;
  draft = null; saveDraft();
  toast(wasEdit ? 'האימון עודכן' : 'האימון נשמר', true);
  go('gym');
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action, id = el.dataset.id, i = +el.dataset.i, j = +el.dataset.j;

  switch (a) {
    case 'nav':
      if (el.dataset.tab === 'gym' && ui.tab === 'gym' && ui.sub === 'log') { go('gym'); break; }
      if (el.dataset.tab === 'run') ui.editRunId = null;
      go(el.dataset.tab);
      break;

    // templates
    case 'tpl-new':
      ui.tplDraft = { id: null, name: '', category: 'legs', exercises: [{ name: '', sets: 3 }] };
      go('gym', 'tpl'); break;
    case 'tpl-edit': {
      const t = db.templates.find((x) => x.id === id);
      ui.tplDraft = JSON.parse(JSON.stringify(t));
      go('gym', 'tpl'); break;
    }
    case 'tpl-add-ex':
      ui.tplDraft.exercises.push({ name: '', sets: 3 }); render();
      document.querySelectorAll('[data-tpl="exname"]')[ui.tplDraft.exercises.length - 1]?.focus();
      break;
    case 'tpl-rm-ex': ui.tplDraft.exercises.splice(i, 1); render(); break;
    case 'tpl-cancel': go('gym'); break;
    case 'tpl-save': {
      const d = ui.tplDraft;
      d.name = d.name.trim();
      d.exercises = d.exercises.map((x) => ({ id: x.id || uid(), name: x.name.trim(), sets: Math.max(1, parseInt(x.sets, 10) || 3) })).filter((x) => x.name);
      if (!d.name) { toast('תן שם לתבנית'); return; }
      if (!d.exercises.length) { toast('הוסף לפחות תרגיל אחד'); return; }
      if (d.id) db.templates[db.templates.findIndex((x) => x.id === d.id)] = d;
      else { d.id = uid(); db.templates.push(d); }
      save(); toast('התבנית נשמרה', true); go('gym'); break;
    }
    case 'tpl-delete':
      if (!confirm('למחוק את התבנית? אימונים שכבר נשמרו לא יימחקו.')) return;
      db.templates = db.templates.filter((x) => x.id !== ui.tplDraft.id);
      save(); toast('התבנית נמחקה', true); go('gym'); break;

    // workouts
    case 'wo-start': startWorkout(db.templates.find((x) => x.id === id)); break;
    case 'wo-free': startWorkout(null); break;
    case 'wo-resume': go('gym', 'log'); break;
    case 'wo-open': openWorkout(id); break;
    case 'wo-add-set': {
      const sets = draft.exercises[i].sets, last = sets[sets.length - 1];
      sets.push({ w: last ? last.w : '', r: last ? last.r : '' });
      saveDraft(); render(); break;
    }
    case 'wo-done': {
      const set = draft.exercises[i].sets[j];
      set.done = !set.done; saveDraft();
      el.classList.toggle('done', set.done); el.setAttribute('aria-pressed', String(set.done));
      break;
    }
    case 'wo-rm-set': draft.exercises[i].sets.splice(j, 1); saveDraft(); render(); break;
    case 'wo-add-ex':
      draft.exercises.push({ name: '', sets: [{ w: '', r: '' }] }); saveDraft(); render();
      document.querySelectorAll('[data-wo="exname"]')[draft.exercises.length - 1]?.focus();
      break;
    case 'wo-rm-ex':
      if (!confirm(`להסיר את "${draft.exercises[i].name || 'התרגיל'}" מהאימון?`)) return;
      draft.exercises.splice(i, 1); saveDraft(); render(); break;
    case 'wo-save': saveWorkout(); break;
    case 'wo-discard':
      if (!draft.id && draftSetCount() > 0 && !confirm('לבטל את האימון? הנתונים שהזנת לא יישמרו.')) return;
      draft = null; saveDraft(); go('gym'); break;
    case 'wo-delete':
      if (!confirm('למחוק את האימון לצמיתות?')) return;
      db.workouts = db.workouts.filter((w) => w.id !== draft.id);
      draft = null; saveDraft(); save(); toast('האימון נמחק', true); go('gym'); break;

    // runs
    case 'run-new': ui.editRunId = null; go('run'); setTimeout(() => $('#run-km')?.focus(), 50); break;
    case 'run-edit': ui.editRunId = id; go('run'); break;
    case 'run-cancel': ui.editRunId = null; render(); break;
    case 'run-save': {
      const km = num($('#run-km').value), sec = Math.round(readRunTime());
      if (km <= 0) { toast('הזן מרחק'); return; }
      if (sec <= 0) { toast('הזן זמן'); return; }
      const rec = { id: ui.editRunId || uid(), date: $('#run-date').value || todayStr(), km, sec, notes: $('#run-notes').value.trim() };
      const idx = db.runs.findIndex((x) => x.id === rec.id);
      if (idx >= 0) { rec.createdAt = db.runs[idx].createdAt; db.runs[idx] = rec; }
      else { rec.createdAt = new Date().toISOString(); db.runs.push(rec); }
      save(); toast(ui.editRunId ? 'הריצה עודכנה' : 'הריצה נשמרה', true);
      ui.editRunId = null; render(); window.scrollTo(0, 0); break;
    }
    case 'run-delete':
      if (!confirm('למחוק את הריצה?')) return;
      db.runs = db.runs.filter((x) => x.id !== ui.editRunId);
      ui.editRunId = null; save(); toast('הריצה נמחקה', true); render(); break;

    // food actions are handled in food.js (handleFoodAction)
    default:
      if (a.startsWith('food-') || a.startsWith('scan-') || a.startsWith('my-')) handleFoodAction(a, el);
      break;

    // stats
    case 'period': ui.statsPeriod = id; render(); break;

    // settings
    case 'goals-save':
      db.settings.kcalGoal = num($('#goal-kcal').value) || db.settings.kcalGoal;
      db.settings.proteinGoal = num($('#goal-protein').value) || db.settings.proteinGoal;
      save(); toast('היעדים נשמרו', true); break;
    case 'export': exportData(); break;
    case 'reset':
      if (!confirm('למחוק את כל הנתונים? פעולה זו אינה הפיכה. מומלץ לייצא גיבוי קודם.')) return;
      if (!confirm('בטוח? כל האימונים, הריצות והתזונה יימחקו.')) return;
      db = defaultData(); draft = null; saveDraft(); save(); toast('הנתונים נמחקו', true); go('home'); break;
  }
});

function onFieldInput(e) {
  const t = e.target;
  if (handleFoodInput(e)) return;
  if (t.dataset.tpl && ui.tplDraft) {
    const d = ui.tplDraft, i = +t.dataset.i;
    if (t.dataset.tpl === 'name') d.name = t.value;
    else if (t.dataset.tpl === 'category') d.category = t.value;
    else if (t.dataset.tpl === 'exname') d.exercises[i].name = t.value;
    else if (t.dataset.tpl === 'exsets') d.exercises[i].sets = t.value;
  } else if (t.dataset.wo && draft) {
    const k = t.dataset.wo, i = +t.dataset.i, j = +t.dataset.j;
    if (k === 'w' || k === 'r') {
      const set = draft.exercises[i].sets[j];
      set[k] = t.value;
      set.done = !!(num(set.w) || num(set.r));
      const b = $(`#idx-${i}-${j}`);
      if (b) { b.classList.toggle('done', set.done); b.setAttribute('aria-pressed', String(set.done)); }
    }
    else if (k === 'exname') draft.exercises[i].name = t.value;
    else draft[k] = t.value;
    saveDraft();
    if (k === 'exname' && e.type === 'change') render(); // refresh "last time" hint
  } else if (t.dataset.actionChange === 'ex-select') {
    ui.exercise = t.value; render();
  } else if (t.closest('#run-form')) {
    updatePace();
  }
}
document.addEventListener('input', onFieldInput);
document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file') return importData(e.target.files[0]);
  if (e.target.dataset.actionChange) return; // already handled by input
  onFieldInput(e);
});

/* ---------------- backup ---------------- */
async function exportData() {
  const name = `fitlog-backup-${todayStr()}.json`;
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'גיבוי יומן כושר' });
      return;
    }
  } catch (err) { if (err?.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.workouts)) throw new Error('bad');
      if (!confirm('הייבוא יחליף את כל הנתונים הנוכחיים בנתוני הגיבוי. להמשיך?')) return;
      db = normalize(parsed); save(); toast('הגיבוי שוחזר', true); go('home');
    } catch { toast('הקובץ אינו גיבוי תקין'); }
  };
  reader.readAsText(file);
}

/* ---------------- boot ---------------- */
// first render happens in food.js once it has loaded (it defines renderFood)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
navigator.storage?.persist?.().catch(() => {});
