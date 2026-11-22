// Tailored links (/for/<name>/): someone who arrived on one keeps seeing that version of the home page
// when they click Home or the name during the same visit.
document.addEventListener('DOMContentLoaded', () => {
  let home = null;
  try { home = sessionStorage.getItem('mf-home'); } catch { /* storage blocked */ }
  if (!home || !/^\/for\/[a-z0-9-]+\/$/.test(home)) return;
  document.querySelectorAll('a[href="/"]').forEach(a => a.setAttribute('href', home));
});

// Home page: the nav bar is clear while you're at the top of the hero, and solid once you scroll. Your
// name is already big in the hero, so the bar only shows it once that has scrolled out of sight.
document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('site-header');
  if (!header || !header.classList.contains('is-clear')) return;
  const big = document.querySelector('.hero h1');
  const update = () => {
    header.classList.toggle('at-top', window.scrollY < 24);
    header.classList.toggle('show-name', !big || big.getBoundingClientRect().bottom < header.offsetHeight);
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
});

// Phones: like iOS apps, the bar slides away while you scroll down (more room for the work) and comes
// straight back when you scroll up. Always shown at the very top and while the menu is open.
document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('site-header');
  if (!header) return;
  const phone = window.matchMedia('(max-width: 767px)');
  let lastY = window.scrollY;
  let ticking = false;
  const tuck = (on) => {
    header.classList.toggle('is-tucked', on);
    document.body.classList.toggle('nav-tucked', on);
  };
  const update = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY);
    const delta = y - lastY;
    const menuOpen = !document.getElementById('mobile-menu')?.classList.contains('hidden');
    if (!phone.matches || menuOpen || y < header.offsetHeight) tuck(false);
    else if (delta > 6) tuck(true);
    else if (delta < -6) tuck(false);
    if (Math.abs(delta) > 6 || y < header.offsetHeight) lastY = y;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  phone.addEventListener?.('change', () => tuck(false));
});

// Mobile menu toggle
document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.getElementById('menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const menuOpen = document.getElementById('menu-open');
  const menuClose = document.getElementById('menu-close');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.contains('hidden');

      if (isOpen) {
        mobileMenu.classList.remove('hidden');
        menuOpen?.classList.add('hidden');
        menuClose?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      } else {
        mobileMenu.classList.add('hidden');
        menuOpen?.classList.remove('hidden');
        menuClose?.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileMenu.classList.contains('hidden')) {
        mobileMenu.classList.add('hidden');
        menuOpen?.classList.remove('hidden');
        menuClose?.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });

    // Close menu when clicking a link
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        menuOpen?.classList.remove('hidden');
        menuClose?.classList.add('hidden');
        document.body.style.overflow = '';
      });
    });
  }
});

// =====================================================================================
// Video player
// - Hosted video files (videos.matthewfregnan.com) play in the site's own player: our thumbnail
//   and play button, then the video with a custom control bar over it. No ads, no branding.
// - Vimeo / YouTube / Instagram / TikTok (backups) use their normal embeds.
// - If the video in use fails, switch to the project's next working link.
// =====================================================================================

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  volume: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};

const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// true = plays, false = broken, null = can't tell (treat as fine)
async function sourcePlays(source) {
  if (!source.check) return null;
  try {
    const res = await fetch(source.check);
    if (res.ok) return true;
    return [401, 403, 404].includes(res.status) ? false : null;
  } catch {
    return null;
  }
}

class VideoPlayer {
  constructor(root) {
    this.root = root;
    this.sources = JSON.parse(root.dataset.videoSources || '[]');
    this.index = Number(root.dataset.active) || 0;
    this.vertical = root.dataset.vertical === 'true';
    this.poster = root.dataset.poster;
    this.title = root.dataset.title || 'video';
    this.shell = root.querySelector('.player-shell');
    this.container = root.querySelector('.video-container');

    const src = this.sources[this.index];
    if (src && src.kind === 'file') this.setupFile(this.container.querySelector('video'));
    else if (this.container.querySelector('iframe')) this.watchEmbed(this.container.querySelector('iframe'));
    else this.verify();
  }

  // Embeds: check the platform still has the video; if not, move to the next link.
  async verify() {
    const src = this.sources[this.index];
    if (this.sources.length > 1 && src && (await sourcePlays(src)) === false) this.fallback();
  }

  async fallback() {
    for (let i = this.index + 1; i < this.sources.length; i++) {
      if ((await sourcePlays(this.sources[i])) !== false) {
        this.mount(i);
        return;
      }
    }
  }

  mount(i) {
    this.index = i;
    const src = this.sources[i];
    const shape = src.kind === 'instagram' ? 'is-instagram' : (this.vertical || src.kind === 'tiktok' ? 'is-vertical' : '');
    for (const node of [this.shell, this.container]) {
      node.classList.remove('is-instagram', 'is-vertical');
      if (shape) node.classList.add(shape);
    }
    this.teardown();
    const stats = document.querySelector('.stats-fact');
    // Live counts belong to one source; numbers typed in the editor stay whichever video plays
    if (stats && !stats.hasAttribute('data-typed') && stats.dataset.statsKind !== src.kind) stats.remove();
    if (src.kind === 'file') {
      const v = document.createElement('video');
      v.src = src.embed;
      v.preload = 'metadata';
      v.playsInline = true;
      if (this.poster) v.poster = this.poster;
      this.container.replaceChildren(v);
      this.setupFile(v);
    } else {
      const f = document.createElement('iframe');
      f.src = src.embed;
      f.title = this.title;
      f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write';
      f.allowFullscreen = true;
      this.container.replaceChildren(f);
      this.watchEmbed(f);
      this.verify();
    }
  }

  /** Pressing play glides the player to the middle of the screen (and fits it on phones). */
  centre() {
    const r = this.shell.getBoundingClientRect();
    const navH = document.querySelector('header')?.offsetHeight || 64;
    const room = window.innerHeight - navH;
    const offset = r.height < room ? (room - r.height) / 2 : 0;
    const y = r.top + window.scrollY - navH - offset;
    const visible = r.top >= navH - 2 && r.bottom <= window.innerHeight + 2;
    // already fully on screen on a big screen: leave it
    if (visible && window.innerWidth >= 1024) return;
    if (Math.abs(y - window.scrollY) > 8 && typeof glideTo === 'function') glideTo(Math.max(0, y), 750);
    document.body.classList.add('video-playing');
  }

  /** Embeds (YouTube, Vimeo, Instagram, TikTok) can't tell us about play, but a click moves focus into them. */
  watchEmbed(frame) {
    const onBlur = () => setTimeout(() => { if (document.activeElement === frame) this.centre(); }, 0);
    window.addEventListener('blur', onBlur);
    (this.cleanup ||= []).push(() => window.removeEventListener('blur', onBlur));
  }

  // ------------------------------------------------------------------ hosted file
  setupFile(video) {
    this.video = video;
    // How far people watch (Traffic → Watching): a play, then 25%, 50%, 75% and the end, each counted
    // once per page view. Sent as made-up addresses like /watch/commercial/warning-levels/50/.
    const base = location.pathname.replace(/\/?$/, '/');
    const sent = new Set();
    const mark = (m) => { if (!sent.has(m)) { sent.add(m); window.mfTrack?.(`/watch${base}${m}/`); } };
    video.addEventListener('play', () => mark('start'));
    video.addEventListener('timeupdate', () => {
      const d = video.duration;
      if (!d || !isFinite(d)) return;
      const f = video.currentTime / d;
      for (const [at, m] of [[0.25, '25'], [0.5, '50'], [0.75, '75'], [0.97, 'end']]) if (f >= at) mark(m);
    });
    video.controls = false; // ours replace the browser's (they stay on if this script doesn't run)
    video.setAttribute('aria-label', this.title);
    this.shell.classList.add('custom-player', 'is-idle-start');

    const big = document.createElement('button');
    big.type = 'button';
    big.className = 'vp-big';
    big.setAttribute('aria-label', `Play ${this.title}`);
    big.innerHTML = ICONS.play;
    big.onclick = () => this.toggle();

    const bar = document.createElement('div');
    bar.className = 'vp-bar';
    bar.innerHTML = `
      <button class="vp-btn vp-play" type="button" aria-label="Play">${ICONS.play}</button>
      <span class="vp-time"><span class="vp-cur">0:00</span><span class="vp-sep"> / </span><span class="vp-dur">0:00</span></span>
      <input class="vp-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
      <button class="vp-btn vp-mute" type="button" aria-label="Mute">${ICONS.volume}</button>
      <input class="vp-vol" type="range" min="0" max="100" step="1" value="100" aria-label="Volume">
      <button class="vp-btn vp-fs" type="button" aria-label="Full screen">${ICONS.expand}</button>`;
    const veil = document.createElement('div');
    veil.className = 'vp-veil';
    this.container.append(veil, big, bar);
    this.big = big;
    this.bar = bar;

    const $ = (sel) => bar.querySelector(sel);
    const seek = $('.vp-seek');
    const vol = $('.vp-vol');
    vol.style.setProperty('--played', '100%');

    const on = (target, ev, fn) => {
      target.addEventListener(ev, fn);
      (this.cleanup ||= []).push(() => target.removeEventListener(ev, fn));
    };

    on(video, 'click', () => this.toggle());
    on(video, 'dblclick', () => this.toggleFullscreen());
    on(video, 'play', () => { this.setPlaying(true); this.centre(); });
    on(video, 'pause', () => this.setPlaying(false));
    on(video, 'ended', () => {
      this.setPlaying(false);
      video.currentTime = 0;
      video.load(); // back to the poster frame
      this.shell.classList.add('is-idle-start');
    });
    on(video, 'loadedmetadata', () => { $('.vp-dur').textContent = fmt(video.duration); });
    on(video, 'timeupdate', () => this.update());
    on(video, 'progress', () => this.update());
    on(video, 'waiting', () => this.shell.classList.add('is-buffering'));
    on(video, 'playing', () => this.shell.classList.remove('is-buffering'));
    on(video, 'volumechange', () => {
      if (this.ramping) return;
      const muted = video.muted || video.volume === 0;
      vol.value = muted ? 0 : Math.round(video.volume * 100);
      vol.style.setProperty('--played', `${vol.value}%`);
      $('.vp-mute').innerHTML = muted ? ICONS.muted : ICONS.volume;
      $('.vp-mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    });
    on(video, 'error', () => this.fallback());

    $('.vp-play').onclick = () => this.toggle();
    $('.vp-mute').onclick = () => { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = 1; };
    vol.oninput = () => { video.volume = vol.value / 100; video.muted = vol.value === '0'; };
    seek.oninput = () => {
      this.seeking = true;
      if (video.duration) video.currentTime = (seek.value / 1000) * video.duration;
      seek.style.setProperty('--played', `${seek.value / 10}%`);
      $('.vp-cur').textContent = fmt(video.currentTime);
    };
    seek.onchange = () => { this.seeking = false; };
    $('.vp-fs').onclick = () => this.toggleFullscreen();

    // Controls fade out while playing and come back on mouse movement / tap
    const wake = () => {
      this.shell.classList.remove('is-idle');
      clearTimeout(this.idleTimer);
      if (!video.paused) this.idleTimer = setTimeout(() => this.shell.classList.add('is-idle'), 1500);
    };
    on(this.shell, 'mousemove', wake);
    on(this.shell, 'mouseleave', () => {
      clearTimeout(this.idleTimer);
      if (!video.paused) this.shell.classList.add('is-idle');
    });
    on(this.shell, 'touchstart', wake);
    on(this.shell, 'focusin', wake);
    this.wake = wake;

    this.shell.tabIndex = 0;
    on(this.shell, 'keydown', (e) => {
      if (e.target.matches('input')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') { e.preventDefault(); this.toggle(); }
      else if (k === 'arrowright') { e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
      else if (k === 'arrowleft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
      else if (k === 'f') { e.preventDefault(); this.toggleFullscreen(); }
      else if (k === 'm') { e.preventDefault(); video.muted = !video.muted; }
      wake();
    });
    on(document, 'fullscreenchange', () => this.updateFsIcon());
    on(document, 'webkitfullscreenchange', () => this.updateFsIcon());
  }

  toggle() {
    const v = this.video;
    if (!v) return;
    if (!v.paused) {
      v.pause();
    } else if (this.shell.classList.contains('is-idle-start')) {
      this.start(); // first play (or replay after the end): smooth, slightly delayed start
    } else {
      const p = v.play(); // resuming after a pause stays instant
      if (p && p.catch) p.catch(() => {});
    }
  }

  // Ease into playback: the play button eases out and the picture dims, then after a short
  // pause the video starts, the picture fades back up and the sound fades in.
  start() {
    const v = this.video;
    if (this.starting) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      v.play().catch(() => {});
      return;
    }
    this.starting = true;
    this.shell.classList.add('is-starting');
    const targetVolume = v.muted ? null : v.volume;
    const finish = () => {
      this.shell.classList.remove('is-starting');
      this.starting = false;
    };
    setTimeout(async () => {
      if (targetVolume !== null) {
        this.ramping = true;
        v.volume = 0;
      }
      try {
        await v.play();
      } catch {
        if (targetVolume !== null) v.volume = targetVolume;
        this.ramping = false;
        finish();
        return;
      }
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        finish();
        if (targetVolume !== null) this.fadeVolume(targetVolume, 700);
      };
      // Fade up once the first real frame is on screen (or after 250 ms at the latest)
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => reveal());
      setTimeout(reveal, 250);
    }, 450);
  }

  fadeVolume(target, ms) {
    const v = this.video;
    const t0 = performance.now();
    clearInterval(this.fadeTimer);
    this.fadeTimer = setInterval(() => {
      if (!this.video || this.video !== v) { clearInterval(this.fadeTimer); return; }
      const k = Math.min(1, (performance.now() - t0) / ms);
      v.volume = target * (1 - Math.pow(1 - k, 2)); // ease out
      if (k >= 1) {
        clearInterval(this.fadeTimer);
        this.ramping = false;
        v.dispatchEvent(new Event('volumechange'));
      }
    }, 25);
  }

  setPlaying(playing) {
    this.shell.classList.toggle('is-playing', playing);
    if (playing) this.shell.classList.remove('is-idle-start');
    const btn = this.bar.querySelector('.vp-play');
    btn.innerHTML = playing ? ICONS.pause : ICONS.play;
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.wake();
  }

  update() {
    const v = this.video;
    const d = v.duration || 0;
    const seek = this.bar.querySelector('.vp-seek');
    let buffered = 0;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= v.currentTime) buffered = Math.max(buffered, v.buffered.end(i));
    }
    seek.style.setProperty('--buffered', `${d ? (buffered / d) * 100 : 0}%`);
    if (!this.seeking) {
      this.bar.querySelector('.vp-cur').textContent = fmt(v.currentTime);
      seek.value = d ? Math.round((v.currentTime / d) * 1000) : 0;
      seek.style.setProperty('--played', `${d ? (v.currentTime / d) * 100 : 0}%`);
    }
  }

  isFullscreen() {
    return document.fullscreenElement === this.shell || document.webkitFullscreenElement === this.shell;
  }

  toggleFullscreen() {
    const s = this.shell;
    if (this.isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (s.requestFullscreen || s.webkitRequestFullscreen) {
      (s.requestFullscreen || s.webkitRequestFullscreen).call(s);
    } else if (this.video.webkitEnterFullscreen) {
      this.video.webkitEnterFullscreen(); // iPhone: native full screen player
    }
  }

  updateFsIcon() {
    if (!this.bar) return;
    const on = this.isFullscreen();
    const btn = this.bar.querySelector('.vp-fs');
    btn.innerHTML = on ? ICONS.shrink : ICONS.expand;
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  }

  teardown() {
    (this.cleanup || []).forEach((fn) => fn());
    this.cleanup = [];
    clearTimeout(this.idleTimer);
    this.video?.pause?.();
    this.video = null;
    this.bar = null;
    this.ramping = false;
    this.starting = false;
    this.shell.classList.remove('custom-player', 'is-playing', 'is-idle', 'is-idle-start', 'is-buffering', 'is-starting');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.video-player[data-video-sources]').forEach((root) => {
    try {
      new VideoPlayer(root);
    } catch (e) {
      console.warn('Video player failed to start', e);
    }
  });
});

// Home page background video: keep it silent and still for people who prefer reduced motion,
// and make sure it starts on browsers that hold back autoplay until the page is visible.
document.addEventListener('DOMContentLoaded', () => {
  const hero = document.getElementById('hero-video');
  if (!hero) return;
  hero.muted = true;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => {
    if (reduce.matches) hero.pause();
    else hero.play().catch(() => {});
  };
  apply();
  reduce.addEventListener?.('change', apply);
});

// Home page backdrop: as you scroll past the hero, the showreel zooms in, blurs and darkens behind the
// work (see .hero-bg in src/styles.css). Reduced-motion: it just blurs and darkens, no zoom.
document.addEventListener('DOMContentLoaded', () => {
  const bg = document.getElementById('hero-bg');
  if (!bg) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let last = -1;
  let ticking = false;
  const update = () => {
    ticking = false;
    const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.7)));
    const q = Math.round(p * 200) / 200;
    if (q === last) return;
    last = q;
    bg.style.setProperty('--p', q);
    bg.classList.toggle('no-zoom', reduce.matches);
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
});

// Tile previews: a tile with a hosted video plays it silently and on a loop, while the mouse is over it
// (desktop) or, on the home page, while its row is in the middle of the screen (the first visible tile
// of the row nearest the centre; works on phones too). Only one plays at a time, and a video only
// loads when it's first needed. Off for reduced motion and data-saver.
const Previews = (() => {
  let current = null;
  const videoFor = (tile) => {
    let v = tile.querySelector('video.vp-preview');
    if (!v) {
      v = document.createElement('video');
      v.className = 'vp-preview';
      // iPhones only let a video start by itself if it's marked muted in its markup (the property alone
      // isn't enough): without these, previews waited for the first tap on the page.
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute('muted', '');
      v.setAttribute('autoplay', '');
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('disableremoteplayback', '');
      v.preload = 'auto';
      v.src = tile.dataset.preview;
      tile.insertBefore(v, tile.querySelector('.portfolio-item-title'));
    }
    return v;
  };
  // iPhones only let a page hold a few videos open at once, so a stopped preview is fully let go (after
  // its fade-out) rather than just paused; otherwise previews stop starting after the third or fourth.
  const release = (v) => {
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
  };
  const stop = (tile) => {
    if (!tile) return;
    tile.classList.remove('is-previewing');
    const v = tile.querySelector('video.vp-preview');
    if (v) setTimeout(() => { if (!tile.classList.contains('is-previewing') && current !== tile) release(v); }, 350);
    if (current === tile) current = null;
  };
  const play = (tile, restart = true) => {
    if (current === tile) return;
    stop(current);
    current = tile;
    const v = videoFor(tile);
    if (restart) v.currentTime = 0;
    v.play().then(() => { if (current === tile) tile.classList.add('is-previewing'); }).catch(() => {
      // couldn't start (e.g. the phone is still letting go of the last one): try once more shortly
      setTimeout(() => { if (current === tile) v.play().then(() => { if (current === tile) tile.classList.add('is-previewing'); }).catch(() => {}); }, 400);
    });
  };
  // Safety net: if a browser still held a preview back, start it on the first touch.
  const unlock = () => {
    if (current) { const v = current.querySelector('video.vp-preview'); if (v && v.paused) v.play().then(() => current?.classList.add('is-previewing')).catch(() => {}); }
  };
  window.addEventListener('touchstart', unlock, { passive: true, once: true });
  return { play, stop, get current() { return current; } };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (navigator.connection && navigator.connection.saveData) return;
  const tiles = [...document.querySelectorAll('[data-preview]')];
  if (!tiles.length) return;
  let hovered = null;

  // Scroll: the row nearest the middle of the screen plays its first visible tile
  const rows = [...document.querySelectorAll('.row-track')].filter(r => r.querySelector('[data-preview]'));
  let scrollPick = null;
  const pickFromScroll = () => {
    if (hovered) return;
    const mid = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (r.bottom < window.innerHeight * 0.15 || r.top > window.innerHeight * 0.85) continue;  // not really on screen
      const dist = Math.abs((r.top + r.bottom) / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = row; }
    }
    let tile = null;
    if (best) {
      tile = [...best.children].find(t => !t.hidden && t.dataset.preview && fullyIn(t, best)) || null;
    } else if (!rows.length && touch) {
      // Section and project pages on phones (no hover): the tile nearest where the eye rests, a little
      // above the middle, among tiles mostly in view between the menu bar and Safari's bottom bar.
      const top = document.querySelector('header')?.offsetHeight || 64;
      const bottom = window.innerHeight - 90;
      const focus = top + (bottom - top) * 0.42;
      let d = Infinity;
      for (const t of tiles) {
        const r = t.getBoundingClientRect();
        const seen = Math.min(r.bottom, bottom) - Math.max(r.top, top);
        if (seen < r.height * 0.6) continue;
        const dist = Math.abs((r.top + r.bottom) / 2 - focus);
        if (dist < d) { d = dist; tile = t; }
      }
    }
    if (tile !== scrollPick) pickTile(tile);
  };
  const touch = !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const fullyIn = (t, row) => {
    const box = row.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    return r.left >= box.left - 4 && r.right <= box.right + 4;
  };
  // Play a tile for the scroll position, and after 12 seconds move on to the next video in the row
  // (the next one on screen; on phones, where one fills the row, the row slides along to it).
  let advanceTimer = null;
  let dwellTimer = null;
  // Scrolling picks a tile, but it only starts once the page has been still for 0.9s: long enough to
  // take in the opening shot and read the title, and nothing starts while someone is scrolling past.
  const DWELL = 900;
  const pickTile = (tile, now = false) => {
    clearTimeout(advanceTimer);
    clearTimeout(dwellTimer);
    if (scrollPick && Previews.current === scrollPick) Previews.stop(scrollPick);
    scrollPick = tile;
    if (!tile) return;
    if (!now) {
      dwellTimer = setTimeout(() => { if (scrollPick === tile && !hovered) pickTile(tile, true); }, DWELL);
      return;
    }
    Previews.play(tile);
    const row = tile.closest('.row-track');
    if (!row) return;
    advanceTimer = setTimeout(() => {
      if (hovered || scrollPick !== tile || document.hidden) return;
      const list = [...row.children].filter(t => !t.hidden && t.dataset.preview);
      const next = list[list.indexOf(tile) + 1];
      if (next && fullyIn(next, row)) pickTile(next, true);
      else if (next && touch) row.scrollBy({ left: next.getBoundingClientRect().left - row.getBoundingClientRect().left, behavior: 'smooth' });   // the row's scroll picks it
      else pickTile(list.find(t => fullyIn(t, row)) || tile, true);
    }, 12000);
  };
  if (rows.length || touch) {
    let ticking = false;
    const onScroll = () => {
      // still moving: hold off starting the picked tile until the page settles
      if (scrollPick && Previews.current !== scrollPick) {
        clearTimeout(dwellTimer);
        const t = scrollPick;
        dwellTimer = setTimeout(() => { if (scrollPick === t && !hovered) pickTile(t, true); }, DWELL);
      }
      if (!ticking) { ticking = true; setTimeout(() => { ticking = false; pickFromScroll(); }, 120); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    rows.forEach(r => r.addEventListener('scroll', onScroll, { passive: true }));
    window.addEventListener('resize', onScroll);
    pickFromScroll();
  }

  // Mouse: hovering a tile plays it instead (after a moment, so passing over doesn't flicker)
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    tiles.forEach((tile) => {
      let timer = null;
      tile.addEventListener('mouseenter', () => {
        timer = setTimeout(() => { hovered = tile; Previews.play(tile, tile !== scrollPick); }, 300);
      });
      tile.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        if (hovered === tile) {
          hovered = null;
          if (tile !== scrollPick) Previews.stop(tile);
          scrollPick = null;
          pickFromScroll();
        }
      });
    });
  }
});

// Home page rows: arrows page through the row, and only show when there's more that way.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-scroller]').forEach((box) => {
    const track = box.querySelector('.row-track');
    // the first/last visible tiles grow inward on hover (see .row-first/.row-last in styles.css)
    const shown = [...track.children].filter(t => !t.hidden);
    shown[0]?.classList.add('row-first');
    shown[shown.length - 1]?.classList.add('row-last');
    const prev = box.querySelector('.scroller-btn.prev');
    const next = box.querySelector('.scroller-btn.next');
    // At the end of the row the arrow becomes "More <section>", for the section of the last video shown
    const more = document.createElement('a');
    more.className = 'scroller-more';
    more.hidden = true;
    box.append(more);
    const sectionOfLast = () => {
      const last = [...track.children].filter(t => !t.hidden && t.getAttribute('href')).pop();
      const slug = last && last.getAttribute('href').split('/').filter(Boolean)[0];
      if (!slug) return null;
      const navLink = document.querySelector(`header a[href="/${slug}/"]`);
      return { href: `/${slug}/`, name: navLink ? navLink.textContent.trim() : slug };
    };
    const update = () => {
      const before = track.scrollLeft > 4;
      const after = track.scrollLeft + track.clientWidth < track.scrollWidth - 4;
      prev.hidden = !before;
      next.hidden = !after;
      box.classList.toggle('more-before', before);
      box.classList.toggle('more-after', after);
      const section = !after && sectionOfLast();
      more.hidden = !section;
      if (section) {
        more.href = section.href;
        more.setAttribute('aria-label', `See more ${section.name} work`);
        more.innerHTML = `<span>More</span><span class="more-name"><span>&nbsp;${section.name}</span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
      }
    };
    const page = (dir) => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
    };
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
});

// Glide the page to a point: a quick, punchy start that "shoots" down, then a long soft settle
// (a cubic-bezier(0.7, 0, 0.12, 1) curve). Any wheel, touch or key press takes over straight away.
function glideTo(y, duration = 1150) {
  const startY = window.scrollY;
  const dist = y - startY;
  if (Math.abs(dist) < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo({ top: y, behavior: 'instant' });
    return;
  }
  const bez = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const ease = (x) => { // solve x(t) = x for the curve, then return y(t)
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) { t = (lo + hi) / 2; if (bez(t, 0.7, 0.12) < x) lo = t; else hi = t; }
    return bez(t, 0, 1);
  };
  let stopped = false;
  const stop = () => { stopped = true; };
  const opts = { passive: true, once: true };
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => window.addEventListener(ev, stop, opts));
  const t0 = performance.now();
  const step = (now) => {
    if (stopped) return;
    const x = Math.min(1, (now - t0) / duration);
    window.scrollTo({ top: startY + dist * ease(x), behavior: 'instant' });
    if (x < 1) requestAnimationFrame(step);
    else ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => window.removeEventListener(ev, stop));
  };
  requestAnimationFrame(step);
}

// Home page scroll nudge and "View my work": glide to the work, and fade the arrow out once the page scrolls.
document.addEventListener('DOMContentLoaded', () => {
  const cue = document.querySelector('.scroll-cue');
  if (!cue) return;
  const target = document.querySelector(cue.getAttribute('href'));
  document.querySelectorAll(`a[href="${cue.getAttribute('href')}"]`).forEach(link => link.addEventListener('click', (e) => {
    if (!target) return;
    e.preventDefault();
    const navH = document.querySelector('header')?.offsetHeight || 64;
    glideTo(target.getBoundingClientRect().top + window.scrollY - navH);
  }));
  const update = () => cue.classList.toggle('is-hidden', window.scrollY > 40);
  window.addEventListener('scroll', update, { passive: true });
  update();

  // After 12 seconds sitting at the top, glide down to the work on its own. Only once per visit:
  // if you scroll yourself (or come back up to the top), it leaves you alone for the rest of the visit.
  const KEY = 'mf-auto-scroll';
  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch { /* storage blocked: still fine */ }
  if (!target || seen || window.scrollY > 40 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const done = () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  let timer = setTimeout(() => {
    timer = null;
    if (window.scrollY > 40 || document.hidden) return;
    done();
    const navH = document.querySelector('header')?.offsetHeight || 64;
    glideTo(target.getBoundingClientRect().top + window.scrollY - navH, 1500);
  }, 12000);
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    done();
  };
  window.addEventListener('scroll', () => { if (window.scrollY > 40) cancel(); }, { passive: true });
  ['wheel', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, cancel, { passive: true, once: true }));
});

// "All work" section tiles: slowly crossfade through each tile's pictures, staggered so the
// tiles don't all change at once. Pauses while off screen; still for reduced-motion users.
document.addEventListener('DOMContentLoaded', () => {
  const tiles = [...document.querySelectorAll('.category-tile')];
  if (!tiles.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
  });
  tiles.forEach((t) => io.observe(t));
  const STEP = 4200;
  tiles.forEach((tile, i) => {
    const imgs = [...tile.querySelectorAll('.category-tile-images img')];
    if (imgs.length < 2) return;
    let n = 0;
    setTimeout(() => {
      setInterval(() => {
        if (!visible.has(tile) || document.hidden) return;
        imgs[n].classList.remove('is-on');
        n = (n + 1) % imgs.length;
        imgs[n].classList.add('is-on');
      }, STEP);
    }, (STEP / tiles.length) * (Number(tile.dataset.cycleOffset) || i));
  });
});

// Anonymous visit stats for the admin's Traffic page. No cookies and nothing that identifies a
// person: a random visit ID lives in this tab only (sessionStorage) and resets after 30 idle minutes.
// Skipped when the browser asks not to be tracked (Global Privacy Control / Do Not Track).
(() => {
  try {
    if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const testEndpoint = new URLSearchParams(location.search).get('track');
    if (local && testEndpoint) sessionStorage.setItem('mf_track', testEndpoint);
    const endpoint = local ? sessionStorage.getItem('mf_track') : 'https://upload.matthewfregnan.com';
    if (!endpoint) return;
    const now = Date.now();
    let visit = sessionStorage.getItem('mf_v');
    if (!visit || now - Number(sessionStorage.getItem('mf_t') || 0) > 30 * 60 * 1000) {
      visit = Math.random().toString(36).slice(2, 12) + now.toString(36);
      sessionStorage.setItem('mf_s', '0');
    }
    const seq = Number(sessionStorage.getItem('mf_s') || 0) + 1;
    sessionStorage.setItem('mf_v', visit);
    sessionStorage.setItem('mf_s', String(seq));
    sessionStorage.setItem('mf_t', String(now));
    const send = body => {
      const data = JSON.stringify(body);
      if (!(navigator.sendBeacon && navigator.sendBeacon(`${endpoint}/hit`, data))) {
        fetch(`${endpoint}/hit`, { method: 'POST', body: data, keepalive: true, mode: 'no-cors' }).catch(() => {});
      }
    };
    send({ t: 'view', v: visit, s: seq, p: location.pathname, r: seq === 1 ? document.referrer : '' });
    // Moments worth counting that aren't page loads (e.g. opening the contact panel): recorded as a
    // visit to a made-up address like "/contact/", so they show on the Traffic page as their own row.
    window.mfTrack = (path) => {
      const n = Number(sessionStorage.getItem('mf_s') || seq) + 1;
      sessionStorage.setItem('mf_s', String(n));
      send({ t: 'view', v: visit, s: n, p: path, r: '' });
    };
    // Time on page (only while the tab is visible), sent when they leave or switch away
    let shown = document.visibilityState === 'visible' ? performance.now() : null;
    let total = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (shown != null) { total += performance.now() - shown; shown = null; }
        sessionStorage.setItem('mf_t', String(Date.now()));
        if (total > 1000) send({ t: 'leave', v: visit, s: seq, secs: Math.round(total / 1000) });
      } else {
        shown = performance.now();
      }
    });
  } catch { /* stats are optional */ }
})();

// Phones and tablets, once the video has been played: a small pill under the menu bar.
//   scrolled past the video  -> "Back to video" (glides the player back to the middle of the screen)
//   video on screen, title scrolled away -> "Info" (back to the title and details)
document.addEventListener('DOMContentLoaded', () => {
  const title = document.querySelector('.pp-title, section h1');
  const shell = document.querySelector('.video-player .player-shell') || document.querySelector('.video-player');
  if (!title || !shell) return;
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>';
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'info-pill';
  document.body.append(pill);
  let mode = '';
  const navH = () => document.querySelector('header')?.offsetHeight || 64;
  const set = (m) => {
    if (m === mode) return;
    mode = m;
    if (m) {
      pill.innerHTML = `${arrow}<span>${m === 'video' ? 'Back to video' : 'Info'}</span>`;
      pill.setAttribute('aria-label', m === 'video' ? 'Scroll back to the video' : 'Show the project info');
    }
    pill.classList.toggle('is-shown', !!m);
  };
  pill.addEventListener('click', () => {
    if (mode === 'video') {
      const r = shell.getBoundingClientRect();
      const room = window.innerHeight - navH();
      const offset = r.height < room ? (room - r.height) / 2 : 0;
      glideTo(Math.max(0, r.top + window.scrollY - navH() - offset), 700);
    } else {
      glideTo(0, 700);
    }
  });
  const update = () => {
    if (window.innerWidth >= 1024 || !document.body.classList.contains('video-playing')) return set('');
    const top = navH();
    document.documentElement.style.setProperty('--nav-h', `${top}px`);   // the pill sits just under the bar
    const v = shell.getBoundingClientRect();
    if (v.bottom < top + v.height * 0.35) return set('video');   // most of the video is above the screen
    if (title.getBoundingClientRect().bottom < top) return set('info');
    set('');
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
});

// Contact panel (partials/footer.ejs): links marked data-contact open it instead of jumping straight to a
// mail app, which does nothing for people without one set up. Copy the address, open Mail, or LinkedIn.
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('contact-panel');
  if (!panel || typeof panel.showModal !== 'function') return;   // old browsers: the links stay email links
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-contact]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    // close the phone menu first, if it's open
    const menu = document.getElementById('mobile-menu');
    if (menu && !menu.classList.contains('hidden')) document.getElementById('menu-toggle')?.click();
    panel.showModal();
    window.mfTrack?.('/contact/');   // counted on the admin's Traffic page
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target.closest('[data-close]')) panel.close();   // backdrop or ×
  });
  const copy = panel.querySelector('[data-copy]');
  copy?.addEventListener('click', async () => {
    const email = panel.querySelector('[data-email]').textContent.trim();
    try {
      await navigator.clipboard.writeText(email);
    } catch {
      const r = document.createRange(); r.selectNodeContents(panel.querySelector('[data-email]'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy');
    }
    copy.textContent = 'Copied';
    copy.classList.add('is-done');
    setTimeout(() => { copy.textContent = 'Copy'; copy.classList.remove('is-done'); }, 1800);
  });
});

// Back to top: shows once the footer comes into view, glides to the top.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('[data-to-top]');
  const footer = btn?.closest('footer');
  if (!btn || !footer) return;
  const pageIsShort = () => document.documentElement.scrollHeight < window.innerHeight * 1.6;
  new IntersectionObserver(([e]) => btn.classList.toggle('is-shown', e.isIntersecting && !pageIsShort()))
    .observe(footer);
  btn.addEventListener('click', () => glideTo(0, 900));
});

// Page transitions: name the tile you tap, so it grows into the video on the project page (styles.css).
document.addEventListener('click', (e) => {
  const tile = e.target.closest('a.portfolio-item, a.portfolio-item-vertical');
  if (!tile || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; });
  // the playing preview if there is one (the thumbnail is hidden under it), else the thumbnail
  const media = (tile.classList.contains('is-previewing') && tile.querySelector('video.vp-preview'))
    || tile.querySelector('img:not(.card-logo), video.card-still') || tile;
  media.style.viewTransitionName = 'project-media';
});
// coming back with the Back button: clear the name so the next tap starts fresh
window.addEventListener('pageshow', () => {
  document.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; });
});

// Section pages: client filter chips. Picking a client shows only their work (and ?client=name in the
// address, so a filtered page can be linked); All shows everything again.
document.addEventListener('DOMContentLoaded', () => {
  const box = document.querySelector('.client-chips');
  if (!box) return;
  const tiles = [...document.querySelectorAll('[data-client]')].filter(t => !t.closest('.more-work'));
  const apply = (client) => {
    box.querySelectorAll('.client-chip').forEach(c => c.classList.toggle('is-on', c.dataset.chip === client));
    tiles.forEach(t => t.classList.toggle('is-filtered-out', !!client && t.dataset.client !== client));
    const url = new URL(location.href);
    if (client) url.searchParams.set('client', client); else url.searchParams.delete('client');
    history.replaceState(null, '', url);
    window.dispatchEvent(new Event('scroll'));   // let the playing preview re-pick
  };
  box.addEventListener('click', (e) => {
    const chip = e.target.closest('.client-chip');
    if (chip) apply(chip.classList.contains('is-on') && chip.dataset.chip ? '' : chip.dataset.chip);
  });
  const start = (new URLSearchParams(location.search).get('client') || '').toLowerCase();
  if (start && box.querySelector(`[data-chip="${CSS.escape(start)}"]`)) apply(start);
});

// Home hero logos on phones: swipe them to see more clients faster. They keep drifting on their own
// (by scrolling, so a swipe just carries on from wherever it is), pause while touched, and loop.
document.addEventListener('DOMContentLoaded', () => {
  const strip = document.querySelector('.hero-clients');
  const track = strip?.querySelector('.hero-clients-track');
  if (!strip || !track || !window.matchMedia('(hover: none)').matches) return;
  strip.classList.add('is-swipe');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let held = false;
  let resumeAt = 0;
  let last = performance.now();
  let pos = strip.scrollLeft;
  const SPEED = 22;   // pixels per second, about the same pace as the desktop drift
  const half = () => track.scrollWidth / 2;   // the logos are in there twice, so looping is seamless
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!held && now > resumeAt && !reduce) {
      pos += SPEED * dt;
      if (pos >= half()) pos -= half();
      strip.scrollLeft = pos;
    } else {
      pos = strip.scrollLeft;
      if (pos >= half()) { pos -= half(); strip.scrollLeft = pos; }
    }
    requestAnimationFrame(tick);
  };
  strip.addEventListener('touchstart', () => { held = true; }, { passive: true });
  strip.addEventListener('touchend', () => { held = false; resumeAt = performance.now() + 1500; }, { passive: true });
  strip.addEventListener('scroll', () => { if (held || performance.now() < resumeAt) pos = strip.scrollLeft; }, { passive: true });
  requestAnimationFrame(tick);
});

// Phones, home page: swipe up (or tap) the "Hi, I'm Matthew" bar at the end of the page to open a sheet
// with a photo, a line about you, About me and Get in touch. Drag it down, tap outside or press Esc to close.
document.addEventListener('DOMContentLoaded', () => {
  const sheet = document.getElementById('about-sheet');
  const peek = document.querySelector('.about-peek');
  if (!sheet || !peek) return;
  document.documentElement.classList.add('has-about-sheet');
  const panel = sheet.querySelector('.about-sheet-panel');
  const open = () => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
    window.mfTrack?.('/about-sheet/');   // counted on Traffic
  };
  const close = () => {
    sheet.classList.remove('is-open', 'is-dragging');
    sheet.style.removeProperty('--drag');
    document.body.style.overflow = '';
    setTimeout(() => { if (!sheet.classList.contains('is-open')) sheet.hidden = true; }, 400);
  };
  // the bar: tap, or swipe up on it
  let startY = null;
  peek.addEventListener('click', open);
  peek.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  peek.addEventListener('touchmove', (e) => {
    if (startY != null && startY - e.touches[0].clientY > 24) { startY = null; open(); }
  }, { passive: true });
  // the sheet: drag down to close (or back up if not far enough)
  let dragFrom = null;
  panel.addEventListener('touchstart', (e) => { dragFrom = e.touches[0].clientY; sheet.classList.add('is-dragging'); }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (dragFrom == null) return;
    sheet.style.setProperty('--drag', `${Math.max(0, e.touches[0].clientY - dragFrom)}px`);
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (dragFrom == null) return;
    const moved = e.changedTouches[0].clientY - dragFrom;
    dragFrom = null;
    sheet.classList.remove('is-dragging');
    if (moved > 80) close(); else sheet.style.removeProperty('--drag');
  });
  sheet.querySelector('[data-sheet-close]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) close(); });
  // Get in touch: close this so the contact panel opens on its own
  sheet.querySelector('[data-contact]')?.addEventListener('click', close);
});
