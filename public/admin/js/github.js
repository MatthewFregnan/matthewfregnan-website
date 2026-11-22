// Reading and saving the portfolio through the GitHub API.
// Security: nothing secret lives in this page. Saving needs a GitHub token with write access
// to the repo, which only the owner can create. The token stays in this browser.

export const REPO = 'MatthewFregnan/matthewfregnan-website';
export const BRANCH = 'main';
export const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const DATA_PATH = 'data/projects.json';
const HOME_PATH = 'data/home.json';
const SITE_PATH = 'data/site.json';   // read only: name, tagline and hero picture for the previews
export const DEFAULT_HOME = JSON.stringify({ active: 'balanced', sets: [{ id: 'balanced', name: 'Balanced (default)', tagline: '', projects: [] }] }, null, 2) + '\n';
const TOKEN_KEY = 'pm-github-token';

export class ConflictError extends Error {}

// Who publishes are credited to on GitHub, whichever account's token is signed in: MatthewFregnan's
// private GitHub address (it can only ever count towards that account, and keeps a real email out of
// the history). The same identity is set in this repo's git config for commits made locally.
const COMMIT_AUTHOR = { name: 'MatthewFregnan', email: '259493985+MatthewFregnan@users.noreply.github.com' };

const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
const textToB64 = text => bytesToB64(new TextEncoder().encode(text));
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class GitHubBackend {
  constructor(token) {
    this.token = token;
    this.demo = false;
  }

  static saved() {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      return t ? new GitHubBackend(t) : null;
    } catch {
      return null;
    }
  }

  remember() {
    try { localStorage.setItem(TOKEN_KEY, this.token); } catch { /* private mode: sign in each visit */ }
  }

  static forget() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ }
  }

  async api(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      const err = new Error(`GitHub said ${res.status}: ${(await res.json().catch(() => ({}))).message || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  /** Confirms the token works and can save. Returns the user's login. */
  async verify() {
    let repo;
    try {
      repo = await this.api('');
    } catch (e) {
      if (e.status === 401) throw new Error("That token wasn't accepted. Check it was copied in full and hasn't expired.");
      if (e.status === 404) throw new Error(`That token can't see ${REPO}. When creating it, choose "Only select repositories" and pick this repo.`);
      throw e;
    }
    if (!repo.permissions?.push) {
      throw new Error('That token can read the repo but not save. Set Contents to "Read and write".');
    }
    return repo.owner?.login || '';
  }

  async head() {
    return (await this.api(`/git/ref/heads/${BRANCH}`)).object.sha;
  }

  async load() {
    const sha = await this.head();
    const file = await this.api(`/contents/${DATA_PATH}?ref=${sha}`);
    let siteText = '{}';
    try { siteText = b64ToText((await this.api(`/contents/${SITE_PATH}?ref=${sha}`)).content); } catch { /* previews use defaults */ }
    return { text: b64ToText(file.content), homeText: await this.readHome(sha), siteText, sha };
  }

  async readHome(ref) {
    try {
      return b64ToText((await this.api(`/contents/${HOME_PATH}?ref=${ref}`)).content);
    } catch (e) {
      if (e.status === 404) return DEFAULT_HOME;
      throw e;
    }
  }

  /** One commit containing the new projects.json, home.json and any new images. */
  async save({ text, homeText, images, message, baseSha, rebase }) {
    let head = await this.head();
    if (head !== baseSha) {
      // Something else was published since this page (or its saved draft) loaded: a push from GitHub
      // Desktop, the desktop app, another tab. If it touched the data files, `rebase` merges your
      // edits onto the new versions (and throws ConflictError if the same thing changed on both sides).
      const theirs = b64ToText((await this.api(`/contents/${DATA_PATH}?ref=${head}`)).content);
      const theirsHome = await this.readHome(head);
      const base = b64ToText((await this.api(`/contents/${DATA_PATH}?ref=${baseSha}`)).content);
      const baseHome = await this.readHome(baseSha);
      if (theirs !== base || theirsHome !== baseHome) {
        if (!rebase) throw new ConflictError('The project list was changed somewhere else since you opened this page.');
        ({ text, homeText } = rebase({ base, baseHome, theirs, theirsHome }));
      }
    }
    const baseTree = (await this.api(`/git/commits/${head}`)).tree.sha;
    const entries = [];
    const blob = async content => (await this.api('/git/blobs', {
      method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }),
    })).sha;
    for (const [path, data] of images) {
      entries.push({ path, mode: '100644', type: 'blob', sha: await blob(bytesToB64(new Uint8Array(await data.arrayBuffer()))) });
    }
    entries.push({ path: DATA_PATH, mode: '100644', type: 'blob', sha: await blob(textToB64(text)) });
    if (homeText) entries.push({ path: HOME_PATH, mode: '100644', type: 'blob', sha: await blob(textToB64(homeText)) });
    const tree = await this.api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
    const commit = await this.api('/git/commits', {
      method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head], author: COMMIT_AUTHOR }),
    });
    await this.api(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
    return { sha: commit.sha, text, homeText };
  }
}

/** Try the editor without signing in: loads the live data, never saves. */
export class DemoBackend {
  constructor(dataUrl) {
    this.demo = true;
    this.dataUrl = dataUrl || `${RAW}${DATA_PATH}`;
  }

  async verify() { return 'demo'; }

  async load() {
    const res = await fetch(this.dataUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Couldn't load the project list (${res.status})`);
    const home = await fetch(this.dataUrl.replace('projects.json', 'home.json'), { cache: 'no-store' });
    const site = await fetch(this.dataUrl.replace('projects.json', 'site.json'), { cache: 'no-store' }).catch(() => null);
    return { text: await res.text(), homeText: home.ok ? await home.text() : DEFAULT_HOME,
      siteText: site?.ok ? await site.text() : '{}', sha: 'demo' };
  }

  async save({ text, homeText, images }) {
    await new Promise(r => setTimeout(r, 600));
    console.info('[demo] would publish', images.size, 'image(s)');
    return { sha: 'demo', text, homeText };
  }
}
