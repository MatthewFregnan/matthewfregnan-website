// Portfolio Manager (web). Same layout and behaviour as the desktop app in /app:
// project list on the left, two-column editor on the right, edits kept as a draft
// in this browser until you press Publish (one commit to GitHub, live in 1–2 minutes).

import * as V from './video.js';
import * as I from './images.js';
import { ConflictError, DEFAULT_HOME, DemoBackend, GitHubBackend } from './github.js';

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
};

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
const slugify = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
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
  d.replaceChildren(...build(() => d.close()));
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
}

function usedImagePaths() {
  const used = new Set();
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
  for (const s of S.home.sets) {
    s.projects = (s.projects || []).flatMap(k => (k === oldKey ? (newKey ? [newKey] : []) : [k]));
  }
}

// =========================================================================== project actions

function select(p, { scroll = true } = {}) {
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
    ? I.withFallback(h('img', { src: I.src('thumbnails', p.thumbnail), alt: '', loading: 'lazy' }), 'thumbnails', p.thumbnail)
    : h('span', { class: 'noimg' });
  const el = h('button', {
    class: `row${p === S.current ? ' selected' : ''}`,
    draggable,
    onclick: () => select(p, { scroll: false }),
    title: `${p.client || ''}  ·  ${pagePath(p)}`,
  },
  h('span', { class: `dot ${state || 'none'}` }),
  img,
  h('span', { class: 'row-text' },
    h('span', { class: 'row-title' }, p.title || '(untitled)'),
    h('span', { class: 'row-sub' }, [p.client, p.year].filter(Boolean).join(' · ') || ' ')));
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
        h('button', { class: 'btn primary', onclick: newFromLink }, 'New from Link'))));
    return;
  }
  const scrollTop = ed.scrollTop;
  ed.replaceChildren(h('div', { class: 'editor-inner' },
    h('h2', { id: 'heading' }, p.title || '(untitled)'),
    h('div', { class: 'cols' },
      h('div', {}, detailsForm(p)),
      h('div', {},
        h('section', { class: 'card', id: 'video-card' }),
        h('section', { class: 'card', id: 'thumb-card' }),
        h('section', { class: 'card', id: 'gallery-card' })))));
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

  const slug = h('input', {
    id: 'f-id',
    value: p.id,
    onchange: e => {
      const id = uniqueId(slugify(e.target.value), p.category, p);
      e.target.value = id;
      if (id !== p.id) {
        mutate(() => {
          const oldKey = keyOf(p);
          p.id = id;
          renameRefs(oldKey, keyOf(p));
        });
        $('#url').textContent = `matthewfregnan.com${pagePath(p)}`;
        toast('Page address changed. Links to the old address will stop working.');
      }
    },
  });
  return h('div', { class: 'form' },
    lists,
    h('label', { for: 'f-title' }, 'Title'), textField(p, 'title'),
    h('label', { for: 'f-category' }, 'Category'), cat,
    h('label', { for: 'f-client' }, 'Client'), textField(p, 'client', { list: true, placeholder: 'e.g. Deakin University' }),
    h('label', { for: 'f-role' }, 'Role'), textField(p, 'role', { list: true, placeholder: 'e.g. Editor' }),
    h('label', { for: 'f-production' }, 'Production'), textField(p, 'production', { list: true, placeholder: 'e.g. ThinkHQ' }),
    h('label', { for: 'f-agency' }, 'Agency'), textField(p, 'agency', { list: true, placeholder: 'If you worked through an agency' }),
    h('label', { for: 'f-year' }, 'Year'), textField(p, 'year', { class: 'year', placeholder: 'YYYY', inputmode: 'numeric', digits: true }),
    h('label', { for: 'f-platform' }, 'Made for'), textField(p, 'platform', { list: true, placeholder: 'e.g. TV, YouTube, Social' }),
    h('label', { for: 'f-deliverables' }, 'Deliverables'), textField(p, 'deliverables', { placeholder: 'e.g. 30s TVC, 15s and 6s cutdowns, 9:16 versions' }),
    h('span'), h('div', { class: 'muted small' }, 'Agency, Made for, Deliverables and Description show on project pages when the live home page set uses the Detailed layout.'),
    h('label', { for: 'f-description', class: 'top' }, 'Description'),
    textField(p, 'description', { multiline: true, placeholder: 'A sentence or two about the project (helps Google too)' }),
    h('label', { for: 'f-id' }, 'Page address'), slug,
    h('span'), h('div', { class: 'url', id: 'url' }, `matthewfregnan.com${pagePath(p)}`),
    h('label', { class: 'top' }, 'Home page'), h('div', { id: 'home-sets', class: 'home-sets' }, homeCheckboxes(p)));
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

const GENERIC = 'Paste a video file, Vimeo, YouTube or Instagram link';
const PLACEHOLDER = {
  file: 'https://videos.matthewfregnan.com/…/name.mp4',
  vimeo: 'Vimeo link (unlisted share links work too)',
  youtube: 'YouTube link (video, Short or live)',
  instagram: 'Instagram post or reel link',
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
  const shape = active?.kind === 'instagram' ? 'instagram' : (p.category === 'vertical' ? 'vertical' : '');
  if (!player || player.dataset.src !== want || player.dataset.shape !== shape) {
    player = h('div', { class: `player ${shape}` });
    player.dataset.src = want;
    player.dataset.shape = shape;
    player.append(want
      ? (active.kind === 'file'
        ? h('video', { src: want, controls: true, preload: 'metadata', playsInline: true, poster: p.thumbnail ? I.src('thumbnails', p.thumbnail) : undefined })
        : h('iframe', { src: want, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowFullscreen: true, title: 'Video preview' }))
      : h('div', { class: 'player-empty' }, broken
        ? "This video can't play on the site. Fix it in Vimeo, or add a YouTube or Instagram backup below."
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
    tools.push(h('button', { class: 'btn link', onclick: () => { S.showBackups = true; renderVideo(); } }, '+ Add a backup link (Vimeo, YouTube or Instagram)'));
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

  card.replaceChildren(
    h('h4', {}, 'Video'),
    player,
    h('div', { class: 'sources' }, rows),
    h('div', { class: 'vrow-tools' }, tools),
    h('div', { class: 'vstate', id: 'vstate' }, videoStateText(p)),
    refs.length ? h('div', { class: 'vrow-tools' },
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: !!p.showStats,
        onchange: e => mutate(() => { if (e.target.checked) p.showStats = true; else delete p.showStats; }),
      }), 'Show view count on the project page'),
      h('button', {
        class: 'btn', onclick: useVideoDetails, disabled: !refs.some(r => r.kind !== 'file' && V.status(r)?.ok),
      }, 'Use Video’s Title, Year & Thumbnail')) : null,
  );
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
  renderVideo();
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
    card.replaceChildren(h('h4', {}, 'Thumbnail'), zone);
    return;
  }

  // With a thumbnail: click the picture to set its focus point (what crops keep in view).
  const focus = parseFocus(p.thumbFocus);
  const src = I.src('thumbnails', p.thumbnail);
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
    h('div', { class: 'thumb-tools' },
      h('button', { class: 'btn link', onclick: async () => setThumbnail(await pickFiles(false)) }, 'Replace'),
      p.thumbFocus ? h('button', { class: 'btn link', onclick: () => setFocus(50, 50) }, 'Reset focus') : null,
      h('button', { class: 'btn link', onclick: () => { mutate(() => { p.thumbnail = ''; delete p.thumbFocus; }, { list: true }); renderThumb(); } }, 'Remove')),
  );
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
    h('p', { class: 'hint' }, 'Drag to reorder · drop images from your computer to add'));
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
      info.replaceChildren(h('span'), h('span', { class: 'muted' }, link.value.trim() ? 'Not a video file, Vimeo, YouTube or Instagram link.' : ' '));
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
        const sha = await S.backend.save({ text, homeText, images, message: `${msg.value.trim() || 'Update portfolio'} (web)`, baseSha: S.baseSha });
        S.baseText = text;
        S.baseHomeText = homeText;
        S.baseSha = sha;
        I.markPublished();
        saveDraft();
        close();
        renderToolbar();
        toast(S.backend.demo ? 'Demo: nothing was saved.' : 'Published. The site updates in 1–2 minutes.', 6000);
      } catch (e) {
        go.disabled = false;
        go.textContent = 'Publish';
        err.hidden = false;
        err.textContent = e instanceof ConflictError
          ? `${e.message} Reload to get the latest version. Your edits here would be lost, so note anything you need first.`
          : `Couldn't publish: ${e.message}`;
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

const HD = { current: null, adding: false, confirmDelete: false, q: '' };

// Project page layouts. Add new ones here and as templates/partials/project-<id>.ejs
const LAYOUTS = [
  { id: 'standard', name: 'Standard', hint: 'Client, production, role and year under the video.' },
  { id: 'detailed', name: 'Detailed', hint: 'Adds the description, “What I did”, “Made for” and credits (agency, deliverables).' },
];

function openHomeDialog() {
  HD.current = S.home.active;
  HD.adding = false;
  HD.confirmDelete = false;
  const d = $('#dialog');
  d.classList.add('wide');
  d._home = true;
  d.addEventListener('close', () => { d._home = false; d.classList.remove('wide'); }, { once: true });
  renderHomeDialog();
  if (!d.open) d.showModal();
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
  const d = $('#dialog');
  if (!d._home) return;
  if (!homeSet(HD.current)) HD.current = S.home.active || S.home.sets[0]?.id;
  const set = homeSet(HD.current);
  const byKey = new Map(projects().map(p => [keyOf(p), p]));
  const close = () => d.close();

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
    let dragFrom = null;
    const rows = (set.projects || []).map((key, i) => {
      const p = byKey.get(key);
      const el = h('div', { class: 'row home-item', draggable: true },
        h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'), thumbFor(p),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, p ? p.title : `(missing: ${key})`),
          h('span', { class: 'row-sub' }, p ? category(p.category).name : '')),
        h('button', { class: 'btn link danger', title: 'Remove', onclick: () => editHome(() => {
          const s2 = homeSet(set.id); s2.projects = s2.projects.filter(k => k !== key);
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
        editHome(() => {
          const arr = homeSet(set.id).projects;
          const [moved] = arr.splice(from, 1);
          arr.splice(from < i ? i - 1 : i, 0, moved);
        });
      });
      return el;
    });
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
      h('div', { class: 'field' }, h('label', {}, 'Project page layout'),
        h('select', { onchange: e => editHome(() => { homeSet(set.id).projectLayout = e.target.value; }) },
          LAYOUTS.map(l => h('option', { value: l.id, selected: (set.projectLayout || 'standard') === l.id }, l.name))),
        h('span', { class: 'muted small' }, (LAYOUTS.find(l => l.id === (set.projectLayout || 'standard')) || LAYOUTS[0]).hint)),
      h('div', { class: 'vrow-tools' },
        h('button', { class: 'btn primary', disabled: live,
          onclick: () => editHome(() => { S.home.active = set.id; }) }, live ? 'This set is on the site' : 'Show This on the Site'),
        h('button', { class: 'btn', onclick: () => { HD.adding = true; HD.q = ''; renderHomeDialog(); } }, 'Add Projects…')),
      h('div', { class: 'home-list' }, rows.length ? rows : h('p', { class: 'muted' }, 'No projects yet. Use “Add Projects…”.')),
      h('p', { class: 'hint' }, 'Drag to reorder. Landscape projects show first on the site, then Social projects in their own row.'));
  }

  d.replaceChildren(
    h('h3', {}, 'Home Page'),
    h('div', { class: 'home-dialog' },
      h('div', { class: 'home-left' }, h('p', { class: 'muted small' }, 'The set with the green dot is on the site.'),
        h('div', { class: 'home-list' }, setRows), setTools),
      right),
    h('div', { class: 'actions' },
      h('span', { class: 'muted small', style: 'margin-right:auto' }, 'Changes go live when you Publish.'),
      h('button', { class: 'btn primary', onclick: close }, 'Done')));
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
  const { text, homeText, sha } = await backend.load();
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
  $('#new-link').onclick = newFromLink;
  $('#new-blank').onclick = newBlank;
  $('#duplicate').onclick = duplicate;
  $('#delete').onclick = remove;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#check').onclick = checkVideos;
  $('#home').onclick = openHomeDialog;
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
