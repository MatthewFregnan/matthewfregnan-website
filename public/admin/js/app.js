// Portfolio Manager (web). Same layout and behaviour as the desktop app in /app:
// project list on the left, two-column editor on the right, edits kept as a draft
// in this browser until you press Publish (one commit to GitHub, live in 1–2 minutes).

import * as V from './video.js';
import * as I from './images.js';
import * as U from './upload.js';
import * as P from './preview.js';
import * as T from './traffic.js';
import { ConflictError, DEFAULT_HOME, DemoBackend, GitHubBackend } from './github.js';
import { mergeJsonText } from './merge.js';

const SITE = 'https://matthewfregnan.com';
const DRAFT_KEY = 'pm-draft';
const params = new URLSearchParams(location.search);

const S = {
  backend: null,
  data: null,          // { categories, projects } being edited
  baseText: '',        // projects.json as last published
  home: null,          // { active, sets: [{ id, name, tagline, projects: ['category/id'] }] }
  baseHomeText: '',    // home.json as last published
  baseSha: '',         // commit it came from
  current: null,       // selected project (object identity)
  undo: [],
  redo: [],
  mergeKey: null,      // typing in the same field merges into one undo step
  showBackups: false,
  showGallery: false,
  uploads: [],         // video uploads running in the background
  site: {},            // data/site.json (name, tagline, hero picture) for the previews
  page: 'overview',    // overview | projects | home | storage
  editorTab: 'details',// details | preview
  screen: 'desktop',   // preview screen size
  previewLayout: null, // project page layout to preview (null = the live set's)
  storage: null,       // last storage report { data, at }
  traffic: {},         // stats by number of days { data, at }
  trafficDays: 30,
};

const PAGES = ['overview', 'projects', 'home', 'sections', 'traffic', 'storage'];

/** Switch the main area to one of the pages in the left menu. */
function go(page, { push = true } = {}) {
  if (!PAGES.includes(page)) page = 'overview';
  const changedPage = S.page !== page;
  S.page = page;
  for (const id of PAGES) $(`#page-${id}`).hidden = id !== page;
  document.querySelectorAll('#rail [data-page]').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  document.querySelector('.app').dataset.page = page;
  if (push && location.hash !== `#${page}`) history.replaceState(null, '', `${location.pathname}${location.search}#${page}`);
  if (page === 'overview') renderOverview();
  if (page === 'home') renderHomeDialog();
  if (page === 'storage' && changedPage) renderStoragePage();
  if (page === 'traffic' && changedPage) renderTrafficPage();
  if (page === 'sections') renderSectionsPage();
  if (page === 'projects' && changedPage) { renderList({ scroll: true }); renderEditor(); }
  renderToolbar();
}

const liveSet = () => homeSet(S.home.active) || S.home.sets[0];
const liveLayout = () => liveSet()?.projectLayout || 'standard';
// Where client logos sit on the tiles (per home page set; build.js reads "logoPosition")
const LOGO_POSITIONS = [['corner', 'Top corner'], ['title-right', 'Beside the title, right'], ['title-right-faint', 'Beside the title, right, faint'],
  ['title-left', 'Beside the title, left'], ['none', 'Hidden']];
const thumbSrc = p => (p?.thumbnail ? I.src('thumbnails', p.thumbnail, p.updated) : '');

// =========================================================================== helpers

const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny element builder: h('div', {class: 'x', onclick: fn}, 'text', child) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

const projects = () => S.data.projects;
const category = id => S.data.categories.find(c => c.id === id) || { id, name: id, slug: id };
const pagePath = p => `/${category(p.category).slug}/${p.id}/`;
const slugify = t => String(t).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
const touch = p => { p.updated = new Date().toISOString().slice(0, 19); };

function uniqueId(base, cat, ignore) {
  const taken = new Set(projects().filter(p => p.category === cat && p !== ignore).map(p => p.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function suggestions(key) {
  const counts = new Map();
  for (const p of projects()) {
    const v = String(p[key] || '').trim();
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function dialog(build) {
  const d = $('#dialog');
  d.replaceChildren(...build(() => d.close()).flat().filter(x => x != null && x !== false && x !== ''));
  d.showModal();
  return d;
}

function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const d = dialog(close => [
      h('h3', {}, title),
      h('p', {}, text),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        h('button', { class: `btn primary${danger ? ' danger' : ''}`, onclick: () => { close(); resolve(true); } }, okLabel)),
    ]);
    d.addEventListener('cancel', () => resolve(false), { once: true });
  });
}

// =========================================================================== editing model

function snapshot() {
  return { text: JSON.stringify(S.data), home: JSON.stringify(S.home), cur: S.current ? projects().indexOf(S.current) : -1 };
}

function restore(snap) {
  S.data = JSON.parse(snap.text);
  S.home = JSON.parse(snap.home);
  if ($('#dialog').open && $('#dialog')._home) renderHomeDialog();
  S.current = projects()[snap.cur] || null;
  S.mergeKey = null;
  changed({ list: true, editor: true });
}

/** Every change goes through here so it can be undone and is kept as a draft. */
function mutate(fn, { mergeKey = null, list = false, editor = false } = {}) {
  if (!mergeKey || mergeKey !== S.mergeKey) {
    S.undo.push(snapshot());
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
  }
  S.mergeKey = mergeKey;
  fn();
  if (S.current) touch(S.current);
  changed({ list, editor });
}

function undo() {
  if (!S.undo.length) return;
  S.redo.push(snapshot());
  restore(S.undo.pop());
}

function redo() {
  if (!S.redo.length) return;
  S.undo.push(snapshot());
  restore(S.redo.pop());
}

let draftTimer;
function changed({ list = false, editor = false } = {}) {
  I.prunePending(usedImagePaths());
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 300);
  renderToolbar();
  if (list) renderList();
  else if (S.current) updateRow(S.current);
  if (editor) renderEditor();
  if (S.page === 'overview') renderOverview();
  if (S.page === 'projects' && S.editorTab === 'preview') renderProjectPreview();
}

// ---------------------------------------------------------------- client logos (optional)
// One logo per client (S.data.clients["Client name"].logo = "name.webp" in images/logos), shown small
// on that client's thumbnails on the site.

const clientKey = name => String(name || '').trim().toLowerCase();
function clientEntry(name) {
  const k = clientKey(name);
  if (!k) return null;
  return Object.entries(S.data.clients || {}).find(([n]) => clientKey(n) === k) || null;
}
const logoOf = p => clientEntry(p?.client)?.[1]?.logo || '';

function clientLogoRow(p) {
  if (!String(p.client || '').trim()) return h('span', { class: 'muted small' }, 'Add a client first.');
  const logo = logoOf(p);
  const others = projects().filter(x => x !== p && clientKey(x.client) === clientKey(p.client)).length;
  const setLogo = async () => {
    const [file] = await pickFiles(false);
    if (!file) return;
    try {
      const { blob, ext } = await I.convert(file, 480);
      const name = `${slugify(p.client)}.${ext}`;
      I.addPending(I.repoPath('logos', name), blob);
      mutate(() => {
        S.data.clients ||= {};
        const existing = clientEntry(p.client);
        const key = existing ? existing[0] : p.client.trim();
        S.data.clients[key] = { ...(S.data.clients[key] || {}), logo: name };
      });
      $('#client-logo')?.replaceChildren(clientLogoRow(p));
    } catch (e) { toast(e.message); }
  };
  const remove = () => {
    mutate(() => {
      const existing = clientEntry(p.client);
      if (existing) delete S.data.clients[existing[0]];
      if (S.data.clients && !Object.keys(S.data.clients).length) delete S.data.clients;
    });
    $('#client-logo')?.replaceChildren(clientLogoRow(p));
  };
  return h('div', { class: 'logo-row' },
    logo ? h('span', { class: 'logo-chip' }, I.withFallback(h('img', { src: I.src('logos', logo), alt: '' }), 'logos', logo)) : null,
    h('button', { class: 'btn', onclick: setLogo }, logo ? 'Change…' : 'Add Logo…'),
    logo ? h('button', { class: 'btn link danger', onclick: remove }, 'Remove') : null,
    h('span', { class: 'muted small' }, logo
      ? `Shown small on ${p.client}’s thumbnails${others ? ` (${others + 1} projects)` : ''}.`
      : 'Optional: shown small on this client’s thumbnails. A PNG with a transparent background works best.'));
}

function usedImagePaths() {
  const used = new Set();
  for (const c of Object.values(S.data?.clients || {})) if (c.logo) used.add(I.repoPath('logos', c.logo));
  for (const p of projects()) {
    if (p.thumbnail) used.add(I.repoPath('thumbnails', p.thumbnail));
    for (const g of p.gallery || []) used.add(I.repoPath('gallery', g));
  }
  return used;
}

function saveDraft() {
  try {
    const text = JSON.stringify(S.data);
    const homeText = JSON.stringify(S.home);
    if (text === JSON.stringify(JSON.parse(S.baseText)) && homeText === JSON.stringify(JSON.parse(S.baseHomeText))) {
      localStorage.removeItem(DRAFT_KEY);
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, homeText, baseText: S.baseText,
        baseHomeText: S.baseHomeText, baseSha: S.baseSha, demo: S.backend.demo }));
    }
  } catch { /* storage unavailable: draft just isn't kept across reloads */ }
}

/** Plain-English list of what isn't live yet. */
function changes() {
  const base = JSON.parse(S.baseText).projects;
  const key = p => `${p.category}/${p.id}`;
  const strip = p => JSON.stringify({ ...p, updated: undefined });
  const oldBy = new Map(base.map(p => [key(p), p]));
  const newBy = new Map(projects().map(p => [key(p), p]));
  const out = [];
  for (const [k, p] of newBy) if (!oldBy.has(k)) out.push(`Added “${p.title}”`);
  for (const [k, p] of oldBy) if (!newBy.has(k)) out.push(`Removed “${p.title}”`);
  for (const [k, p] of newBy) if (oldBy.has(k) && strip(p) !== strip(oldBy.get(k))) out.push(`Changed “${p.title}”`);
  const common = a => a.map(key).filter(k => oldBy.has(k) && newBy.has(k)).join('|');
  if (common(base) !== common(projects())) out.push('Reordered projects');
  if (JSON.stringify(S.data.categories) !== JSON.stringify(JSON.parse(S.baseText).categories)) out.push('Changed categories');
  if (JSON.stringify(S.home) !== JSON.stringify(JSON.parse(S.baseHomeText))) out.push('Changed home page');
  if (!out.length && I.pending.size) out.push('Updated images');
  return out;
}

// =========================================================================== home page sets

const keyOf = p => `${p.category}/${p.id}`;
const homeSet = id => S.home.sets.find(s => s.id === id);

/** Keep home page sets pointing at a project after its address/category changes (or it's deleted). */
function renameRefs(oldKey, newKey) {
  // Remember the old page address so the site redirects it (links already sent out keep working)
  const moved = newKey && projects().find(x => keyOf(x) === newKey);
  if (moved) {
    const keep = (moved.formerAddresses || []).filter(k => k !== newKey && k !== oldKey);
    if (oldKey !== newKey) keep.push(oldKey);
    if (keep.length) moved.formerAddresses = keep; else delete moved.formerAddresses;
  }
  for (const s of S.home.sets) {
    s.projects = (s.projects || []).flatMap(k => (k === oldKey ? (newKey ? [newKey] : []) : [k]));
    for (const list of ['locked', 'soft']) if (s[list]) s[list] = s[list].flatMap(k => (k === oldKey ? (newKey ? [newKey] : []) : [k]));
  }
}

// =========================================================================== project actions

function select(p, { scroll = true } = {}) {
  if (S.page !== 'projects') go('projects');
  S.current = p;
  S.showBackups = false;
  S.showGallery = false;
  S.mergeKey = null;
  document.querySelector('.app').classList.toggle('show-editor', !!p);
  renderList({ scroll });
  renderEditor();
  renderToolbar();
  if (p) V.ordered(p).forEach(ref => V.check(ref));
}

function addProject(p, after = null) {
  mutate(() => {
    const list = projects();
    const at = after ? list.indexOf(after) + 1 : Math.max(0, list.findIndex(x => x.category === p.category));
    list.splice(at === -1 ? list.length : at, 0, p);
    S.current = p;
  }, { list: true, editor: true });
  clearSearchFor(p);
  select(p);
}

function blankProject(cat) {
  const p = { id: uniqueId('new-project', cat), title: 'New Project', category: cat, client: '', role: 'Editor',
    production: '', year: '', description: '', thumbnail: '' };
  touch(p);
  return p;
}

function newBlank() {
  const p = blankProject(currentCategory());
  addProject(p);
  const t = $('#f-title');
  t?.focus();
  t?.select();
}

function duplicate() {
  const p = S.current;
  if (!p) return;
  const q = JSON.parse(JSON.stringify(p));
  q.title = `${p.title} (copy)`;
  q.id = uniqueId(`${p.id}-copy`, p.category);
  addProject(q, p);
}

function remove() {
  const p = S.current;
  if (!p) return;
  const list = projects();
  const i = list.indexOf(p);
  mutate(() => {
    list.splice(i, 1);
    renameRefs(keyOf(p), null);
    S.current = null;
  }, { list: true, editor: true });
  document.querySelector('.app').classList.remove('show-editor');
  toast(`Deleted “${p.title}”. Press Undo to bring it back.`, 6000);
}

/** Move a project to `row` within its category. */
function move(p, row) {
  const rest = projects().filter(x => x !== p);
  const same = rest.map((x, i) => [x, i]).filter(([x]) => x.category === p.category).map(([, i]) => i);
  row = Math.max(0, Math.min(row, same.length));
  const at = row < same.length ? same[row] : (same.length ? same[same.length - 1] + 1 : rest.length);
  rest.splice(at, 0, p);
  if (rest.every((x, i) => x === projects()[i])) return;
  mutate(() => { S.data.projects = rest; }, { list: true });
}

const currentCategory = () => S.current?.category || $('#filter').value || S.data.categories[0].id;

function clearSearchFor(p) {
  const search = $('#search');
  const filter = $('#filter');
  if (search.value) search.value = '';
  if (filter.value && filter.value !== p.category) filter.value = '';
}

// =========================================================================== toolbar

function renderToolbar() {
  const has = !!S.current;
  $('#duplicate').disabled = !has;
  $('#delete').disabled = !has;
  $('#view').disabled = !has;
  $('#undo').disabled = !S.undo.length;
  $('#redo').disabled = !S.redo.length;
  const n = S.data ? changes().length : 0;
  const pub = $('#publish');
  pub.textContent = n ? `Publish (${n})` : 'Publish';
  pub.disabled = !n;
  pub.title = n ? changes().join('\n') : 'Everything is live';
}

// =========================================================================== list

let dragged = null;

function renderList({ scroll = false } = {}) {
  const q = $('#search').value.trim().toLowerCase();
  const only = $('#filter').value;
  const list = $('#list');
  const frag = [];
  for (const c of S.data.categories) {
    if (only && c.id !== only) continue;
    const rows = projects().filter(p => p.category === c.id).filter(p => !q
      || ['title', 'client', 'production', 'role'].some(k => String(p[k] || '').toLowerCase().includes(q)));
    frag.push(h('h3', {}, `${c.name} (${rows.length})`));
    rows.forEach((p, i) => frag.push(row(p, i, !q)));
  }
  list.replaceChildren(...frag);
  if (scroll) list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
}

function row(p, index, draggable) {
  const state = V.state(p);
  const img = p.thumbnail
    ? I.withFallback(h('img', { src: thumbSrc(p), alt: '', loading: 'lazy' }), 'thumbnails', p.thumbnail)
    : h('span', { class: 'noimg' });
  const el = h('button', {
    class: `row${p === S.current ? ' selected' : ''}${p.hidden ? ' is-hidden' : ''}`,
    draggable,
    onclick: () => select(p, { scroll: false }),
    title: `${p.client || ''}  ·  ${pagePath(p)}`,
  },
  h('span', { class: `dot ${state || 'none'}` }),
  img,
  h('span', { class: 'row-text' },
    h('span', { class: 'row-title' }, p.title || '(untitled)'),
    h('span', { class: 'row-sub' }, p.hidden ? h('span', { class: 'tag-hidden' }, 'Hidden') : null, [p.client, p.year].filter(Boolean).join(' · ') || ' ')));
  el._project = p;

  if (draggable) {
    el.addEventListener('dragstart', e => {
      dragged = p;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { dragged = null; el.classList.remove('dragging'); });
    el.addEventListener('dragover', e => {
      if (!dragged || dragged.category !== p.category || dragged === p) return;
      e.preventDefault();
      const below = e.offsetY > el.offsetHeight / 2;
      el.classList.toggle('drop-below', below);
      el.classList.toggle('drop-above', !below);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      const below = el.classList.contains('drop-below');
      el.classList.remove('drop-above', 'drop-below');
      if (!dragged || dragged.category !== p.category) return;
      const from = projects().filter(x => x.category === p.category).indexOf(dragged);
      let to = index + (below ? 1 : 0);
      if (to > from) to -= 1;
      move(dragged, to);
    });
  }
  return el;
}

function updateRow(p) {
  const el = [...document.querySelectorAll('.row')].find(r => r._project === p);
  if (!el) return;
  el.querySelector('.row-title').textContent = p.title || '(untitled)';
  el.querySelector('.row-sub').textContent = [p.client, p.year].filter(Boolean).join(' · ') || ' ';
  el.querySelector('.dot').className = `dot ${V.state(p) || 'none'}`;
}

// =========================================================================== editor

function renderEditor() {
  const ed = $('#editor');
  const p = S.current;
  if (!p) {
    ed.replaceChildren(h('div', { class: 'empty' },
      h('div', {}, h('p', {}, 'Select a project, or add one.'),
        h('div', { class: 'vrow-tools', style: 'justify-content:center' },
          h('button', { class: 'btn primary', onclick: newFromLink }, 'New from Link'),
          h('button', { class: 'btn', onclick: () => newFromFile() }, 'New from Video File')),
        h('p', { class: 'muted small' }, 'Tip: drop a video file on the project list.'))));
    return;
  }
  const scrollTop = ed.scrollTop;
  const tab = (id, label) => h('button', { class: `tab${S.editorTab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(S.editorTab === id),
    onclick: () => { S.editorTab = id; renderEditor(); } }, label);
  const head = h('div', { class: 'editor-head' },
    h('h2', { id: 'heading' }, p.title || '(untitled)'),
    h('div', { class: 'tabs', role: 'tablist' }, tab('details', 'Details'), tab('preview', 'Page Preview')),
    p.hidden ? h('div', { class: 'hidden-note' }, h('span', { class: 'tag-hidden' }, 'Hidden'),
      ` Not on the site${p.hiddenSince ? ` since ${p.hiddenSince}` : ''}. Its entry and video are kept.`,
      h('button', { class: 'btn', onclick: () => setHidden(p, false) }, 'Show on Site')) : null);
  if (S.editorTab === 'preview') {
    ed.replaceChildren(h('div', { class: 'editor-inner' }, head, h('div', { id: 'project-preview' })));
    renderProjectPreview();
    ed._for = p;
    return;
  }
  const f = detailsForm(p);
  const portrait = p.category === 'vertical';
  const group = (title, hint, ...body) => h('section', { class: 'pe-group' },
    h('div', { class: 'pe-group-head' }, h('h4', {}, title), hint ? h('span', { class: 'muted small' }, hint) : null), ...body);
  const info = group('Project info', liveLayout() === 'detailed'
    ? 'Shown with the video (Detailed layout)' : 'Client, production, role and year show with the video; the rest needs the Detailed layout', f.info);
  const video = h('section', { class: 'card', id: 'video-card' });
  const stills = h('section', { class: 'card', id: 'gallery-card' });
  // Laid out like the real page: Social projects have the video on the left and the details beside it
  const page = portrait
    ? h('div', { class: 'pe-page portrait' },
      h('div', { class: 'pe-media' }, video),
      h('div', { class: 'pe-side' }, f.header, info, stills))
    : h('div', { class: 'pe-page' }, f.header, video, info, stills);
  ed.replaceChildren(h('div', { class: 'editor-inner' },
    head,
    page,
    group('Around the site', 'How it’s listed: the thumbnail on tiles, its section and address, and home page sets',
      h('div', { class: 'pe-site' }, h('section', { class: 'card', id: 'thumb-card' }), f.site))));
  renderVideo();
  renderThumb();
  renderGallery();
  if (ed._for === p) ed.scrollTop = scrollTop;
  ed._for = p;
}

function textField(p, key, opts = {}) {
  const tag = opts.multiline ? 'textarea' : 'input';
  const el = h(tag, {
    id: `f-${key}`,
    value: p[key] || '',
    placeholder: opts.placeholder || '',
    class: opts.class || '',
    ...(opts.list ? { list: `dl-${key}` } : {}),
    ...(opts.inputmode ? { inputMode: opts.inputmode, maxLength: 4 } : {}),
    oninput: e => {
      const v = opts.digits ? e.target.value.replace(/\D/g, '') : e.target.value;
      if (v !== e.target.value) e.target.value = v;
      mutate(() => { p[key] = v; }, { mergeKey: `${projects().indexOf(p)}:${key}` });
      if (key === 'title') $('#heading').textContent = v || '(untitled)';
    },
    onchange: e => {
      const v = e.target.value.trim();
      if (v !== p[key]) mutate(() => { p[key] = v; }, { mergeKey: `${projects().indexOf(p)}:${key}` });
      e.target.value = v;
      S.mergeKey = null;
      if (key === 'client') $('#client-logo')?.replaceChildren(clientLogoRow(p));
    },
  });
  if (tag === 'textarea') el.value = p[key] || '';
  return el;
}

function detailsForm(p) {
  const lists = ['client', 'role', 'production', 'agency', 'platform'].map(k => h('datalist', { id: `dl-${k}` },
    suggestions(k).map(v => h('option', { value: v }))));
  const cat = h('select', {
    id: 'f-category',
    onchange: e => mutate(() => {
      p.category = e.target.value;
      const oldKey = keyOf(p);
      p.id = uniqueId(p.id, p.category, p);
      renameRefs(oldKey, keyOf(p));
    }, { list: true, editor: true }),
  }, S.data.categories.map(c => h('option', { value: c.id, selected: c.id === p.category }, c.name)));

  function setAddress(raw) {
    const id = uniqueId(slugify(raw), p.category, p);
    input.value = id;
    if (id === p.id) return false;
    mutate(() => {
      const oldKey = keyOf(p);
      p.id = id;
      renameRefs(oldKey, keyOf(p));
    });
    $('#url').textContent = `matthewfregnan.com${pagePath(p)}`;
    toast('Page address changed. The old address will redirect here once you publish.');
    return true;
  }
  const input = h('input', { id: 'f-id', value: p.id, onchange: e => setAddress(e.target.value) });
  const slug = h('div', { class: 'slug-row' }, input,
    h('button', {
      class: 'btn', type: 'button', title: 'Make the page address from the title',
      onclick: () => {
        const title = $('#f-title')?.value || p.title || '';
        if (!title.trim()) { toast('Add a title first.'); return; }
        if (!setAddress(title)) toast('The page address already matches the title.');
      },
    }, 'From Title'));
  // Grouped like the project page: header (title, client), info under/next to the video, and the
  // things that only matter around the site (section, address, home page sets).
  const title = textField(p, 'title', { placeholder: 'Project title' });
  title.classList.add('pe-title-input');
  const client = textField(p, 'client', { list: true, placeholder: 'Client (e.g. Deakin University)' });
  client.classList.add('pe-client-input');
  return {
    header: h('div', { class: 'pe-header' }, lists, title, client,
      h('div', { class: 'pe-logo' }, h('span', { class: 'muted small' }, 'Client logo'), h('div', { id: 'client-logo' }, clientLogoRow(p)))),
    info: h('div', { class: 'form' },
    h('label', { for: 'f-role' }, 'Role'), textField(p, 'role', { list: true, placeholder: 'e.g. Editor' }),
    h('label', { for: 'f-production' }, 'Production'), textField(p, 'production', { list: true, placeholder: 'e.g. ThinkHQ' }),
    h('label', { for: 'f-agency' }, 'Agency'), textField(p, 'agency', { list: true, placeholder: 'If you worked through an agency' }),
    h('label', { for: 'f-year' }, 'Year'), textField(p, 'year', { class: 'year', placeholder: 'YYYY', inputmode: 'numeric', digits: true }),
    h('label', { for: 'f-platform' }, 'Made for'), textField(p, 'platform', { list: true, placeholder: 'e.g. TV, YouTube, Social' }),
    h('label', { for: 'f-deliverables' }, 'Deliverables'), textField(p, 'deliverables', { placeholder: 'e.g. 30s TVC, 15s and 6s cutdowns, 9:16 versions' }),
    h('label', { for: 'f-description', class: 'top' }, 'Description'),
    textField(p, 'description', { multiline: true, placeholder: 'A sentence or two about the project (helps Google too)' })),
    site: h('div', { class: 'form' },
    h('label', { for: 'f-category' }, 'Section'), cat,
    h('label', { for: 'f-id' }, 'Page address'), slug,
    h('span'), h('div', { class: 'url', id: 'url' }, `matthewfregnan.com${pagePath(p)}`),
    h('label', { class: 'top' }, 'Home page'), h('div', { id: 'home-sets', class: 'home-sets' }, homeCheckboxes(p))),
  };
}

/** One checkbox per home page set: tick to feature this project in that set. */
function homeCheckboxes(p) {
  return S.home.sets.map(s => h('label', { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: (s.projects || []).includes(keyOf(p)),
      onchange: e => {
        const on = e.target.checked;
        mutate(() => {
          const set = homeSet(s.id);
          set.projects = (set.projects || []).filter(k => k !== keyOf(p));
          if (on) set.projects.push(keyOf(p));
        });
      },
    }),
    s.name, s.id === S.home.active ? h('span', { class: 'muted small' }, ' (on the site now)') : null));
}

// ---------------------------------------------------------------- video

const GENERIC = 'Paste a video file, Vimeo, YouTube, Instagram or TikTok link';
const PLACEHOLDER = {
  file: 'https://videos.matthewfregnan.com/…/name.mp4',
  vimeo: 'Vimeo link (unlisted share links work too)',
  youtube: 'YouTube link (video, Short or live)',
  instagram: 'Instagram post or reel link',
  tiktok: 'TikTok video link (tiktok.com/@name/video/…)',
};

function activeSource(p) {
  const refs = V.ordered(p);
  return refs.find(r => V.status(r)?.ok !== false) || refs[0] || null;
}

function renderVideo() {
  const card = $('#video-card');
  const p = S.current;
  if (!card || !p) return;
  const src = V.sources(p);
  const refs = V.ordered(p);
  const active = activeSource(p);

  // Player: keep the existing iframe if it's already showing the right video (no reload flicker)
  let player = card.querySelector('.player');
  const broken = V.state(p) === 'bad';
  const want = active && !broken ? V.embedUrl(active) : '';
  const shape = active?.kind === 'instagram' ? 'instagram' : (p.category === 'vertical' || active?.kind === 'tiktok' ? 'vertical' : '');
  if (!player || player.dataset.src !== want || player.dataset.shape !== shape) {
    player = h('div', { class: `player ${shape}` });
    player.dataset.src = want;
    player.dataset.shape = shape;
    player.append(want
      ? (active.kind === 'file'
        ? h('video', { src: want, controls: true, preload: 'metadata', playsInline: true, poster: p.thumbnail ? I.src('thumbnails', p.thumbnail) : undefined })
        : h('iframe', { src: want, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowFullscreen: true, title: 'Video preview' }))
      : h('div', { class: 'player-empty' }, broken
        ? "This video can't play on the site. Fix it, or add a backup link below."
        : p.gallery?.length ? 'No video. The page shows the stills gallery.' : 'Paste a video link below to see it here.'));
  }

  const rows = [];
  for (const kind of V.SOURCES) {
    const ref = src[kind];
    const visible = ref || S.showBackups || (!refs.length && kind === V.SOURCES[0]);
    if (!visible) continue;
    const st = V.status(ref);
    rows.push(
      h('span', { class: 'name' }, V.NAMES[kind]),
      h('span', { class: `dot ${ref ? String(st ? st.ok : null) : 'none'}`, title: ref ? (st ? st.title || st.message : 'Checking…') : '' }),
      h('input', {
        id: `v-${kind}`,
        value: ref ? V.pageUrl(ref) : '',
        placeholder: !refs.length && kind === V.SOURCES[0] ? GENERIC : PLACEHOLDER[kind],
        onchange: e => setSourceFromInput(kind, e.target.value),
        onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
      }),
      h('a', { class: 'btn open', href: ref ? V.pageUrl(ref) : undefined, target: '_blank', rel: 'noopener', 'aria-disabled': !ref, style: ref ? '' : 'visibility:hidden' }, 'Open'),
    );
  }

  const tools = [];
  if (refs.length && !S.showBackups && refs.length < V.SOURCES.length) {
    tools.push(h('button', { class: 'btn link', onclick: () => { S.showBackups = true; renderVideo(); } }, '+ Add a backup link (Vimeo, YouTube, Instagram or TikTok)'));
  }
  if (refs.length > 1) {
    tools.push(h('label', {}, 'Show first: ', h('select', {
      onchange: e => {
        mutate(() => { p.videoPrimary = e.target.value; });
        renderVideo();
      },
      style: 'width:auto',
    }, refs.map(r => h('option', { value: r.kind }, V.NAMES[r.kind])))));
  }

  // Drop a video file on the player to upload it
  player.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); player.classList.add('over'); } };
  player.ondragleave = () => player.classList.remove('over');
  player.ondrop = e => {
    player.classList.remove('over');
    const file = [...(e.dataTransfer.files || [])].find(U.looksLikeVideo);
    if (file) { e.preventDefault(); startUpload(p, file); }
  };
  const job = uploadJobFor(p);

  card.replaceChildren(
    h('h4', {}, 'Video'),
    player,
    job ? h('div', { class: 'upload-line' }, h('span', { class: 'dot null' }), ` ${job.label}`,
      h('div', { class: 'upload-bar' }, h('span', { style: `width:${Math.round(job.progress * 100)}%` }))) :'',
    h('div', { class: 'sources' }, rows),
    h('div', { class: 'vrow-tools' }, tools),
    h('div', { class: 'vstate', id: 'vstate' }, videoStateText(p)),
    refs.length ? h('div', { class: 'vrow-tools' },
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: !!p.showStats,
        onchange: e => { mutate(() => { if (e.target.checked) p.showStats = true; else delete p.showStats; }); renderVideo(); },
      }), 'Show views, likes & comments on the project page'),
      h('button', {
        class: 'btn', onclick: useVideoDetails, disabled: !refs.some(r => r.kind !== 'file' && V.status(r)?.ok),
      }, 'Use Video’s Title, Year & Thumbnail')) :'',
    refs.length && p.showStats ? statsFields(p) : '',
    h('div', { class: 'vrow-tools' },
      h('button', {
        class: 'btn', disabled: !!job || !uploadConfig(),
        title: uploadConfig() ? 'Convert (if needed) and upload a video file, then use it as this project’s video. You can also drop a file on the player.'
          : 'Sign in to upload videos',
        onclick: async () => { const [f] = await pickVideoFile(); if (f) startUpload(p, f); },
      }, 'Upload Video File…'),
      h('span', { class: 'muted small' }, 'or drop a video on the player. MP4/MOV; ProRes needs the desktop app.')),
  );
}

// ---------------------------------------------------------------- video uploads (background)

/** Where uploads go and the token that authorises them (the admin's GitHub sign-in). */
function uploadConfig() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && params.get('upload')) return { endpoint: params.get('upload'), token: params.get('uploadToken') || '' };
  if (S.backend && !S.backend.demo && S.backend.token) return { endpoint: U.UPLOAD_ENDPOINT, token: S.backend.token };
  return null;
}

const uploadJobFor = p => S.uploads.find(j => j.key === keyOf(p) && !j.finished);

function pickVideoFile() {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: 'video/*,.mov,.mp4,.m4v,.mkv,.webm' });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

function startUpload(p, file) {
  if (!uploadConfig()) { toast('Sign in to upload videos.'); return; }
  if (!U.looksLikeVideo(file)) { toast('Choose a video file (MP4 or MOV).'); return; }
  if (uploadJobFor(p)) { toast('This project already has a video uploading.'); return; }
  S.uploads.push({ key: keyOf(p), title: p.title || p.id, file, progress: 0, label: 'Waiting to upload…', finished: false });
  renderUploads();
  runUploads();
}

let uploadRunning = false;
async function runUploads() {
  if (uploadRunning) return;
  const job = S.uploads.find(j => !j.finished && !j.started);
  if (!job) return;
  uploadRunning = true;
  job.started = true;
  const step = (progress, label) => { job.progress = progress; job.label = label; renderUploads(); };
  try {
    const blob = await U.prepare(job.file, (f, label) => step(f * 0.5, `${label}… ${Math.round(f * 100)}%`));
    // A new address for every upload, so the live video isn't replaced until you publish (and undo works)
    const url = await U.upload(blob, `${job.key}-${Date.now().toString(36)}.mp4`, {
      ...uploadConfig(),
      onProgress: f => step(0.5 + f * 0.5, `Uploading ${(blob.size / 1e6).toFixed(0)} MB… ${Math.round(f * 100)}%`),
    });
    job.finished = true;
    linkUploadedVideo(job, url);
  } catch (e) {
    job.finished = true;
    toast(`Upload failed for “${job.title}”: ${e.message}`, 10000);
  }
  uploadRunning = false;
  renderUploads();
  runUploads();
}

/** Point the project at its new video (found by address, so switching projects meanwhile is fine). */
function linkUploadedVideo(job, url) {
  const p = projects().find(x => keyOf(x) === job.key);
  if (!p) {
    toast(`“${job.title}” uploaded, but the project was renamed or deleted. Its video is at ${url}`, 15000);
    return;
  }
  const ref = { kind: 'file', id: url, hash: '' };
  const prev = S.current;
  S.current = p;   // so the change is recorded against that project
  mutate(() => V.setSource(p, 'file', ref), { list: true });
  S.current = prev;
  V.check(ref, true).then(() => { if (S.current === p) renderVideo(); }).catch(() => {});
  if (S.current === p) renderMedia();   // Thumbnail and Stills get "Pick from Video…" now there's a file
  toast(`Uploaded the video for “${job.title}”. Publish to put it live.`, 6000);
}

function renderUploads() {
  const el = $('#upload-status');
  const active = S.uploads.filter(j => !j.finished);
  if (el) {
    el.hidden = !active.length;
    const j = active.find(x => x.started) || active[0];
    el.textContent = j ? `⬆ ${j.title}: ${j.label}${active.length > 1 ? ` (+${active.length - 1} waiting)` : ''}` : '';
  }
  if (!S.current) return;
  const line = $('#video-card .upload-line');
  const job = uploadJobFor(S.current);
  if (job && line) {
    line.childNodes[1].textContent = ` ${job.label}`;
    line.querySelector('.upload-bar span').style.width = `${Math.round(job.progress * 100)}%`;
  } else if (!!job !== !!line) {
    renderVideo();
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Projects showing typed view counts, oldest numbers first: [{ p, days, when }]. */
function statsToRefresh() {
  const typed = p => p.showStats && (p.statsViews || p.statsLikes || p.statsComments);
  return projects().filter(typed).map(p => {
    const when = p.statsUpdated || (p.updated || '').slice(0, 10);   // older projects: their last edit
    const days = when ? Math.floor((Date.now() - new Date(`${when}T00:00`).getTime()) / 86400000) : 9999;
    return { p, days, when };
  }).sort((a, b) => b.days - a.days);
}

// Hidden projects still take up video storage. After this long hidden, the Overview suggests deleting them.
const HIDDEN_STALE_DAYS = 182;
function staleHidden() {
  return projects().filter(p => p.hidden && p.hiddenSince).map(p => ({ p,
    days: Math.floor((Date.now() - new Date(`${p.hiddenSince}T00:00`).getTime()) / 86400000) }))
    .filter(x => x.days >= HIDDEN_STALE_DAYS).sort((a, b) => b.days - a.days);
}

function hiddenCard(card, open) {
  const list = staleHidden();
  if (!list.length) return null;
  const sizeOf = p => {   // from the storage listing, when it's loaded
    const f = S.storage?.data?.objects?.find(x => p.videoFile && storageKeyOf(p.videoFile) === x.key);
    return f ? ` · ${fmtBytes(f.size)}` : '';
  };
  const del = async p => {
    if (!(await confirmDialog('Delete project?', `Delete “${p.title}”? It has been hidden since ${p.hiddenSince}. You can undo this until you publish. Its video file then shows under “Not used by any project” on the Storage page, where you can free the space.`, 'Delete', true))) return;
    const list = projects();
    mutate(() => { list.splice(list.indexOf(p), 1); renameRefs(keyOf(p), null); if (S.current === p) S.current = null; }, { list: true, editor: true });
    toast(`Deleted “${p.title}”. Press Undo to bring it back.`, 6000);
    renderOverview();
  };
  return card(`Hidden for over 6 months (${list.length})`,
    h('p', { class: 'muted small' }, 'These are off the site but their videos still use storage. Delete them if you won’t bring them back.'),
    h('div', { class: 'ov-list' }, list.map(({ p, days }) => h('div', { class: 'ov-stat-row' },
      h('button', { class: 'ov-row', onclick: () => open(p) }, thumbFor(p),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p.title || '(untitled)'),
          h('span', { class: 'row-sub' }, `Hidden ${agoText(days)}${p.videoFile ? sizeOf(p) : ' · no hosted video'}`))),
      h('button', { class: 'btn link', title: 'Put it back on the site', onclick: () => { setHidden(p, false); renderOverview(); } }, 'Show'),
      h('button', { class: 'btn link danger', onclick: () => del(p) }, 'Delete')))));
}

const STATS_DUE_DAYS = 30;
const agoText = days => (days >= 9999 ? 'never dated' : days === 0 ? 'today' : days === 1 ? 'yesterday'
  : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`);

function statsCard(card, open) {
  const list = statsToRefresh();
  if (!list.length) {
    return card('View counts', h('p', { class: 'muted small' },
      'No projects show typed views or likes yet. Add them in a project’s Video section.'));
  }
  const due = list.filter(x => x.days >= STATS_DUE_DAYS);
  const fresh = list.filter(x => x.days < STATS_DUE_DAYS);
  const platform = p => STATS_PLATFORMS.find(([v]) => v === (p.statsPlatform ?? (p.instagramId ? 'instagram' : p.tiktokId ? 'tiktok' : '')))?.[1] || '';
  const row = ({ p, days }) => h('div', { class: 'ov-stat-row' },
    h('button', { class: 'ov-row', onclick: () => open(p) }, thumbFor(p),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p.title || '(untitled)'),
        h('span', { class: 'row-sub' }, `Updated ${agoText(days)}${p.statsViews ? ` · ${p.statsViews} views` : ''}${platform(p) && !platform(p).startsWith('Don') ? ` on ${platform(p)}` : ''}`))),
    days >= STATS_DUE_DAYS ? h('button', { class: 'btn link', title: 'The numbers haven’t changed: mark them as checked today',
      onclick: () => { const prev = S.current; S.current = p; mutate(() => { p.statsUpdated = today(); }); S.current = prev; renderOverview(); } }, 'Still current') : null);
  return card(due.length ? `View counts to update (${due.length})` : 'View counts',
    due.length ? [h('p', { class: 'muted small' }, `Over ${STATS_DUE_DAYS} days old. Open the post, then update the numbers (or mark them as still current).`),
      h('div', { class: 'ov-list' }, due.map(row))] : null,
    fresh.length ? h('details', { class: 'ov-fresh', open: !due.length },
      h('summary', {}, `${fresh.length} up to date (updated in the last ${STATS_DUE_DAYS} days)`),
      h('div', { class: 'ov-list' }, fresh.map(row))) : null);
}

const STATS_PLATFORMS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'], ['vimeo', 'Vimeo'], ['x', 'X'], ['', 'Don’t say (across platforms)']];

/** Views / likes / comments typed by hand (e.g. from a client's Instagram post). */
function statsFields(p) {
  const field = (key, label, placeholder) => h('label', { class: 'stat-field' }, h('span', { class: 'muted small' }, label),
    h('input', { value: p[key] || '', placeholder, inputmode: 'decimal', onchange: e => {
      const v = e.target.value.trim();
      mutate(() => { if (v) p[key] = v; else delete p[key]; p.statsUpdated = today(); });
    } }));
  const where = p.statsPlatform ?? (p.instagramId ? 'instagram' : p.tiktokId ? 'tiktok' : '');
  return h('div', { class: 'stats-box' },
    h('div', { class: 'stats-row' },
      field('statsViews', 'Views', 'e.g. 1.2M'),
      field('statsLikes', 'Likes', 'e.g. 45K'),
      field('statsComments', 'Comments', 'e.g. 320'),
      h('label', { class: 'stat-field' }, h('span', { class: 'muted small' }, 'Counted on'),
        h('select', { onchange: e => mutate(() => { p.statsPlatform = e.target.value; p.statsUpdated = today(); }) },
          STATS_PLATFORMS.map(([v, n]) => h('option', { value: v, selected: v === where }, n))))),
    h('p', { class: 'hint' }, 'Type the numbers from the post (1.2M, 45K or 45000). Leave them all empty to use YouTube’s or Vimeo’s live count instead. Shown like “1.2M views · 45K likes · 320 comments on Instagram”.'));
}

function videoStateText(p) {
  const refs = V.ordered(p);
  if (!refs.length) return '';
  const names = refs.map(r => V.NAMES[r.kind]);
  const first = V.status(refs[0]);
  const dot = s => h('span', { class: `dot ${s}` });
  switch (V.state(p)) {
    case 'unknown': return 'Checking…';
    case 'ok': return h('span', {}, dot('ok'), ` ${names[0]} plays · ${first.ok ? first.title : first.message}`,
      names.length > 1 ? h('span', { class: 'muted' }, ` · Backup: ${names.slice(1).join(' → ')}`) : '');
    case 'backup': return h('span', {}, dot('backup'), ` ${names[0]} isn't playing (${first.message.toLowerCase()}). The site shows the backup instead.`);
    default: return h('span', {}, dot('bad'), ` Nothing plays: ${first.message.toLowerCase()}. Check the link opens in your browser, or add a backup link.`);
  }
}

function setSourceFromInput(kind, text) {
  const p = S.current;
  const ref = V.parseVideo(text, kind);
  if (text.trim() && !ref) {
    $('#vstate').replaceChildren(h('span', {}, h('span', { class: 'dot bad' }), ` That doesn't look like a ${V.NAMES[kind]} link.`));
    return;
  }
  const target = ref ? ref.kind : kind;  // a YouTube link pasted in the Vimeo box goes to YouTube
  const cur = V.sources(p)[target];
  if ((cur ? V.pageUrl(cur) : '') === (ref ? V.pageUrl(ref) : '')) {
    renderVideo();
    return;
  }
  mutate(() => V.setSource(p, target, ref));
  if (target === 'file') renderMedia(); else renderVideo();   // a file unlocks Pick from Video
  if (ref) V.check(ref, true);
}

async function useVideoDetails() {
  const p = S.current;
  const ref = V.ordered(p).find(r => r.kind !== 'file' && V.status(r)?.ok);
  if (!ref) return;
  const st = V.status(ref);
  const replace = !p.thumbnail || await confirmDialog('Replace thumbnail?', "Replace the current thumbnail with the video's poster frame?", 'Replace');
  toast('Fetching video details…');
  let thumb = null;
  if (replace) {
    try {
      thumb = await thumbnailFromVideo(ref, st, p);
    } catch {
      toast("Couldn't download the thumbnail.");
    }
  }
  mutate(() => {
    if (st.title && (!p.title || p.title === 'New Project')) p.title = V.tidyTitle(st.title);
    if (st.uploadDate && !p.year) p.year = st.uploadDate.slice(0, 4);
    if (thumb) p.thumbnail = thumb;
  }, { list: true, editor: true });
  toast('Updated from the video.');
}

async function thumbnailFromVideo(ref, st, p) {
  const urls = [st.thumbnail];
  if (ref.kind === 'youtube') urls.push(`https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`);
  for (const u of urls) {
    try {
      return await storeThumbnail(p, await I.download(u));
    } catch { /* try the next size */ }
  }
  throw new Error('no thumbnail');
}

// ---------------------------------------------------------------- thumbnail

async function storeThumbnail(p, file) {
  const { blob, ext } = await I.convert(file, I.THUMB_MAX);
  const value = `${p.category}/${p.id}.${ext}`;
  I.addPending(I.repoPath('thumbnails', value), blob);
  return value;
}

function pickFiles(multiple) {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

function dropTarget(el, onFiles) {
  el.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    el.classList.remove('over');
    onFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/') || /\.(heic|webp)$/i.test(f.name)));
  });
}

async function setThumbnail(files) {
  const p = S.current;
  if (!files.length) return;
  try {
    const value = await storeThumbnail(p, files[0]);
    mutate(() => { p.thumbnail = value; delete p.thumbFocus; }, { list: true });
    renderThumb();
    toast('Thumbnail added (converted to WebP). Click it to set a focus point if needed.');
  } catch (e) {
    toast(e.message);
  }
}

function renderThumb() {
  const card = $('#thumb-card');
  const p = S.current;
  if (!card || !p) return;
  if (!p.thumbnail) {
    const zone = h('div', {
      class: 'dropzone', tabIndex: 0, role: 'button', 'aria-label': 'Choose thumbnail',
      onclick: async () => setThumbnail(await pickFiles(false)),
      onkeydown: async e => { if (e.key === 'Enter' || e.key === ' ') setThumbnail(await pickFiles(false)); },
    }, h('span', {}, 'Drop a thumbnail here', h('br'), 'or click to choose'));
    dropTarget(zone, setThumbnail);
    card.replaceChildren(h('h4', {}, 'Thumbnail'), zone, pickFromVideoButton(p));
    return;
  }

  // With a thumbnail: click the picture to set its focus point (what crops keep in view).
  const focus = parseFocus(p.thumbFocus);
  const src = thumbSrc(p);
  const img = I.withFallback(h('img', { src, alt: 'Thumbnail', draggable: false }), 'thumbnails', p.thumbnail);
  const marker = h('span', { class: 'focus-marker', style: `left:${focus.x}%;top:${focus.y}%` });
  const frame = h('div', { class: 'focus-frame', title: 'Click to set the focus point' }, img, marker);
  const setFocus = (x, y) => {
    const v = `${Math.round(x)}% ${Math.round(y)}%`;
    mutate(() => { if (v === '50% 50%') delete p.thumbFocus; else p.thumbFocus = v; });
    renderThumb();
  };
  frame.addEventListener('click', e => {
    const r = img.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    setFocus(x, y);
  });
  const zone = h('div', { class: 'dropzone has-image' }, frame);
  dropTarget(zone, setThumbnail);

  // Live preview of the widest crop on the site (the home page section banners)
  const preview = h('div', { class: 'crop-preview' },
    I.withFallback(h('img', { src, alt: '', style: `object-position:${focus.x}% ${focus.y}%` }), 'thumbnails', p.thumbnail));

  card.replaceChildren(
    h('h4', {}, 'Thumbnail'),
    zone,
    h('p', { class: 'hint' }, 'Click the picture to choose what stays in view when it’s cropped (e.g. a face).'),
    h('div', { class: 'crop-label muted small' }, 'Widest crop on the site'),
    preview,
    pickFromVideoButton(p),
    h('div', { class: 'thumb-tools' },
      h('button', { class: 'btn link', onclick: async () => setThumbnail(await pickFiles(false)) }, 'Replace'),
      p.thumbFocus ? h('button', { class: 'btn link', onclick: () => setFocus(50, 50) }, 'Reset focus') : null,
      h('button', { class: 'btn link', onclick: () => { mutate(() => { p.thumbnail = ''; delete p.thumbFocus; }, { list: true }); renderThumb(); } }, 'Remove')),
  );
}

// ---------------------------------------------------------------- pick frames from the video

/** "Pick from video" is offered when the project has its own hosted video file. */
/** Redraw the video, thumbnail and stills sections (e.g. once a video file is added). */
function renderMedia() {
  renderVideo();
  renderThumb();
  renderGallery();
}

function pickFromVideoButton(p, mode = 'thumb') {
  const ref = V.sources(p).file;
  if (!ref) {
    return h('p', { class: 'hint' }, mode === 'stills'
      ? 'Add a hosted video file to pick stills straight from the video.'
      : 'Add a hosted video file to pick a thumbnail or stills straight from the video.');
  }
  return h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => openFramePicker(p, ref.id, mode) },
    mode === 'stills' ? 'Pick Stills from Video…' : 'Pick from Video…');
}

/** Scrub the hosted video and grab frames: as the thumbnail, or as stills. `mode` picks the main button. */
function openFramePicker(p, url, mode = 'thumb') {
  const d = $('#dialog');
  d.classList.add('wide');
  d.addEventListener('close', () => d.classList.remove('wide'), { once: true });
  // The extra query keeps Cloudflare from serving a copy cached before frame reading was allowed
  const src = `${url}${url.includes('?') ? '&' : '?'}frame=pick`;
  const video = h('video', { src, crossOrigin: 'anonymous', controls: true, preload: 'auto', playsInline: true, muted: true, class: 'frame-video' });
  const time = h('span', { class: 'muted small frame-time' }, '0:00.00');
  const status = h('p', { class: 'muted small' }, ' ');
  const added = h('div', { class: 'frame-strip' });
  const fmtT = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  video.addEventListener('timeupdate', () => { time.textContent = fmtT(video.currentTime); });
  video.addEventListener('seeked', () => { time.textContent = fmtT(video.currentTime); });
  video.addEventListener('error', () => { status.textContent = "Couldn't load the video for frame picking."; });
  const step = dt => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + dt)); };
  const FRAME = 1 / 25;

  const grab = () => new Promise((resolve, reject) => {
    if (!video.videoWidth) { reject(new Error('The video hasn’t loaded yet.')); return; }
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    try {
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Couldn’t capture that frame.'))), 'image/png');
    } catch {
      reject(new Error('The browser blocked reading this video’s frames.'));
    }
  });

  const useAsThumb = async () => {
    try {
      status.textContent = 'Saving thumbnail…';
      video.pause();
      await setThumbnail([await grab()]);
      status.textContent = `Thumbnail set from ${fmtT(video.currentTime)}.`;
    } catch (e) { status.textContent = e.message; }
  };
  const addStill = async () => {
    try {
      status.textContent = 'Adding still…';
      video.pause();
      const blob = await grab();
      await addGallery([blob]);
      added.append(h('img', { src: URL.createObjectURL(blob), alt: '', title: fmtT(video.currentTime) }));
      status.textContent = `Added a still from ${fmtT(video.currentTime)}. Keep going, or press Done.`;
    } catch (e) { status.textContent = e.message; }
  };

  d.replaceChildren(
    h('h3', {}, `Pick from video · ${p.title}`),
    video,
    h('div', { class: 'vrow-tools frame-controls' },
      h('button', { class: 'btn', title: 'Back 1 second', onclick: () => step(-1) }, '−1s'),
      h('button', { class: 'btn', title: 'Back 1 frame', onclick: () => step(-FRAME) }, '‹ frame'),
      h('button', { class: 'btn', title: 'Forward 1 frame', onclick: () => step(FRAME) }, 'frame ›'),
      h('button', { class: 'btn', title: 'Forward 1 second', onclick: () => step(1) }, '+1s'),
      time),
    status,
    added,
    h('div', { class: 'actions' },
      h('button', { class: `btn${mode === 'stills' ? ' primary' : ''}`, onclick: addStill }, 'Add to Stills'),
      h('button', { class: `btn${mode === 'stills' ? '' : ' primary'}`, onclick: useAsThumb }, 'Use as Thumbnail'),
      h('button', { class: 'btn', onclick: () => d.close() }, 'Done')),
  );
  d.addEventListener('close', () => { if (S.current === p) { renderThumb(); renderGallery(); } }, { once: true });
  if (!d.open) d.showModal();
}

function parseFocus(v) {
  const m = /^(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%$/.exec(String(v || '').trim());
  return m ? { x: Math.min(100, +m[1]), y: Math.min(100, +m[2]) } : { x: 50, y: 50 };
}

// ---------------------------------------------------------------- gallery

async function addGallery(files) {
  const p = S.current;
  if (!files.length) return;
  toast(`Adding ${files.length} image(s)…`);
  const gallery = [...(p.gallery || [])];
  let n = Math.max(0, ...gallery.map(g => Number((g.match(/-(\d+)\.\w+$/) || [])[1] || 0)));
  try {
    for (const f of files) {
      const { blob, ext } = await I.convert(f, I.GALLERY_MAX);
      n += 1;
      const value = `${p.id}/${p.id}-${n}.${ext}`;
      I.addPending(I.repoPath('gallery', value), blob);
      gallery.push(value);
    }
  } catch (e) {
    toast(e.message);
  }
  mutate(() => { p.gallery = gallery; });
  renderGallery();
  renderVideo();
}

let galleryDrag = null;

function renderGallery() {
  const card = $('#gallery-card');
  const p = S.current;
  if (!card || !p) return;
  const gallery = p.gallery || [];
  if (!gallery.length && p.category !== 'colour-grading' && !S.showGallery) {
    card.replaceChildren(h('button', { class: 'btn link', onclick: () => { S.showGallery = true; renderGallery(); } }, '+ Add stills (gallery)'));
    return;
  }
  const grid = h('div', { class: 'gallery' },
    gallery.map((g, i) => {
      const fig = h('figure', { draggable: true },
        I.withFallback(h('img', { src: I.src('gallery', g), alt: `Still ${i + 1}`, loading: 'lazy' }), 'gallery', g),
        h('button', {
          class: 'remove', title: 'Remove', 'aria-label': `Remove still ${i + 1}`,
          onclick: () => { mutate(() => { p.gallery = gallery.filter((_, j) => j !== i); }); renderGallery(); },
        }, '×'));
      fig.addEventListener('dragstart', e => { galleryDrag = i; fig.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      fig.addEventListener('dragend', () => { galleryDrag = null; fig.classList.remove('dragging'); });
      fig.addEventListener('dragover', e => { if (galleryDrag !== null && galleryDrag !== i) { e.preventDefault(); fig.classList.add('drop-before'); } });
      fig.addEventListener('dragleave', () => fig.classList.remove('drop-before'));
      fig.addEventListener('drop', e => {
        fig.classList.remove('drop-before');
        if (galleryDrag === null) return;
        e.preventDefault();
        e.stopPropagation();
        const order = [...gallery];
        const [item] = order.splice(galleryDrag, 1);
        order.splice(galleryDrag < i ? i - 1 : i, 0, item);
        mutate(() => { p.gallery = order; });
        renderGallery();
      });
      return fig;
    }),
    h('button', { class: 'add', onclick: async () => addGallery(await pickFiles(true)) }, '+ Add images'));
  dropTarget(grid, addGallery);
  card.replaceChildren(h('h4', {}, `Gallery (${gallery.length})`), grid,
    h('p', { class: 'hint' }, 'Drag to reorder · drop images from your computer to add'),
    pickFromVideoButton(p, 'stills'));
}

// =========================================================================== dialogs

function newFromLink() {
  let ref = null;
  let st = null;
  let touched = false;
  let timer;
  const link = h('input', { placeholder: GENERIC, autofocus: true });
  const cat = h('select', { onchange: () => { touched = true; } },
    S.data.categories.map(c => h('option', { value: c.id, selected: c.id === currentCategory() }, c.name)));
  const info = h('div', { class: 'lookup' }, h('span'), h('span', { class: 'muted' }, ' '));
  const create = h('button', { class: 'btn primary', disabled: true }, 'Create Project');

  const lookup = async () => {
    ref = V.parseVideo(link.value);
    st = null;
    create.disabled = !ref;
    if (!ref) {
      info.replaceChildren(h('span'), h('span', { class: 'muted' }, link.value.trim() ? 'Not a video file, Vimeo, YouTube, Instagram or TikTok link.' : ' '));
      return;
    }
    info.replaceChildren(h('span'), h('span', { class: 'muted' }, 'Looking up the video…'));
    const mine = ref;
    const res = await V.check(ref, true);
    if (mine !== ref) return;
    st = res;
    if (res.ok) {
      info.replaceChildren(
        res.thumbnail ? h('img', { src: res.thumbnail, alt: '' }) : h('span'),
        h('div', {}, h('b', {}, V.tidyTitle(res.title)), res.uploadDate ? ` · ${res.uploadDate.slice(0, 4)}` : '',
          h('div', { class: 'muted small' }, res.thumbnail ? 'Title, year and thumbnail will be filled in for you.' : 'Add a thumbnail after creating it.')));
      if (res.height > res.width && !touched) cat.value = 'vertical';
    } else {
      info.replaceChildren(h('span'), h('span', {}, res.ok === null ? res.message : `${res.message}. You can still create it and fix the link later.`));
    }
  };
  link.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(lookup, 350); });

  dialog(close => {
    create.onclick = async () => {
      if (!ref) return;
      create.disabled = true;
      create.textContent = 'Creating…';
      const p = blankProject(cat.value);
      if (st?.ok) {
        p.title = V.tidyTitle(st.title);
        p.year = st.uploadDate ? st.uploadDate.slice(0, 4) : '';
      }
      p.id = uniqueId(slugify(p.title), p.category);
      V.setSource(p, ref.kind, ref);
      if (st?.ok && st.thumbnail) {
        try { p.thumbnail = await thumbnailFromVideo(ref, st, p); } catch { /* add one later */ }
      }
      close();
      addProject(p);
      $('#f-client')?.focus();
      toast(`Added “${p.title}”. Fill in the client and production.`, 5000);
    };
    return [
      h('h3', {}, 'New Project from Link'),
      h('div', { class: 'field' }, h('label', {}, 'Video link'), link),
      h('div', { class: 'field' }, h('label', {}, 'Category'), cat),
      info,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), create),
    ];
  });
  link.focus();
}

/** New project straight from a video file: title, section, address and thumbnail filled in, then it uploads. */
async function newFromFile(given) {
  const file = given || (await pickVideoFile())[0];
  if (!file) return;
  if (!U.looksLikeVideo(file)) { toast('Choose a video file (MP4 or MOV).'); return; }
  let addrTouched = false;
  let catTouched = false;
  const title = h('input', { value: V.tidyTitle(file.name), oninput: () => syncAddr() });
  const client = h('input', { placeholder: 'e.g. Deakin University', list: 'dl-client' });
  const cat = h('select', { onchange: () => { catTouched = true; syncAddr(); } },
    S.data.categories.map(c => h('option', { value: c.id, selected: c.id === currentCategory() }, c.name)));
  const addr = h('input', { oninput: () => { addrTouched = true; showUrl(); }, onchange: () => { addr.value = slugify(addr.value); showUrl(); } });
  const url = h('div', { class: 'url' });
  const still = h('div', { class: 'lookup' }, h('span', { class: 'noimg', style: 'width:140px;height:79px' }), h('span', { class: 'muted small' }, 'Reading the video…'));
  const warn = h('p', { class: 'error', hidden: true });
  const create = h('button', { class: 'btn primary' }, uploadConfig() ? 'Create & Upload' : 'Create Project');
  let frame = null;
  function showUrl() { url.textContent = `matthewfregnan.com/${category(cat.value).slug}/${uniqueId(slugify(addr.value || title.value), cat.value)}/`; }
  function syncAddr() { if (!addrTouched) addr.value = slugify(title.value); showUrl(); }
  syncAddr();

  // Look at the file: portrait videos default to Social; grab a frame for the thumbnail
  (async () => {
    const [info, blob] = await Promise.all([U.probe(file), U.grabFrame(file)]);
    frame = blob;
    if (info && info.height > info.width && !catTouched) { cat.value = 'vertical'; syncAddr(); }
    if (info?.codec === 'prores') {
      warn.textContent = "This is ProRes, which browsers can't read. Create the project here and upload the file with the desktop app, or export an H.264 MP4.";
      warn.hidden = false;
    }
    const facts = info ? `${info.width}×${info.height} · ${Math.round(info.duration || 0)}s · ${(file.size / 1e6).toFixed(0)} MB` : `${(file.size / 1e6).toFixed(0)} MB`;
    still.replaceChildren(
      blob ? h('img', { src: URL.createObjectURL(blob), alt: '' }) : h('span', { class: 'noimg', style: 'width:140px;height:79px' }),
      h('div', {}, h('b', {}, file.name), h('div', { class: 'muted small' }, facts),
        h('div', { class: 'muted small' }, blob ? 'This frame becomes the thumbnail (change it any time).' : 'Pick a thumbnail after creating it.')));
  })();

  dialog(close => {
    create.onclick = async () => {
      if (!title.value.trim()) { title.focus(); return; }
      create.disabled = true;
      create.textContent = 'Creating…';
      const p = blankProject(cat.value);
      p.title = title.value.trim();
      if (client.value.trim()) p.client = client.value.trim();
      p.id = uniqueId(slugify(addr.value || p.title), p.category);
      if (frame) { try { p.thumbnail = await storeThumbnail(p, frame); } catch { /* add one later */ } }
      close();
      addProject(p);
      if (warn.hidden && uploadConfig()) startUpload(p, file);
      toast(warn.hidden && uploadConfig() ? `Added “${p.title}”. The video is uploading; keep working meanwhile.` : `Added “${p.title}”.`, 6000);
    };
    return [
      h('h3', {}, 'New Project from Video File'),
      still,
      warn,
      h('div', { class: 'field' }, h('label', {}, 'Title'), title),
      h('div', { class: 'field' }, h('label', {}, 'Client (optional)'), client),
      h('div', { class: 'field' }, h('label', {}, 'Section'), cat),
      h('div', { class: 'field' }, h('label', {}, 'Page address'), addr, url),
      !uploadConfig() ? h('p', { class: 'muted small' }, 'Sign in to upload; in this mode the project is created without its video.') : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), create),
    ];
  });
  title.select();
}

async function checkVideos() {
  const refs = new Map();
  projects().forEach(p => V.ordered(p).forEach(r => refs.set(V.pageUrl(r), r)));
  toast(`Checking ${refs.size} video links…`, 20000);
  await Promise.all([...refs.values()].map(r => V.check(r, true)));
  renderList();
  if (S.current) renderVideo();
  const bad = projects().filter(p => V.state(p) === 'bad');
  const backup = projects().filter(p => V.state(p) === 'backup');
  const none = projects().filter(p => !V.ordered(p).length && !(p.gallery || []).length);
  toast(`Done: ${bad.length} not playing, ${backup.length} using a backup`);
  const item = p => h('li', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); $('#dialog').close(); clearSearchFor(p); select(p); } }, p.title),
    ` (${category(p.category).name})`);
  dialog(close => [
    h('h3', {}, 'Video check'),
    !bad.length && !backup.length && !none.length ? h('p', {}, 'Every video plays.') : null,
    bad.length ? [h('p', {}, h('span', { class: 'dot bad' }), ` ${bad.length} project(s) have no video that plays:`), h('ul', {}, bad.map(item))] : null,
    backup.length ? [h('p', {}, h('span', { class: 'dot backup' }), ` ${backup.length} project(s) are playing their backup link:`), h('ul', {}, backup.map(item))] : null,
    none.length ? h('p', { class: 'muted' }, `${none.length} project(s) have no video and no gallery.`) : null,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Done')),
  ]);
}

/** For publishing (and restoring a draft): re-apply your edits on top of newer versions of the data
 *  files. Throws ConflictError naming anything that was changed differently on both sides. */
function rebaseOnto(text, homeText) {
  return ({ base, baseHome, theirs, theirsHome }) => {
    const data = mergeJsonText(base, text, theirs);
    const home = mergeJsonText(baseHome, homeText, theirsHome);
    const clashes = [...data.conflicts, ...home.conflicts.map(c => `home page › ${c}`)];
    if (clashes.length) {
      throw new ConflictError(`Some things were changed both here and somewhere else since you opened this page: ${clashes.slice(0, 5).join('; ')}${clashes.length > 5 ? ` and ${clashes.length - 5} more` : ''}. Change them back here (or Undo) and publish again, or reload to start from the published version.`);
    }
    return { text: data.text, homeText: home.text };
  };
}

function publish() {
  const list = changes();
  if (!list.length) return;
  const msg = h('input', { value: list.length === 1 ? list[0].replace(/[“”]/g, '') : `Update portfolio (${list.length} changes)` });
  const err = h('p', { class: 'error', hidden: true });
  const go = h('button', { class: 'btn primary' }, S.backend.demo ? 'Publish (demo)' : 'Publish');
  dialog(close => {
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = 'Publishing…';
      err.hidden = true;
      const text = `${JSON.stringify(S.data, null, 2)}\n`;
      const homeText = `${JSON.stringify(S.home, null, 2)}\n`;
      const used = usedImagePaths();
      const images = new Map([...I.pending].filter(([path]) => used.has(path)));
      try {
        const saved = await S.backend.save({ text, homeText, images, message: `${msg.value.trim() || 'Update portfolio'} (web)`,
          baseSha: S.baseSha, rebase: rebaseOnto(text, homeText) });
        if (saved.text !== text || saved.homeText !== homeText) {   // merged with changes made elsewhere
          S.data = JSON.parse(saved.text);
          S.home = JSON.parse(saved.homeText);
          S.current = S.current && projects().find(p => keyOf(p) === keyOf(S.current)) || null;
          renderList();
          renderEditor();
        }
        S.baseText = saved.text;
        S.baseHomeText = saved.homeText;
        S.baseSha = saved.sha;
        I.markPublished();
        saveDraft();
        close();
        renderToolbar();
        toast(S.backend.demo ? 'Demo: nothing was saved.' : 'Published. The site updates in 1–2 minutes.', 6000);
      } catch (e) {
        go.disabled = false;
        go.textContent = 'Publish';
        err.hidden = false;
        err.textContent = e instanceof ConflictError ? e.message : `Couldn't publish: ${e.message}`;
      }
    };
    return [
      h('h3', {}, 'Publish to matthewfregnan.com'),
      h('p', {}, 'These changes will go live a minute or two after publishing:'),
      h('ul', {}, list.map(c => h('li', {}, c))),
      h('div', { class: 'field' }, h('label', {}, 'Note for the change history'), msg),
      err,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), go),
    ];
  });
}

// ---------------------------------------------------------------- Home Page editor

const HD = { current: null, adding: false, confirmDelete: false, q: '', displayOpen: false, seed: 1 };

// Project page layouts. Add new ones here and as templates/partials/project-<id>.ejs
const LAYOUTS = [
  { id: 'standard', name: 'Standard', hint: 'Client, production, role and year under the video.' },
  { id: 'detailed', name: 'Detailed', hint: 'Adds the description, “What I did”, “Made for” and credits (agency, deliverables).' },
];

function openHomeDialog() {
  HD.adding = false;
  HD.confirmDelete = false;
  go('home');
}

function editHome(fn) {
  mutate(fn);
  renderHomeDialog();
  if (S.current) {
    const box = $('#home-sets');
    if (box) box.replaceChildren(...homeCheckboxes(S.current));
  }
}

function newSetId(name) {
  const base = slugify(name) || 'set';
  let id = base;
  for (let n = 2; homeSet(id); n++) id = `${base}-${n}`;
  return id;
}

function thumbFor(p) {
  return p?.thumbnail
    ? I.withFallback(h('img', { src: I.src('thumbnails', p.thumbnail), alt: '' }), 'thumbnails', p.thumbnail)
    : h('span', { class: 'noimg' });
}

function renderHomeDialog() {
  const d = $('#page-home');
  if (S.page !== 'home' || !S.home) return;
  const keepScroll = [...d.querySelectorAll('.home-list')].map(el => el.scrollTop);
  const pageScroll = d.scrollTop;
  if (!homeSet(HD.current)) HD.current = S.home.active || S.home.sets[0]?.id;
  const set = homeSet(HD.current);
  const byKey = new Map(projects().map(p => [keyOf(p), p]));
  const setRows = S.home.sets.map(s => h('button', {
    class: `row set-row${s.id === HD.current ? ' selected' : ''}`,
    onclick: () => { HD.current = s.id; HD.adding = false; HD.confirmDelete = false; renderHomeDialog(); },
  }, h('span', { class: `dot ${s.id === S.home.active ? 'ok' : 'none'}` }),
  h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, s.name),
    h('span', { class: 'row-sub' }, `${(s.projects || []).length} projects${s.id === S.home.active ? ' · on the site' : ''}`))));

  const setTools = h('div', { class: 'vrow-tools' },
    h('button', { class: 'btn', onclick: () => {
      const id = newSetId('new-set');
      editHome(() => S.home.sets.push({ id, name: 'New set', tagline: '', projectLayout: 'standard', projects: [] }));
      HD.current = id; renderHomeDialog(); $('#hd-name')?.select();
    } }, 'New Set'),
    h('button', { class: 'btn', disabled: !set, onclick: () => {
      const id = newSetId(`${set.name} copy`);
      editHome(() => S.home.sets.push({ ...JSON.parse(JSON.stringify(set)), id, name: `${set.name} (copy)` }));
      HD.current = id; renderHomeDialog();
    } }, 'Duplicate'),
    h('button', { class: 'btn danger', disabled: !set || S.home.sets.length < 2, onclick: () => {
      if (!HD.confirmDelete) { HD.confirmDelete = true; renderHomeDialog(); return; }
      const id = set.id;
      editHome(() => {
        S.home.sets = S.home.sets.filter(x => x.id !== id);
        if (S.home.active === id) S.home.active = S.home.sets[0].id;
      });
      HD.confirmDelete = false; HD.current = S.home.active; renderHomeDialog();
    } }, HD.confirmDelete ? 'Click again to delete' : 'Delete'));

  let right;
  if (!set) {
    right = h('p', { class: 'muted' }, 'No sets yet.');
  } else if (HD.adding) {
    const search = h('input', { type: 'search', placeholder: 'Search projects…', value: HD.q,
      oninput: e => { HD.q = e.target.value; filter(); } });
    const picks = new Set();
    const items = projects().filter(p => !(set.projects || []).includes(keyOf(p))).map(p => {
      const cb = h('input', { type: 'checkbox', onchange: e => (e.target.checked ? picks.add(keyOf(p)) : picks.delete(keyOf(p))) });
      const el = h('label', { class: 'row pick' }, cb, thumbFor(p),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p.title), h('span', { class: 'row-sub' }, `${category(p.category).name} · ${p.client || ''}`)));
      el._hay = `${p.title} ${p.client} ${category(p.category).name}`.toLowerCase();
      return el;
    });
    const list = h('div', { class: 'home-list' }, items);
    function filter() { const q = HD.q.toLowerCase(); items.forEach(el => { el.hidden = q && !el._hay.includes(q); }); }
    filter();
    right = h('div', { class: 'home-right' },
      h('h4', {}, `Add to “${set.name}”`), search, list,
      h('div', { class: 'vrow-tools' },
        h('button', { class: 'btn', onclick: () => { HD.adding = false; renderHomeDialog(); } }, 'Back'),
        h('button', { class: 'btn primary', onclick: () => {
          const keys = projects().map(keyOf).filter(k => picks.has(k));
          if (keys.length) editHome(() => { homeSet(set.id).projects.push(...keys); });
          HD.adding = false; renderHomeDialog();
        } }, 'Add Selected')));
  } else {
    const live = set.id === S.home.active;
    right = h('div', { class: 'home-right' },
      h('div', { class: 'field' }, h('label', {}, 'Set name'),
        h('input', { id: 'hd-name', value: set.name, onchange: e => {
          const v = e.target.value.trim();
          if (v && v !== set.name) editHome(() => { homeSet(set.id).name = v; });
        } })),
      h('div', { class: 'field' }, h('label', {}, 'Line under your name (optional)'),
        h('input', { value: set.tagline || '', placeholder: S.home && 'Leave empty for your usual tagline', onchange: e => {
          const v = e.target.value.trim();
          if (v !== (set.tagline || '')) editHome(() => { homeSet(set.id).tagline = v; });
        } })),
      h('details', { class: 'display-settings', open: HD.displayOpen, ontoggle: e => { HD.displayOpen = e.target.open; } },
        h('summary', {}, 'Featured work section'),
        h('div', { class: 'display-grid' },
          h('label', {}, 'Heading'),
          h('input', { value: set.heading || '', placeholder: 'Featured Work', onchange: e => {
            const v = e.target.value.trim();
            editHome(() => { const s2 = homeSet(set.id); if (v) s2.heading = v; else delete s2.heading; });
          } }),
          h('label', {}, 'Order'),
          h('select', { onchange: e => editHome(() => { homeSet(set.id).order = e.target.value; }) },
            h('option', { value: 'landscape-first', selected: set.order !== 'social-first' }, 'Landscape first, then Social'),
            h('option', { value: 'social-first', selected: set.order === 'social-first' }, 'Social first, then landscape')),
          h('label', {}, 'Landscape row title'),
          h('input', { value: set.landscapeTitle || '', placeholder: 'None (optional)', onchange: e => {
            const v = e.target.value.trim();
            editHome(() => { const s2 = homeSet(set.id); if (v) s2.landscapeTitle = v; else delete s2.landscapeTitle; });
          } }),
          h('label', {}, 'Social row title'),
          h('input', { value: set.socialTitle || '', placeholder: 'None (optional)', onchange: e => {
            const v = e.target.value.trim();
            editHome(() => { homeSet(set.id).socialTitle = v; });
          } }),
          h('label', {}, 'Show'),
          h('div', { class: 'vrow-tools' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: set.showLandscape !== false,
              onchange: e => editHome(() => { const s2 = homeSet(set.id); if (e.target.checked) delete s2.showLandscape; else s2.showLandscape = false; }) }), 'Landscape work'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: set.showSocial !== false,
              onchange: e => editHome(() => { const s2 = homeSet(set.id); if (e.target.checked) delete s2.showSocial; else s2.showSocial = false; }) }), 'Social work')))),
      h('div', { class: 'field' }, h('label', {}, 'Project page layout'),
        h('select', { onchange: e => editHome(() => { homeSet(set.id).projectLayout = e.target.value; }) },
          LAYOUTS.map(l => h('option', { value: l.id, selected: (set.projectLayout || 'standard') === l.id }, l.name))),
        h('span', { class: 'muted small' }, (LAYOUTS.find(l => l.id === (set.projectLayout || 'standard')) || LAYOUTS[0]).hint)),
      h('div', { class: 'field' }, h('label', {}, 'Client logos'),
        h('select', { onchange: e => editHome(() => { const s2 = homeSet(set.id); if (e.target.value === 'corner') delete s2.logoPosition; else s2.logoPosition = e.target.value; }) },
          LOGO_POSITIONS.map(([id, name]) => h('option', { value: id, selected: (set.logoPosition || 'corner') === id }, name))),
        h('span', { class: 'muted small' }, 'Where client logos sit on the thumbnails, on every page.')),
      h('div', { class: 'vrow-tools' },
        h('button', { class: 'btn primary', disabled: live,
          onclick: () => editHome(() => { S.home.active = set.id; }) }, live ? 'This set is on the site' : 'Show This on the Site'),
        h('button', { class: 'btn', onclick: () => { HD.adding = true; HD.q = ''; renderHomeDialog(); } }, 'Add Projects…')),
      rowEditor(set, 'landscape', byKey),
      rowEditor(set, 'social', byKey));
  }

  const screenBtn = (id, label) => h('button', { class: `seg${S.screen === id ? ' on' : ''}`, onclick: () => { S.screen = id; renderHomeDialog(); } }, label);
  const preview = set ? h('div', { class: 'home-preview' },
    h('div', { class: 'preview-bar' },
      h('h4', {}, set.id === S.home.active ? 'Preview · on the site now' : 'Preview'),
      h('div', { class: 'segs' }, screenBtn('desktop', 'Laptop'), screenBtn('phone', 'Phone')),
      set.shuffle && set.featuredCount ? h('button', { class: 'btn', title: 'Show another random mix, like a new visitor would see',
        onclick: () => { HD.seed += 1; renderHomeDialog(); } }, '⤮ Shuffle Again') : null),
    h('div', { class: `preview-frame ${S.screen}` }, P.homePreview(h, {
      set, projects: projects().filter(p => !p.hidden), categories: S.data.categories, site: S.site, thumb: thumbSrc, screen: S.screen, seed: HD.seed,
      logo: p => (logoOf(p) ? I.src('logos', logoOf(p)) : ''), logoPosition: set.logoPosition,
      onPick: p => { clearSearchFor(p); select(p); },
    })),
    h('p', { class: 'hint' }, 'Click a project in the preview to edit it. Changes show here straight away; they go live when you Publish.')) : null;

  d.replaceChildren(h('div', { class: 'page-inner wide' },
    h('div', { class: 'page-head' }, h('h2', {}, 'Home Page'),
      h('p', { class: 'muted' }, 'Sets are different versions of the home page. Pick one to put on the site, e.g. one per kind of job you apply for.')),
    h('div', { class: 'home-page' },
      h('div', { class: 'home-left' }, h('h4', {}, 'Sets'), h('p', { class: 'muted small' }, 'The set with the green dot is on the site.'),
        h('div', { class: 'home-list' }, setRows), setTools),
      right,
      preview)));
  d.querySelectorAll('.home-list').forEach((el, i) => { el.scrollTop = keepScroll[i] || 0; });
  d.scrollTop = pageScroll;
}

// ---------------------------------------------------------------- project page preview

function renderProjectPreview() {
  const box = $('#project-preview');
  const p = S.current;
  if (!box || !p) return;
  const layout = S.previewLayout || liveLayout();
  const seg = (id, label, on, fn) => h('button', { class: `seg${on ? ' on' : ''}`, onclick: fn }, label);
  const inSets = S.home.sets.filter(s => (s.projects || []).includes(keyOf(p)));
  box.replaceChildren(
    h('div', { class: 'preview-bar' },
      h('div', { class: 'segs' },
        seg('desktop', 'Laptop', S.screen === 'desktop', () => { S.screen = 'desktop'; renderProjectPreview(); }),
        seg('phone', 'Phone', S.screen === 'phone', () => { S.screen = 'phone'; renderProjectPreview(); })),
      h('div', { class: 'segs', title: 'Project pages use the layout chosen by the home page set on the site' },
        LAYOUTS.map(l => seg(l.id, `${l.name}${l.id === liveLayout() ? ' (live)' : ''}`, layout === l.id,
          () => { S.previewLayout = l.id === liveLayout() ? null : l.id; renderProjectPreview(); }))),
      h('a', { class: 'btn', href: SITE + pagePath(p), target: '_blank', rel: 'noopener' }, 'Open Live Page')),
    h('div', { class: 'preview-cols' },
      h('div', { class: `preview-frame ${S.screen}` }, P.projectPreview(h, {
        project: p, category: category(p.category), layout, site: S.site, thumb: thumbSrc,
        still: path => I.src('gallery', path), screen: S.screen,
      })),
      h('div', { class: 'preview-side' },
        h('h4', {}, 'In lists'),
        h('div', { class: p.category === 'vertical' ? 'side-card v' : 'side-card' }, P.cardPreview(h, p, thumbSrc, q => (logoOf(q) ? I.src('logos', logoOf(q)) : ''), liveSet()?.logoPosition)),
        h('p', { class: 'muted small' }, `How it looks on the ${category(p.category).name} page${inSets.length ? ' and the home page' : ''}.`),
        h('h4', {}, 'Home page'),
        h('p', { class: 'small' }, inSets.length
          ? `In ${inSets.map(s => `“${s.name}”${s.id === S.home.active ? ' (live)' : ''}`).join(', ')}.`
          : 'Not in any home page set.'),
        !p.thumbnail ? h('p', { class: 'small warn' }, 'No thumbnail yet: lists show a frame from the video (or a blank tile).') : null,
        layout === 'detailed' && !p.description ? h('p', { class: 'small warn' }, 'No description: the Detailed layout looks best with a sentence or two.') : null)));
}

// ---------------------------------------------------------------- overview (opens first)

function attentionItems() {
  const items = [];
  const add = (p, kind, text) => items.push({ p, kind, text });
  for (const p of projects()) {
    const st = V.state(p);
    if (st === 'bad') add(p, 'bad', 'Video isn’t playing');
    else if (st === 'backup') add(p, 'backup', 'Playing its backup link');
    if (!V.ordered(p).length && !(p.gallery || []).length) add(p, 'bad', 'No video or stills');
    if (!p.thumbnail) add(p, 'backup', 'No thumbnail');
    if (liveLayout() === 'detailed' && !p.description && (liveSet()?.projects || []).includes(keyOf(p))) add(p, 'unknown', 'No description (live layout is Detailed)');
  }
  return items;
}

function renderOverview() {
  const el = $('#page-overview');
  if (S.page !== 'overview' || !S.data) return;
  const n = changes();
  const set = liveSet();
  const open = p => { clearSearchFor(p); S.editorTab = 'details'; select(p); };
  const card = (title, ...body) => h('section', { class: 'ov-card' }, h('h3', {}, title), ...body);
  const issues = attentionItems();
  const recent = [...projects()].filter(p => p.updated).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 5);
  const ago = iso => {
    const d = (Date.now() - new Date(`${iso}Z`).getTime()) / 1000;
    if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
    if (d < 86400) return `${Math.round(d / 3600)} h ago`;
    return new Date(`${iso}Z`).toLocaleDateString();
  };
  const projectLink = (p, sub) => h('button', { class: 'ov-row', onclick: () => open(p) },
    thumbFor(p), h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p.title || '(untitled)'), h('span', { class: 'row-sub' }, sub)));
  const active = S.uploads.filter(j => !j.finished);

  const homeKeys = new Set(set?.projects || []);
  const live = projects().filter(p => homeKeys.has(keyOf(p)));
  const land = live.filter(p => p.category !== 'vertical').length;
  const soc = live.length - land;
  const fc = parseInt(set?.featuredCount, 10) || 0;

  const storageBox = h('div', {}, h('p', { class: 'muted small' }, uploadConfig() ? 'Checking…' : 'Sign in to see storage.'));
  const trafficBox = h('div', {}, h('p', { class: 'muted small' }, 'Loading…'));
  const trafficCard = card('Visitors', trafficBox,
    h('div', { class: 'vrow-tools' }, h('button', { class: 'btn', onclick: () => go('traffic') }, 'View Traffic')));
  const storageCard = card('Video storage', storageBox,
    h('div', { class: 'vrow-tools' }, h('button', { class: 'btn', onclick: () => go('storage'), disabled: !uploadConfig() }, 'View Storage')));
  const checking = projects().some(p => V.state(p) === 'unknown');
  el.replaceChildren(h('div', { class: 'page-inner' },
    h('div', { class: 'page-head' }, h('h2', {}, 'Overview'),
      h('p', { class: 'muted' }, `${projects().length} projects on matthewfregnan.com`)),
    h('div', { class: 'ov-grid' }, h('div', { class: 'ov-col' },
      card(n.length ? `${n.length} unpublished change${n.length === 1 ? '' : 's'}` : 'Everything is live',
        n.length ? h('ul', { class: 'ov-changes' }, n.slice(0, 6).map(c => h('li', {}, c)), n.length > 6 ? h('li', { class: 'muted' }, `…and ${n.length - 6} more`) : null)
          : h('p', { class: 'muted' }, 'The site matches what you see here.'),
        active.length ? h('p', { class: 'small' }, `⬆ Uploading: ${active.map(j => j.title).join(', ')}`) : null,
        h('div', { class: 'vrow-tools' },
          n.length ? h('button', { class: 'btn primary', onclick: publish }, 'Publish') : null,
          h('button', { class: 'btn', onclick: () => go('projects') }, 'Edit Projects'))),
      card('Needs attention',
        issues.length ? h('div', { class: 'ov-list' }, issues.slice(0, 8).map(i => projectLink(i.p, h('span', {}, h('span', { class: `dot ${i.kind}` }), ` ${i.text}`))),
          issues.length > 8 ? h('p', { class: 'muted small' }, `…and ${issues.length - 8} more`) : null)
          : h('p', { class: 'muted' }, checking ? 'Checking videos…' : [h('span', { class: 'dot ok' }), ' Nothing to fix. Every video plays.']),
        h('div', { class: 'vrow-tools' }, h('button', { class: 'btn', onclick: checkVideos }, 'Check Videos Now'))),
      hiddenCard(card, open),
      statsCard(card, p => { clearSearchFor(p); S.editorTab = 'details'; select(p);
        setTimeout(() => $('.stats-box')?.scrollIntoView({ block: 'center' }), 50); }),
      trafficCard, storageCard), h('div', { class: 'ov-col' },
      card('Home page',
        h('p', {}, h('strong', {}, set?.name || '—'), h('span', { class: 'muted' }, ' is on the site')),
        h('p', { class: 'muted small' }, `${fc && fc < land ? `${fc} of ${land} landscape${set.shuffle ? ', shuffled' : ''}` : `${land} landscape`} · ${soc} social · ${LAYOUTS.find(l => l.id === liveLayout())?.name} project pages`),
        set ? h('div', { class: 'ov-mini', onclick: () => go('home'), title: 'Edit the home page' },
          P.homePreview(h, { set, projects: projects().filter(p => !p.hidden), categories: S.data.categories, site: S.site, thumb: thumbSrc, screen: 'desktop', seed: HD.seed, heroHeight: 300 })) : null,
        h('div', { class: 'vrow-tools' }, h('button', { class: 'btn', onclick: () => go('home') }, 'Edit Home Page'))),
      card('Projects',
        h('div', { class: 'ov-cats' }, S.data.categories.map(c => h('button', { class: 'ov-cat', onclick: () => { $('#filter').value = c.id; $('#search').value = ''; go('projects'); renderList(); } },
          h('strong', {}, String(projects().filter(p => p.category === c.id).length)), h('span', {}, c.name)))),
        recent.length ? [h('h4', {}, 'Recently edited'), h('div', { class: 'ov-list' }, recent.map(p => projectLink(p, `${category(p.category).name} · ${ago(p.updated)}`)))] : null,
        h('div', { class: 'vrow-tools' }, h('button', { class: 'btn', onclick: newFromLink }, 'New from Link'),
          h('button', { class: 'btn', onclick: () => newFromFile() }, 'New from Video File')))))));
  fillStorageSummary(storageBox);
  fillTrafficSummary(trafficBox);
}

async function loadStorage(force = false) {
  if (!force && S.storage && Date.now() - S.storage.at < 5 * 60 * 1000) return S.storage.data;
  const data = await U.usage(uploadConfig());
  S.storage = { data, at: Date.now() };
  return data;
}

async function fillStorageSummary(box) {
  if (!uploadConfig()) return;
  try {
    const data = await loadStorage();
    const pct = Math.min(100, (data.total / STORAGE_LIMIT) * 100);
    const level = pct >= 90 ? 'bad' : pct >= 70 ? 'backup' : 'ok';
    box.replaceChildren(h('p', {}, h('strong', {}, fmtBytes(data.total)), ` of 10 GB used (${pct.toFixed(0)}%)`),
      h('div', { class: `st-bar ${level}` }, h('span', { style: `width:${Math.max(pct, 0.5)}%` })),
      h('p', { class: 'muted small' }, `${data.objects.length} files · about ${fmtBytes(Math.max(0, STORAGE_LIMIT - data.total))} left`));
  } catch (e) {
    box.replaceChildren(h('p', { class: 'muted small' }, e.message));
  }
}

/**
 * One row of a home page set (featured projects or featured reels): how many show, shuffle,
 * pinned places, and the projects in order (drag to reorder within the row).
 */
function rowEditor(set, kind, byKey) {
  const social = kind === 'social';
  const keys = (set.projects || []).filter(k => byKey.get(k) && (byKey.get(k).category === 'vertical') === social);
  const items = keys.map(k => byKey.get(k));
  const settings = P.rowSettings(set, kind);
  const pinned = new Set(set.locked || []);
  const soft = new Set(set.soft || []);
  const plan = P.rowPlan(items.filter(p => !p.hidden), settings, pinned, 1, soft);
  const countKey = social ? 'reelsCount' : 'featuredCount';
  const shuffleKey = social ? 'reelsShuffle' : 'shuffle';
  const title = social ? 'Featured reels' : 'Featured projects';
  const hidden = social ? set.showSocial === false : set.showLandscape === false;

  // Reorder inside this row, keeping the other row's order as it is
  const reorder = (from, to) => editHome(() => {
    const s2 = homeSet(set.id);
    const mine = s2.projects.filter(k => keys.includes(k));
    const [moved] = mine.splice(from, 1);
    mine.splice(from < to ? to - 1 : to, 0, moved);
    const others = s2.projects.filter(k => !keys.includes(k));
    s2.projects = social ? [...others, ...mine] : [...mine, ...others];
  });
  // kind: 'locked' (pinned to its place), 'soft' (somewhere in the first places) or null (shuffled)
  const setPin = (key, kind) => editHome(() => {
    const s2 = homeSet(set.id);
    for (const list of ['locked', 'soft']) {
      const now = new Set(s2[list] || []);
      if (list === kind) now.add(key); else now.delete(key);
      s2[list] = s2.projects.filter(k => now.has(k));
      if (!s2[list].length) delete s2[list];
    }
  });
  let dragFrom = null;
  const rows = items.map((p, i) => {
    const key = keyOf(p);
    const status = p.hidden ? 'Not shown (hidden from the site)' : plan.status.get(key) || '';
    const isPinned = pinned.has(key);
    const isSoft = !isPinned && soft.has(key);
    const el = h('div', { class: `row home-item${status.startsWith('Not shown') ? ' is-off' : ''}`, draggable: true },
      h('span', { class: 'slot-num', title: 'Place in the row' }, String(i + 1)),
      h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'), thumbFor(p),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p.title),
        h('span', { class: 'row-sub' }, [category(p.category).name, status].filter(Boolean).join(' · '))),
      settings.shuffle ? h('button', {
        class: `btn link lock${isPinned ? ' on' : ''}`,
        title: isPinned ? `Pinned: always in place ${i + 1}. Click to let it shuffle.` : `Pin to place ${i + 1} so it’s always there`,
        'aria-pressed': String(isPinned),
        onclick: () => setPin(key, isPinned ? null : 'locked'),
      }, isPinned ? '📌 Pinned' : 'Pin') : null,
      settings.shuffle ? h('button', {
        class: `btn link lock${isSoft ? ' on' : ''}`,
        title: isSoft ? 'Soft pinned: always shown in the first places, in a random order with the other soft pins. Click to let it shuffle.'
          : 'Soft pin: always show it in the first places, but let its place among the other soft pins change',
        'aria-pressed': String(isSoft),
        onclick: () => setPin(key, isSoft ? null : 'soft'),
      }, isSoft ? '☆ Soft pinned' : 'Soft pin') : null,
      h('button', { class: 'btn link danger', title: 'Remove from this set', onclick: () => editHome(() => {
        const s2 = homeSet(set.id); s2.projects = s2.projects.filter(k => k !== key);
        for (const list of ['locked', 'soft']) if (s2[list]) { s2[list] = s2[list].filter(k => k !== key); if (!s2[list].length) delete s2[list]; }
      }) }, 'Remove'));
    el.addEventListener('dragstart', e => { dragFrom = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { if (dragFrom !== null && dragFrom !== i) { e.preventDefault(); el.classList.add('drop-above'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drop-above');
      if (dragFrom === null) return;
      const from = dragFrom; dragFrom = null;
      reorder(from, i);
    });
    return el;
  });
  // drop at the very end of the list
  const end = h('div', { class: 'row-end' });
  end.addEventListener('dragover', e => { if (dragFrom !== null) { e.preventDefault(); end.classList.add('drop-above'); } });
  end.addEventListener('dragleave', () => end.classList.remove('drop-above'));
  end.addEventListener('drop', e => { e.preventDefault(); end.classList.remove('drop-above'); if (dragFrom !== null) { const f = dragFrom; dragFrom = null; reorder(f, items.length); } });

  const options = [h('option', { value: '0', selected: !settings.count || settings.count >= items.length }, `All ${items.length}`)];
  for (let n = 1; n < items.length; n++) options.push(h('option', { value: String(n), selected: settings.count === n }, String(n)));
  const shownN = plan.count || items.length;
  const hint = !items.length ? `No ${social ? 'social' : 'landscape'} projects in this set yet. Use “Add Projects…”.`
    : settings.shuffle
      ? `${plan.pinned.size ? `${plan.pinned.size} pinned, ` : ''}${plan.soft.size ? `${plan.soft.size} soft pinned (always in the first free places, order shuffled), ` : ''}${shownN - plan.pinned.size - plan.soft.size > 0 ? `${shownN - plan.pinned.size - plan.soft.size} place${shownN - plan.pinned.size - plan.soft.size === 1 ? '' : 's'} filled at random from the rest on each visit` : 'every place is taken'}. Pin keeps a project in its exact place; soft pin keeps it near the front.`
      : `Shown in this order${plan.count ? ` (the top ${plan.count})` : ''}. Drag to reorder.`;
  return h('section', { class: `row-card${hidden ? ' is-hidden-row' : ''}` },
    h('div', { class: 'row-card-head' },
      h('h4', {}, title, h('span', { class: 'muted small' }, ` · ${items.length}`)),
      h('label', {}, 'Show ',
        h('select', { style: 'width:auto', disabled: !items.length, onchange: e => editHome(() => {
          const s2 = homeSet(set.id); const n = +e.target.value;
          if (n) s2[countKey] = n; else delete s2[countKey];
        }) }, options)),
      h('label', { class: 'check', title: 'Show a different mix on each visit' },
        h('input', { type: 'checkbox', checked: settings.shuffle, disabled: items.length < 2,
          onchange: e => editHome(() => { const s2 = homeSet(set.id); if (e.target.checked) s2[shuffleKey] = true; else delete s2[shuffleKey]; }) }),
        'Shuffle')),
    hidden ? h('p', { class: 'muted small' }, 'This row is hidden (Featured work section → Show).') : null,
    h('p', { class: 'muted small' }, hint),
    items.length ? h('div', { class: 'home-list' }, rows, end) : null);
}


// ---------------------------------------------------------------- video storage (Cloudflare R2)

const STORAGE_LIMIT = 10 * 1000 ** 3;   // R2 free plan: 10 GB
const SECTION_NAMES = { home: 'Home page background' };

function fmtBytes(n) {
  if (n >= 1000 ** 3) return `${(n / 1000 ** 3).toFixed(2)} GB`;
  if (n >= 1000 ** 2) return `${(n / 1000 ** 2).toFixed(n >= 100 * 1000 ** 2 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1000))} KB`;
}

/** Which project uses each stored file (matched by its address, ignoring ?v=). */
function storageKeyOf(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'videos.matthewfregnan.com' ? decodeURIComponent(u.pathname.slice(1)) : null;
  } catch { return null; }
}

function openStorage() { go('storage'); }

// ---------------------------------------------------------------- section page layouts (presets)
// Saved in home.json as sections: { <categoryId>: { active, presets: [{ id, name, order: [projectIds] }] } }.
// "Standard" (no preset) is the normal project order, the same as the Projects list.

const SP = { cat: null, preset: null, drag: null };

/** Hide a project from the site (it keeps its entry, video and place in layouts) or show it again. */
function setHidden(p, hide) {
  mutate(() => {
    if (hide) { p.hidden = true; p.hiddenSince = today(); } else { delete p.hidden; delete p.hiddenSince; }
    touch(p);
   }, { list: true, editor: true });
  toast(hide ? `“${p.title}” is hidden from the site after you publish.` : `“${p.title}” is back on the site after you publish.`);
}

function sectionLayout(catId) {
  return S.home.sections?.[catId] || { active: '', presets: [] };
}

function presetOrder(catId, preset) {
  const list = projects().filter(p => p.category === catId);
  if (!preset) return list;
  const rank = new Map((preset.order || []).map((id, i) => [id, i]));
  return [...list.filter(p => rank.has(p.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id)), ...list.filter(p => !rank.has(p.id))];
}

function editSections(catId, fn) {
  mutate(() => {
    S.home.sections ||= {};
    const lay = S.home.sections[catId] ||= { active: '', presets: [] };
    fn(lay);
    if (!lay.presets.length && !lay.active) delete S.home.sections[catId];
    if (!Object.keys(S.home.sections).length) delete S.home.sections;
  });
  renderSectionsPage();
}

function renderSectionsPage() {
  const page = $('#page-sections');
  if (S.page !== 'sections' || !S.data) return;
  SP.cat ||= S.data.categories.find(c => c.id === 'vertical')?.id || S.data.categories[0].id;
  const cat = category(SP.cat);
  const lay = sectionLayout(SP.cat);
  if (SP.preset && !lay.presets.some(p => p.id === SP.preset)) SP.preset = null;
  if (SP.preset === null && SP._for !== SP.cat) { SP.preset = lay.active || ''; }
  SP._for = SP.cat;
  const preset = lay.presets.find(p => p.id === SP.preset) || null;
  const items = presetOrder(SP.cat, preset);
  const vertical = SP.cat === 'vertical';
  const scroll = page.scrollTop;

  const uniqueId = name => { const base = slugify(name) || 'layout'; let id = base; for (let n = 2; lay.presets.some(p => p.id === id); n++) id = `${base}-${n}`; return id; };
  const newPreset = (name, order) => {
    const id = uniqueId(name);
    editSections(SP.cat, l => { l.presets.push({ id, name, order }); });
    SP.preset = id;
    renderSectionsPage();
  };
  const chip = (id, name) => h('button', { class: `chip${SP.preset === id ? ' on' : ''}`, onclick: () => { SP.preset = id; renderSectionsPage(); } },
    (lay.active || '') === id ? h('span', { class: 'dot ok', title: 'On the site' }) : null, ` ${name}`);

  const reorder = (from, to) => {
    if (!preset) {   // Standard: the real project order (same as dragging in the Projects list)
      const p = items[from];
      move(p, from < to ? to - 1 : to);
      renderSectionsPage();
      return;
    }
    editSections(SP.cat, l => {
      const pr = l.presets.find(x => x.id === preset.id);
      const order = items.map(p => p.id);
      const [m] = order.splice(from, 1);
      order.splice(from < to ? to - 1 : to, 0, m);
      pr.order = order;
    });
  };
  let shownN = 0;
  const tiles = items.map((p, i) => {
    const el = h('div', { class: `sp-tile${vertical ? ' v' : ''}${p.hidden ? ' is-hidden' : ''}`, draggable: true,
      title: p.hidden ? `${p.title} · hidden from the site${p.hiddenSince ? ` since ${p.hiddenSince}` : ''}` : `${p.title} · drag to move` },
      thumbFor(p),
      h('span', { class: 'sp-num' }, p.hidden ? 'Hidden' : String(++shownN)),
      h('div', { class: 'sp-title' }, h('b', {}, p.title || '(untitled)'), p.client ? h('small', {}, p.client) : null),
      h('div', { class: 'sp-tools' },
        i > 0 ? h('button', { class: 'btn', title: 'Move to the top', onclick: e => { e.stopPropagation(); reorder(i, 0); } }, '↑ Top') : null,
        h('button', { class: 'btn', title: p.hidden ? 'Show it on the site again' : 'Take it off the site but keep its entry (and video)',
          onclick: e => { e.stopPropagation(); setHidden(p, !p.hidden); renderSectionsPage(); } }, p.hidden ? 'Show' : 'Hide'),
        h('button', { class: 'btn', title: 'Edit this project', onclick: e => { e.stopPropagation(); clearSearchFor(p); select(p); } }, 'Edit')));
    el.addEventListener('dragstart', e => { SP.drag = i; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragend', () => { SP.drag = null; el.classList.remove('dragging'); });
    el.addEventListener('dragover', e => { if (SP.drag !== null && SP.drag !== i) { e.preventDefault(); el.classList.add('drop-before'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drop-before'); if (SP.drag !== null) { const f = SP.drag; SP.drag = null; reorder(f, i); } });
    return el;
  });
  const endDrop = h('div', { class: `sp-tile sp-end${vertical ? ' v' : ''}` }, h('span', { class: 'muted small' }, 'Drop here to move to the end'));
  endDrop.addEventListener('dragover', e => { if (SP.drag !== null) { e.preventDefault(); endDrop.classList.add('drop-before'); } });
  endDrop.addEventListener('dragleave', () => endDrop.classList.remove('drop-before'));
  endDrop.addEventListener('drop', e => { e.preventDefault(); endDrop.classList.remove('drop-before'); if (SP.drag !== null) { const f = SP.drag; SP.drag = null; reorder(f, items.length); } });

  const live = (lay.active || '') === (SP.preset || '');
  page.replaceChildren(h('div', { class: 'page-inner wide' },
    h('div', { class: 'page-head' }, h('h2', {}, 'Pages'),
      h('p', { class: 'muted' }, 'Arrange each section page and save the arrangement as a layout you can switch to, e.g. a gaming-first Social page.')),
    h('div', { class: 'preview-bar' },
      h('div', { class: 'segs' }, S.data.categories.map(c => h('button', { class: `seg${c.id === SP.cat ? ' on' : ''}`,
        onclick: () => { SP.cat = c.id; SP.preset = null; SP._for = null; renderSectionsPage(); } }, c.name)))),
    h('div', { class: 'sp-presets' },
      h('span', { class: 'muted small' }, 'Layouts:'),
      chip('', 'Standard order'),
      lay.presets.map(p => chip(p.id, p.name)),
      h('button', { class: 'btn', onclick: () => {
        const name = prompt('Name for the new layout (e.g. Gaming first):', preset ? `${preset.name} (copy)` : 'New layout');
        if (name && name.trim()) newPreset(name.trim(), items.map(p => p.id));
      } }, preset ? 'Duplicate…' : '+ Save as New Layout…'),
      preset ? h('button', { class: 'btn', onclick: () => {
        const name = prompt('Rename layout:', preset.name);
        if (name && name.trim()) editSections(SP.cat, l => { l.presets.find(x => x.id === preset.id).name = name.trim(); });
      } }, 'Rename…') : null,
      preset ? h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmDialog('Delete layout?', `Delete “${preset.name}”? (You can undo this.)`, 'Delete', true))) return;
        editSections(SP.cat, l => { l.presets = l.presets.filter(x => x.id !== preset.id); if (l.active === preset.id) l.active = ''; });
        SP.preset = '';
        renderSectionsPage();
      } }, 'Delete') : null,
      h('span', { class: 'tb-spacer' }),
      h('button', { class: 'btn primary', disabled: live, onclick: () => editSections(SP.cat, l => { l.active = SP.preset || ''; }) },
        live ? `This is on the ${cat.name} page` : `Put on the ${cat.name} page`)),
    h('p', { class: 'muted small' }, preset
      ? `Editing “${preset.name}”. Drag tiles (or use ↑ Top) to arrange it. New ${cat.name} projects are added at the end.`
      : `Standard order is the normal project order (the same as the Projects list). Drag to change it, or save it as a new layout first.`),
    h('div', { class: `sp-grid${vertical ? ' v' : ''}` }, tiles, endDrop)));
  page.scrollTop = scroll;
}

// ---------------------------------------------------------------- traffic (anonymous visit stats)

/** "Home", "About", "Social", or a project's title for a page address. */
function titleOfPath(path) {
  if (path === '/') return 'Home';
  const [slug, id] = path.split('/').filter(Boolean);
  const cat = S.data.categories.find(c => c.slug === slug);
  if (!cat) return slug === 'about' ? 'About' : slug === 'contact' ? 'Contact' : slug === 'my-work' ? 'All work' : path;
  if (!id) return `${cat.name} (section)`;
  const p = projects().find(x => x.category === cat.id && x.id === id);
  return p ? p.title : `${id} (removed)`;
}

function openPath(path) {
  const [slug, id] = path.split('/').filter(Boolean);
  const cat = S.data.categories.find(c => c.slug === slug);
  const p = cat && id && projects().find(x => x.category === cat.id && x.id === id);
  if (p) { clearSearchFor(p); select(p); } else window.open(SITE + path, '_blank', 'noopener');
}

async function loadTraffic(days, force = false) {
  const c = S.traffic[days];
  if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return c.data;
  const raw = await U.stats(uploadConfig(), days);
  const data = T.summarise(raw.rows, days);
  S.traffic[days] = { data, at: Date.now() };
  return data;
}

async function renderTrafficPage(force = false) {
  const page = $('#page-traffic');
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading visits…'));
  const seg = (d, label) => h('button', { class: `seg${S.trafficDays === d ? ' on' : ''}`, onclick: () => { S.trafficDays = d; renderTrafficPage(); } }, label);
  page.replaceChildren(h('div', { class: 'page-inner' },
    h('div', { class: 'page-head' }, h('h2', {}, 'Traffic'),
      h('p', { class: 'muted' }, 'Who’s looking at your site: visitors per day, what they watch, where they came from and how they move around.')),
    h('div', { class: 'preview-bar' },
      h('div', { class: 'segs' }, seg(7, 'Last 7 days'), seg(30, '30 days'), seg(90, '90 days'), seg(365, 'Year')),
      h('button', { class: 'btn', onclick: () => renderTrafficPage(true) }, 'Refresh')),
    body));
  if (!uploadConfig()) { body.replaceChildren(h('p', { class: 'muted' }, 'Sign in to see traffic.')); return; }
  try {
    const sum = await loadTraffic(S.trafficDays, force);
    body.replaceChildren(T.renderTraffic(h, sum, { titleOf: titleOfPath, onPath: openPath }));
  } catch (e) {
    body.replaceChildren(h('p', { class: 'error' }, e.message));
  }
}

async function fillTrafficSummary(box) {
  if (!uploadConfig()) { box.replaceChildren(h('p', { class: 'muted small' }, 'Sign in to see traffic.')); return; }
  try {
    const sum = await loadTraffic(7);
    const top = sum.pages.find(p => p.path !== '/');
    box.replaceChildren(
      h('p', {}, h('strong', {}, String(sum.totals.visitors)), ` visitor${sum.totals.visitors === 1 ? '' : 's'} in the last 7 days · ${sum.totals.views} page views`),
      T.sparkline(h, sum.daily),
      h('p', { class: 'muted small' }, sum.totals.views
        ? `Top source: ${sum.sources[0]?.name || '—'}${top ? ` · Most viewed: ${titleOfPath(top.path)}` : ''}`
        : 'No visits recorded yet.'));
  } catch (e) {
    box.replaceChildren(h('p', { class: 'muted small' }, e.message));
  }
}

async function renderStoragePage(force = false) {
  const page = $('#page-storage');
  const body = h('div', { class: 'storage' }, h('p', { class: 'muted' }, 'Looking at your video storage…'));
  page.replaceChildren(h('div', { class: 'page-inner' },
    h('div', { class: 'page-head' }, h('h2', {}, 'Video Storage'),
      h('p', { class: 'muted' }, 'Your videos are stored on Cloudflare (videos.matthewfregnan.com). The free plan includes 10 GB.')),
    h('div', { class: 'vrow-tools' },
      h('button', { class: 'btn', onclick: () => renderStoragePage(true) }, 'Refresh'),
      h('a', { class: 'btn', href: 'https://dash.cloudflare.com/?to=/:account/r2/default/buckets/matthewfregnan-videos', target: '_blank', rel: 'noopener' }, 'Open in Cloudflare')),
    body));
  const cfg = uploadConfig();
  if (!cfg) { body.replaceChildren(h('p', { class: 'muted' }, 'Sign in to see video storage.')); return; }
  let data;
  try {
    data = await loadStorage(force);
  } catch (e) {
    body.replaceChildren(h('p', { class: 'error' }, e.message));
    return;
  }
  const users = new Map();
  for (const p of projects()) {
    const k = p.videoFile && storageKeyOf(p.videoFile);
    if (k) users.set(k, p);
  }
  const files = data.objects.map(o => ({ ...o, project: users.get(o.key), section: o.key.split('/')[0] }));
  const pct = Math.min(100, (data.total / STORAGE_LIMIT) * 100);
  const level = pct >= 90 ? 'bad' : pct >= 70 ? 'backup' : 'ok';

  const sections = new Map();
  for (const f of files) {
    const s = sections.get(f.section) || { size: 0, count: 0 };
    s.size += f.size; s.count += 1;
    sections.set(f.section, s);
  }
  const sectionName = id => SECTION_NAMES[id] || S.data.categories.find(c => c.id === id)?.name || id;
  const unused = files.filter(f => !f.project && f.section !== 'home').sort((a, b) => b.size - a.size);
  const unusedSize = unused.reduce((n, f) => n + f.size, 0);
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 8);
  // An unused file is usually an older upload for a project: "category/project-id-<stamp>.mp4"
  const formerOwner = key => projects()
    .filter(p => key.startsWith(`${keyOf(p)}-`) || key === `${keyOf(p)}.mp4`)
    .sort((a, b) => b.id.length - a.id.length)[0];
  const name = f => {
    if (f.project) return f.project.title;
    const was = formerOwner(f.key);
    return was ? `${was.title} (older version)` : f.key.split('/').pop();
  };
  const fileRow = f => h('div', { class: 'st-row' },
    h('span', { class: 'st-name', title: f.key }, f.project
      ? h('a', { href: '#', onclick: e => { e.preventDefault(); clearSearchFor(f.project); select(f.project); } }, name(f))
      : name(f)),
    h('span', { class: 'muted small' }, new Date(f.uploaded).toLocaleDateString()),
    h('span', { class: 'st-size' }, fmtBytes(f.size)));

  body.replaceChildren(...[
    h('div', { class: 'st-total' },
      h('strong', {}, fmtBytes(data.total)), ` of 10 GB free storage used (${pct.toFixed(0)}%)`,
      h('div', { class: `st-bar ${level}` }, h('span', { style: `width:${Math.max(pct, 0.5)}%` })),
      h('div', { class: 'muted small' }, `${files.length} files · about ${fmtBytes(Math.max(0, STORAGE_LIMIT - data.total))} left. Your images are stored on GitHub and don’t count.`)),
    h('h4', {}, 'By section'),
    h('div', { class: 'st-list' }, [...sections].sort((a, b) => b[1].size - a[1].size).map(([id, s]) =>
      h('div', { class: 'st-row' }, h('span', { class: 'st-name' }, sectionName(id)),
        h('span', { class: 'muted small' }, `${s.count} file${s.count === 1 ? '' : 's'}`),
        h('span', { class: 'st-size' }, fmtBytes(s.size))))),
    h('h4', {}, 'Largest files'),
    h('div', { class: 'st-list' }, largest.map(fileRow)),
    unused.length ? [
      h('h4', {}, `Not used by any project: ${fmtBytes(unusedSize)}`),
      h('p', { class: 'muted small' }, 'Usually earlier versions of a video you replaced. They aren’t on the site; delete them in Cloudflare (R2 → matthewfregnan-videos) if you want the space back.'),
      h('div', { class: 'st-list' }, unused.map(fileRow)),
    ] : h('p', { class: 'muted small' }, 'Every video file is used by a project.')].flat());
}

function accountMenu() {
  const n = changes().length;
  dialog(close => [
    h('h3', {}, S.backend.demo ? 'Demo mode' : 'Signed in'),
    h('p', { class: 'muted' }, S.backend.demo
      ? 'You are trying the editor without signing in. Nothing you do here is saved to the site.'
      : `Your token is remembered in this browser only. Unpublished changes: ${n}.`),
    h('div', { class: 'actions' },
      n ? h('button', {
        class: 'btn danger',
        onclick: async () => {
          close();
          if (await confirmDialog('Discard unpublished changes?', `This throws away ${n} change(s) that aren't live yet.`, 'Discard', true)) {
            localStorage.removeItem(DRAFT_KEY);
            I.clearPending();
            location.reload();
          }
        },
      }, 'Discard Changes') : null,
      h('button', {
        class: 'btn',
        onclick: () => {
          GitHubBackend.forget();
          location.href = location.pathname;
        },
      }, S.backend.demo ? 'Exit Demo' : 'Sign Out'),
      h('button', { class: 'btn primary', onclick: close }, 'Close')),
  ]);
}

// =========================================================================== start-up

async function start(backend) {
  S.backend = backend;
  $('#loading').hidden = false;
  const { text, homeText, siteText, sha } = await backend.load();
  try { S.site = JSON.parse(siteText || '{}'); } catch { S.site = {}; }
  S.baseText = text;
  S.baseHomeText = homeText || DEFAULT_HOME;
  S.baseSha = sha;
  S.data = JSON.parse(text);
  S.home = JSON.parse(S.baseHomeText);

  // Bring back unpublished edits from last time (and their new images)
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && !!draft.demo === !!backend.demo) {
      S.data = JSON.parse(draft.text);
      S.home = JSON.parse(draft.homeText || S.baseHomeText);
      S.baseHomeText = draft.baseHomeText || S.baseHomeText;
      S.baseText = draft.baseText;
      S.baseSha = draft.baseSha;
      if (draft.baseSha !== sha && (draft.baseText !== text || (draft.baseHomeText || '') !== (homeText || DEFAULT_HOME))) {
        // Published elsewhere since the draft was made (e.g. a push from GitHub Desktop): bring the
        // draft up to date so it builds on the latest version. If parts clash, publishing explains.
        try {
          const merged = rebaseOnto(draft.text, draft.homeText || S.baseHomeText)({
            base: draft.baseText, baseHome: draft.baseHomeText || S.baseHomeText, theirs: text, theirsHome: homeText || DEFAULT_HOME });
          S.data = JSON.parse(merged.text);
          S.home = JSON.parse(merged.homeText);
          S.baseText = text;
          S.baseHomeText = homeText || DEFAULT_HOME;
          S.baseSha = sha;
        } catch { /* keep the draft as it was */ }
      }
      await I.restorePending();
      setTimeout(() => toast('Restored your unpublished changes.'), 300);
    }
  } catch { /* no usable draft */ }

  $('#signin').hidden = true;
  $('#loading').hidden = true;
  $('#app').hidden = false;
  $('#demo-badge').hidden = !backend.demo;
  $('#filter').replaceChildren(h('option', { value: '' }, 'All categories'),
    ...S.data.categories.map(c => h('option', { value: c.id }, c.name)));
  renderList();
  renderEditor();
  renderToolbar();
  go((location.hash || '').slice(1) || 'overview', { push: false });

  // Link checks finish in the background: refresh dots in one batch per frame, and never
  // rebuild the video panel while you're typing in it.
  let pendingRefresh = false;
  V.onChecked(url => {
    const mine = S.current && V.ordered(S.current).some(r => V.pageUrl(r) === url);
    if (!pendingRefresh) {
      pendingRefresh = true;
      requestAnimationFrame(() => {
        pendingRefresh = false;
        document.querySelectorAll('.row').forEach(r => {
          r.querySelector('.dot').className = `dot ${V.state(r._project) || 'none'}`;
        });
        if (S.page === 'overview' && !document.querySelector('#page-overview')?.contains(document.activeElement)) renderOverview();
      });
    }
    if (mine) {
      if ($('#video-card')?.contains(document.activeElement)) $('#vstate')?.replaceChildren(videoStateText(S.current));
      else renderVideo();
    }
  });
  // Quietly check links not checked in the last day
  projects().forEach(p => V.ordered(p).forEach(r => V.check(r)));
}

function wire() {
  window.addEventListener('beforeunload', e => {
    if (S.uploads.some(j => !j.finished)) { e.preventDefault(); e.returnValue = ''; }
  });
  $('#new-link').onclick = newFromLink;
  $('#new-file').onclick = () => newFromFile();
  // Drop a video file on the project list to start a new project from it
  const list = $('#list');
  list.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); list.classList.add('over'); } });
  list.addEventListener('dragleave', () => list.classList.remove('over'));
  list.addEventListener('drop', e => {
    list.classList.remove('over');
    const f = [...(e.dataTransfer.files || [])].find(U.looksLikeVideo);
    if (f) { e.preventDefault(); newFromFile(f); }
  });
  $('#new-blank').onclick = newBlank;
  $('#duplicate').onclick = duplicate;
  $('#delete').onclick = remove;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#check').onclick = checkVideos;
  document.querySelectorAll('#rail [data-page]').forEach(b => { b.onclick = () => go(b.dataset.page); });
  window.addEventListener('hashchange', () => { if (S.data) go(location.hash.slice(1), { push: false }); });
  $('#view').onclick = () => S.current && window.open(SITE + pagePath(S.current), '_blank', 'noopener');
  $('#publish').onclick = publish;
  $('#menu').onclick = accountMenu;
  $('#back').onclick = () => document.querySelector('.app').classList.remove('show-editor');
  $('#search').oninput = () => renderList();
  $('#filter').onchange = () => renderList();

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ($('#dialog').open || $('#app').hidden) return;
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      go('projects');
      $('#search').focus();
    } else if (!mod && !typing && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newFromLink();
    }
  });

  $('#signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#signin-error');
    const btn = e.target.querySelector('button[type="submit"]');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const gh = new GitHubBackend($('#token').value.trim());
    try {
      await gh.verify();
      gh.remember();
      $('#token').value = '';
      await start(gh);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

async function main() {
  wire();
  try {
    // Demo mode (loads the live data, never saves) is only for testing on this computer
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (local && params.has('demo')) {
      await start(new DemoBackend(params.get('data')));
      return;
    }
    const saved = GitHubBackend.saved();
    if (saved) {
      try {
        await saved.verify();
        await start(saved);
        return;
      } catch (e) {
        $('#signin-error').textContent = `Please sign in again: ${e.message}`;
        $('#signin-error').hidden = false;
      }
    }
  } catch (e) {
    $('#signin-error').textContent = e.message;
    $('#signin-error').hidden = false;
  }
  $('#loading').hidden = true;
  $('#signin').hidden = false;
  $('#token').focus();
}

main();
