// Three-way merge for the data files (projects.json, home.json), like git does for text.
//
// base   = the version this page (or its saved draft) started from
// ours   = the version with your unpublished edits
// theirs = what's on GitHub now (e.g. after a push from GitHub Desktop or the desktop app)
//
// Your changes are re-applied on top of theirs. Lists of things with an id (projects, categories,
// home page sets, layouts) and lists of plain values (a set's project keys) merge item by item, so
// adding/editing different projects on each side is fine. Only the same field changed differently
// on both sides is a conflict; those keep your value and are reported.

const canon = v => (v === undefined ? 'undefined' : JSON.stringify(v, (k, x) => (
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x)));
const same = (a, b) => canon(a) === canon(b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const label = x => (isObj(x) ? `“${x.title || x.name || x.id}”` : String(x));

function itemKey(x) {
  if (isObj(x)) return 'id' in x ? `o:${x.category ? `${x.category}/` : ''}${x.id}` : null;
  return Array.isArray(x) ? null : `v:${canon(x)}`;
}

function mergeValue(b, o, t, path, conflicts) {
  if (same(o, b)) return t;
  if (same(t, b) || same(o, t)) return o;
  if (isObj(o) && isObj(t)) {
    const base = isObj(b) ? b : {};
    const out = {};
    for (const k of [...new Set([...Object.keys(o), ...Object.keys(t)])]) {
      const v = mergeValue(base[k], o[k], t[k], [...path, k], conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(o) && Array.isArray(t)) {
    const merged = mergeList(Array.isArray(b) ? b : [], o, t, path, conflicts);
    if (merged) return merged;
  }
  conflicts.push(path);
  return o;
}

/** Item-by-item merge for lists whose items can be told apart; null if they can't. */
function mergeList(b, o, t, path, conflicts) {
  const keys = list => list.map(itemKey);
  const [bk, ok, tk] = [keys(b), keys(o), keys(t)];
  if ([...bk, ...ok, ...tk].some(k => k === null)) return null;
  if (new Set(ok).size !== ok.length || new Set(tk).size !== tk.length) return null;
  const bm = new Map(b.map((x, i) => [bk[i], x]));
  const tm = new Map(t.map((x, i) => [tk[i], x]));
  const om = new Map(o.map((x, i) => [ok[i], x]));
  const out = [];
  const outKeys = [];
  o.forEach((x, i) => {   // your order wins
    const k = ok[i];
    if (tm.has(k) || !bm.has(k)) {
      out.push(mergeValue(bm.get(k), x, tm.get(k), [...path, label(x)], conflicts));
      outKeys.push(k);
    } else if (!same(x, bm.get(k))) {   // they deleted it, you edited it: keep yours
      conflicts.push([...path, label(x)]);
      out.push(x);
      outKeys.push(k);
    }                                    // they deleted it and you didn't touch it: gone
  });
  t.forEach((x, i) => {
    const k = tk[i];
    if (om.has(k)) return;
    if (bm.has(k)) {                     // you deleted it
      if (!same(x, bm.get(k))) conflicts.push([...path, label(x)]);
      return;
    }
    // added on their side: put it after the item it follows there
    const prev = tk.slice(0, i).reverse().find(pk => outKeys.includes(pk));
    const at = prev ? outKeys.indexOf(prev) + 1 : 0;
    out.splice(at, 0, x);
    outKeys.splice(at, 0, k);
  });
  return out;
}

/** Merge JSON texts. Returns { text, conflicts: ['projects › “Title” › year', ...] }. */
export function mergeJsonText(baseText, oursText, theirsText) {
  const conflicts = [];
  const value = mergeValue(JSON.parse(baseText), JSON.parse(oursText), JSON.parse(theirsText), [], conflicts);
  return { text: `${JSON.stringify(value, null, 2)}\n`, conflicts: conflicts.map(p => p.join(' › ')) };
}
