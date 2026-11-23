// What I did on a project: the roles you tick in the editor. Saved in the project's "role" text, in this
// order, e.g. "Edit, Colour grade, Sound mix" (so the desktop app and older pages still read it). Older
// wording ("Editor", "Colourist") counts as the matching role. build.js has the same list, with icons.

export const ROLES = [
  { label: 'Edit', also: ['editor', 'editing', 'offline edit'] },
  { label: 'Colour grade', also: ['colourist', 'colorist', 'colour', 'color', 'colour grading', 'grade', 'grading'] },
  { label: 'Sound mix', also: ['sound', 'audio mix', 'mix', 'mixing'] },
  { label: 'Sound design', also: ['sfx'] },
  { label: 'Motion graphics', also: ['motion', 'mograph', 'animation', 'graphics'] },
  { label: 'VFX & clean-up', also: ['vfx', 'compositing', 'clean-up', 'cleanup'] },
  { label: 'Captions', also: ['subtitles', 'supers'] },
  { label: 'Cut-downs', also: ['cutdowns', 'cut downs', 'social cut-downs', 'versioning'] },
  { label: 'Finishing & delivery', also: ['finishing', 'online', 'delivery', 'mastering', 'conform'] },
  { label: 'Filming', also: ['camera', 'shooting', 'shot', 'videography', 'dop'] },
  { label: 'Directing', also: ['director', 'direction'] },
];

const norm = s => String(s).trim().toLowerCase();

/** The role text split into the list's labels (in list order), plus any wording that isn't on the list. */
export function parseRoles(text) {
  // split on commas, "+", "·", "/" and "&" (but not the "&" inside "VFX & clean-up")
  const parts = String(text || '').split(/\s*(?:,|&(?! clean)|\+|·|\/)\s*/).map(s => s.trim()).filter(Boolean);
  const picked = new Set();
  const other = [];
  for (const part of parts) {
    const n = norm(part);
    const role = ROLES.find(r => norm(r.label) === n || r.also.includes(n));
    if (role) picked.add(role.label); else if (!other.some(o => norm(o) === n)) other.push(part);
  }
  return { picked: ROLES.map(r => r.label).filter(l => picked.has(l)), other };
}

export function roleText(picked, other = []) {
  return [...ROLES.map(r => r.label).filter(l => picked.includes(l)), ...other].join(', ');
}
