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
  constructor(root, { video: given } = {}) {
    this.root = root;
    this.sources = JSON.parse(root.dataset.videoSources || '[]');
    this.index = Number(root.dataset.active) || 0;
    this.vertical = root.dataset.vertical === 'true';
    this.poster = root.dataset.poster;
    this.title = root.dataset.title || 'video';
    this.shell = root.querySelector('.player-shell');
    this.container = root.querySelector('.video-container');

    const src = this.sources[this.index];
    if (src && src.kind === 'file' && given) {
      // a video that's already playing (the home page's preview, moved in): it carries straight on
      const old = this.container.querySelector('video');
      for (const a of ['muted', 'autoplay', 'disablepictureinpicture', 'disableremoteplayback']) given.removeAttribute(a);
      given.defaultMuted = false;
      given.loop = false;
      if (this.poster) given.poster = this.poster;
      old.replaceWith(given);   // same task as it left the tile, so it never pauses
      this.setupFile(given, true);
      if (!given.paused) this.setPlaying(true);
    } else if (src && src.kind === 'file') this.setupFile(this.container.querySelector('video'));
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
    if (this.root.closest('.pm')) return;   // in the home page's project window: it's already in view
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
  setupFile(video, handed = false) {
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
      <input class="vp-vol" type="range" min="0" max="100" step="1" value="${PLAYER_VOLUME * 100}" aria-label="Volume">
      <button class="vp-btn vp-fs" type="button" aria-label="Full screen">${ICONS.expand}</button>`;
    const veil = document.createElement('div');
    veil.className = 'vp-veil';
    this.container.append(veil, big, bar);
    this.big = big;
    this.bar = bar;

    const $ = (sel) => bar.querySelector(sel);
    const seek = $('.vp-seek');
    const vol = $('.vp-vol');
    if (!handed) video.volume = PLAYER_VOLUME;   // a handed-over video fades its own sound up (project window)
    vol.style.setProperty('--played', `${PLAYER_VOLUME * 100}%`);

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
    if (!handed) this.resume();
  }

  // Arrived by clicking a playing preview of this same video: carry on from that moment. It starts by
  // itself where the browser allows sound to (it usually does right after a click); otherwise it waits
  // there, and pressing play continues from that point.
  resume() {
    let r = null;
    try { r = JSON.parse(sessionStorage.getItem('mf-resume') || 'null'); sessionStorage.removeItem('mf-resume'); } catch { return; }
    const v = this.video;
    if (!r || !v || r.path !== location.pathname || Date.now() - r.at > 20000) return;
    if (r.src !== v.currentSrc.split('#')[0] && r.src !== (v.getAttribute('src') || '').split('#')[0]) return;   // the preview was a separate clip
    const go = () => {
      v.currentTime = Math.max(0, r.t - 0.3);
      this.update();
      this.start();
    };
    v.preload = 'auto';
    if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
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

  // Start light, then go sharp: the page opens with a small copy of the video so it starts quickly on
  // slow connections. Once the page has loaded and the video has played for a few seconds, the sharper
  // copy downloads quietly behind it, is lined up to the same moment in the footage, and fades in over
  // the top; the light one is then let go. Skipped for Data Saver / 2G and reduced motion.
  const want = window.matchMedia('(max-width: 767px)').matches ? (hero.dataset.upgradeMobile || hero.dataset.upgrade) : hero.dataset.upgrade;
  const net = navigator.connection;
  if (!want || reduce.matches || (net && (net.saveData || /(^|-)2g$/.test(net.effectiveType || '')))) return;
  const once = (el, ev) => new Promise(res => el.addEventListener(ev, res, { once: true }));
  const upgrade = async () => {
    const hi = document.createElement('video');
    hi.className = hero.className;
    hi.muted = true; hi.defaultMuted = true; hi.setAttribute('muted', '');
    hi.loop = true; hi.playsInline = true; hi.setAttribute('playsinline', '');
    hi.setAttribute('disablepictureinpicture', ''); hi.setAttribute('disableremoteplayback', '');
    hi.tabIndex = -1;
    hi.preload = 'auto';
    hi.style.opacity = '0';
    hi.style.transition = 'opacity 1.2s ease';
    hi.src = want;
    hero.after(hi);
    await once(hi, 'canplaythrough');
    // pick a moment just ahead of the playing copy, wait there, and start both together
    const d = hero.duration || hi.duration;
    while (d && hero.currentTime > d - 3) await new Promise(r => setTimeout(r, 1000));   // near the loop point: let it come round
    const at = hero.currentTime + 0.8;
    hi.currentTime = at;
    await once(hi, 'seeked');
    await new Promise((res) => {
      const tick = () => (hero.currentTime >= at - 0.02 || hero.currentTime < at - 2 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    try { await hi.play(); } catch { hi.remove(); return; }
    if (Math.abs(hi.currentTime - hero.currentTime) > 0.15) hi.currentTime = hero.currentTime;
    hi.style.opacity = '1';
    setTimeout(() => {
      const old = hero;
      hi.id = 'hero-video';
      hi.poster = old.getAttribute('poster') || '';
      old.pause();
      old.removeAttribute('src');
      old.load();
      old.remove();
      hi.style.transition = '';
    }, 1300);
  };
  const begin = () => setTimeout(() => { if (!document.hidden) upgrade().catch(() => {}); else document.addEventListener('visibilitychange', begin, { once: true }); }, 4000);
  const whenPlaying = () => (hero.paused ? once(hero, 'playing') : Promise.resolve());
  const whenLoaded = () => (document.readyState === 'complete' ? Promise.resolve() : once(window, 'load'));
  Promise.all([whenPlaying(), whenLoaded()]).then(begin);
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
const PREVIEW_VOLUME = 0.6;
const RESUME_GRACE = 3000;   // a preview left and come back to within this long carries on where it was
const PLAYER_VOLUME = 0.8;   // project page videos start a little under full volume (the slider goes up)
// The home page's floating project window is open (or opening): previews and the rows hold still behind it
const pmActive = () => document.documentElement.classList.contains('pm-active');
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
    // remember where it got to, so coming back within a few seconds (say the mouse strayed onto the
    // next video by accident) carries on from there instead of starting over
    if (v && v.currentTime > 0.5) tile._resumeAt = { t: v.currentTime, at: performance.now() };
    if (v && !v.muted) fadeSound(v, false, 400);   // the sound eases out with the picture
    if (v) setTimeout(() => { if (!tile.classList.contains('is-previewing') && current !== tile) release(v); }, 500);   // after the fade
    if (current === tile) current = null;
  };
  // Sound: previews start silent; the speaker button on the playing tile turns sound on for this visit
  // (browsers only allow sound after you've tapped something, which the button is).
  let soundOn = false;
  const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';
  const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
  const soundButton = (tile) => {
    let b = tile.querySelector('.vp-sound');
    if (!b) {
      b = document.createElement('span');
      b.className = 'vp-sound';
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
      const toggle = (e) => {
        e.preventDefault();
        e.stopPropagation();   // the tile is a link; this mustn't open the project
        const v = tile.querySelector('video.vp-preview');
        soundOn = !soundOn;
        mutedAt = 0;   // turned off (or on) by hand: the mouse doesn't bring it back
        if (v) {
          if (soundOn) {
            fadeSound(v, true);
            v.play().catch(() => { soundOn = false; v.muted = true; showSound(tile); });
          } else {
            fadeSound(v, false);
          }
        }
        showSound(tile);
      };
      b.addEventListener('click', toggle);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
      tile.append(b);
    }
    return b;
  };
  // Sound fades in and out (about 0.6s) rather than switching abruptly. iPhones don't let pages change
  // a video's volume, so there it simply switches.
  // Previews play a bit quieter than full volume (PREVIEW_VOLUME), easier on the ears while browsing.
  const fadeSound = (v, on, ms = 600) => {
    cancelAnimationFrame(v._fade);
    const was = v.volume;
    v.volume = 0.5;
    const canFade = Math.abs(v.volume - 0.5) < 0.01;
    if (!canFade) { v.muted = !on; return; }
    const from = on ? 0 : (v.muted ? 0 : was);
    v.volume = from;
    if (on) v.muted = false;
    const t0 = performance.now();
    const step = (now) => {
      const x = Math.min(1, (now - t0) / ms);
      const eased = x * x * (3 - 2 * x);
      v.volume = on ? eased * PREVIEW_VOLUME : from * (1 - eased);
      if (x < 1) v._fade = requestAnimationFrame(step);
      else if (!on) { v.muted = true; v.volume = PREVIEW_VOLUME; }
    };
    v._fade = requestAnimationFrame(step);
  };
  const showSound = (tile) => {
    const b = soundButton(tile);
    b.innerHTML = soundOn ? ICON_ON : ICON_OFF;
    b.setAttribute('aria-label', soundOn ? 'Mute' : 'Turn sound on');
    b.classList.toggle('is-on', soundOn);
  };
  // Start a preview. If the browser refuses (a phone still letting go of the last video, or sound not
  // allowed yet), try again a few times, falling back to silent, so a preview always gets going.
  const start = (tile, v, tries = 0) => {
    if (current !== tile) return;
    v.muted = true;
    v.play().then(() => {
      if (soundOn && current === tile) {
        fadeSound(v, true);
        // phones may pause a video that turns its sound on by itself: carry on silently instead
        setTimeout(() => { if (current === tile && v.paused) { soundOn = false; v.muted = true; v.play().catch(() => {}); showSound(tile); } }, 200);
      }
      if (current !== tile) return;
      tile.classList.add('is-previewing');
      showSound(tile);
    }).catch(() => {
      if (current !== tile || tries >= 4) return;
      setTimeout(() => start(tile, v, tries + 1), 250 * (tries + 1));
    });
  };
  // Opening a project from a playing preview: its page carries on from the same moment (see setupFile)
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('a[data-preview]');
    const v = tile && tile.querySelector('video.vp-preview');
    if (!v || v.paused || v.currentTime < 0.5 || e.defaultPrevented) return;
    try {
      sessionStorage.setItem('mf-resume', JSON.stringify({
        path: new URL(tile.href, location.href).pathname, src: tile.dataset.preview.split('#')[0],
        t: v.currentTime, sound: soundOn, at: Date.now(),
      }));
    } catch { /* private browsing: start from the beginning as usual */ }
  });
  const play = (tile, restart = true) => {
    if (current === tile || pmActive()) return;
    stop(current);
    current = tile;
    const v = videoFor(tile);
    const back = tile._resumeAt && performance.now() - tile._resumeAt.at < RESUME_GRACE ? tile._resumeAt.t : null;
    tile._resumeAt = null;
    if (back !== null) v.currentTime = back;
    else if (restart) v.currentTime = 0;
    start(tile, v);
  };
  // Safety net: if a browser still held a preview back, start it on the first touch.
  const unlock = () => {
    if (current) { const v = current.querySelector('video.vp-preview'); if (v && v.paused) start(current, v); }
  };
  window.addEventListener('touchstart', unlock, { passive: true, once: true });
  // Turn sound off (fading out), e.g. when the mouse leaves the tile that had it on. If the mouse comes
  // back onto a video within a few seconds the sound comes back too (resume), so it follows the mouse
  // rather than needing the button again.
  const GRACE = 3000;
  let mutedAt = 0;
  const mute = (tile) => {
    if (!soundOn) return;
    soundOn = false;
    mutedAt = performance.now();
    const v = tile && tile.querySelector('video.vp-preview');
    if (v && !v.muted) fadeSound(v, false);
    if (tile) showSound(tile);
  };
  const resume = (tile) => {
    if (soundOn || !mutedAt || performance.now() - mutedAt > GRACE) return;
    soundOn = true;
    mutedAt = 0;
    const v = tile.querySelector('video.vp-preview');
    if (v && current === tile && !v.paused) fadeSound(v, true);   // a new video fades its sound in as it starts
    showSound(tile);
  };
  // The home page's project window takes the playing preview itself (it carries on playing, now bigger,
  // instead of a fresh copy loading from the start): the tile lets go of it without stopping it.
  const handOff = (tile) => {
    const v = tile && current === tile && tile.querySelector('video.vp-preview');
    if (!v || v.paused || v.readyState < 2) return null;
    cancelAnimationFrame(v._fade);
    v.classList.remove('vp-preview');
    v.style.viewTransitionName = '';
    tile.classList.remove('is-previewing');
    current = null;
    return { video: v, sound: soundOn && !v.muted };
  };
  return { play, stop, mute, resume, handOff, get current() { return current; } };
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
      // only a row at least half on screen (above Safari's floating bar on phones), so the first row
      // peeking in under the hero doesn't start playing before you've scrolled to it
      const seen = Math.min(r.bottom, window.innerHeight - (touch ? 90 : 0)) - Math.max(r.top, 0);
      if (seen < r.height * 0.5) continue;
      const dist = Math.abs((r.top + r.bottom) / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = row; }
    }
    // Phones: a row you've just swiped stays the one that plays, while it's still on screen
    if (touch && swipedRow && performance.now() - swipedAt < 8000) {
      const r = swipedRow.getBoundingClientRect();
      if (r.bottom > window.innerHeight * 0.1 && r.top < window.innerHeight * 0.9) best = swipedRow;
    }
    let tile = null;
    if (best && touch) {
      // the tile settled in the middle of the row (rows snap to the centre on phones)
      const box = best.getBoundingClientRect();
      const centre = (box.left + box.right) / 2;
      let d = Infinity;
      for (const t of best.children) {
        if (t.hidden || !t.dataset.preview) continue;
        const r = t.getBoundingClientRect();
        const seen = Math.min(r.right, box.right) - Math.max(r.left, box.left);
        if (seen < r.width * 0.6) continue;
        const dist = Math.abs((r.left + r.right) / 2 - centre);
        if (dist < d) { d = dist; tile = t; }
      }
    } else if (best) {
      tile = [...best.children].find(t => !t.hidden && t.dataset.preview && fullyIn(t, best)) || null;
      // a tile picked with the dots (or the row moving on by itself) stays while it's mostly in view
      if (chosen && (chosen.parentElement === best || performance.now() - chosenAt < 1500) && mostlyIn(chosen)) tile = chosen;
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
  // the row last swiped on a phone (so its tile plays even if another row is nearer the middle)
  let swipedRow = null;
  let swipedAt = 0;
  rows.forEach(r => r.addEventListener('touchstart', () => { swipedRow = r; swipedAt = performance.now(); }, { passive: true }));
  // Phones: once a swipe has settled (the row stops moving), the tile in the middle plays straight away
  rows.forEach(r => r.addEventListener('touchend', () => {
    let last = r.scrollLeft;
    let still = 0;
    const settle = () => {
      if (r.scrollLeft === last) still += 1; else { still = 0; last = r.scrollLeft; }
      if (still < 3) { setTimeout(settle, 60); return; }
      swipedRow = r; swipedAt = performance.now();
      pickFromScroll();
      if (scrollPick && Previews.current !== scrollPick) pickTile(scrollPick, true);
    };
    setTimeout(settle, 60);
  }, { passive: true }));
  const mostlyIn = (t) => {
    const row = t.parentElement;
    const box = row.getBoundingClientRect(), r = t.getBoundingClientRect();
    const v = row.getBoundingClientRect();
    if (v.bottom < window.innerHeight * 0.1 || v.top > window.innerHeight * 0.9) return false;
    return Math.min(r.right, box.right) - Math.max(r.left, box.left) >= r.width * 0.6;
  };
  const fullyIn = (t, row) => {
    const box = row.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    return r.left >= box.left - 4 && r.right <= box.right + 4;
  };
  // Play a tile for the scroll position, and after ADVANCE move on to the next video in the row
  // (sliding the row along to it; after the last it goes back to the first).
  let advanceTimer = null;
  let dwellTimer = null;
  // How long an auto-playing preview runs before the row moves on: 8 seconds with a mouse (a hovered
  // video stays as long as the mouse does), 12 on phones, where you watch rather than browse
  const ADVANCE = touch ? 12000 : 8000;
  let chosen = null;
  let chosenAt = 0;
  // Play a tile in a row, sliding the row so it's in view (to the middle on phones, where the row's
  // scroll then picks it; on desktop only if it isn't already showing).
  const goTo = (tile) => {
    const row = tile.parentElement;
    const box = row.getBoundingClientRect(), r = tile.getBoundingClientRect();
    const dx = (r.left + r.right) / 2 - (box.left + box.right) / 2;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (touch) {
      swipedRow = row; swipedAt = performance.now();
      if (Math.abs(dx) > 2) row.scrollBy({ left: dx, behavior: reduce ? 'auto' : 'smooth' });
      else pickTile(tile, true);
      return;
    }
    // the video moves into the second place in the row (the first one stays put at the start, and the
    // row can't scroll past its ends), so the row keeps sliding along as it plays through
    const list = [...row.children].filter(t => !t.hidden);
    const step = list.length > 1 ? list[1].getBoundingClientRect().left - list[0].getBoundingClientRect().left : r.width;
    const slot = box.left + (list.indexOf(tile) > 0 ? step : 0);
    const shift = r.left - slot;
    if (Math.abs(shift) > 2) row.scrollBy({ left: shift, behavior: reduce ? 'auto' : 'smooth' });
    chosen = tile; chosenAt = performance.now();
    pickTile(tile, true);
  };
  // Dots under each home page row (Apple-style): one per video; the long one is the video playing and
  // fills while it plays (ADVANCE). Click one to jump to that video.
  const dotRows = [];
  rows.forEach((row) => {
    const box = row.closest('[data-scroller]');
    const list = [...row.children].filter(t => !t.hidden && t.dataset.preview);
    if (!box || list.length < 2) return;
    const pill = document.createElement('div');
    pill.className = 'row-dots';
    const dots = list.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'row-dot';
      b.setAttribute('aria-label', `Play ${t.querySelector('h2')?.textContent.trim() || 'video'}`);
      b.innerHTML = '<b><i></i></b>';
      b.addEventListener('click', () => goTo(t));
      return b;
    });
    pill.append(...dots);
    const wrap = document.createElement('div');
    wrap.className = 'row-dots-wrap';
    wrap.append(pill);
    box.after(wrap);
    box.classList.add('has-dots');
    dots[0].classList.add('on');
    dotRows.push({ list, dots });
  });
  // ms: how long until the row moves on (the fill runs over it); 0 holds it (hovering a tile); null shows
  // it empty (picked, video still loading)
  const markDots = (tile, ms) => {
    for (const { list, dots } of dotRows) {
      const i = list.indexOf(tile);
      if (i < 0) continue;
      dots.forEach((d, k) => {
        d.classList.toggle('on', k === i);
        const fill = d.querySelector('i');
        if (k !== i) { fill.style.animation = 'none'; return; }
        if (ms === null) { fill.style.animation = 'none'; return; }   // waiting for the video to start
        if (!ms) { fill.style.animationPlayState = 'paused'; return; }
        fill.style.animation = 'none';
        void fill.offsetWidth;
        fill.style.animation = `row-dot-fill ${ms}ms linear forwards`;
      });
    }
  };
  // Scrolling picks a tile, but it only starts once the page has been still for 0.9s: long enough to
  // take in the opening shot and read the title, and nothing starts while someone is scrolling past.
  const DWELL = 900;
  const pickTile = (tile, now = false) => {
    clearTimeout(advanceTimer);
    clearTimeout(dwellTimer);
    if (scrollPick && scrollPick !== tile && Previews.current === scrollPick) Previews.stop(scrollPick);
    scrollPick = tile;
    if (!tile || pmActive()) return;
    if (!now) {
      // you swiped to it yourself: start sooner
      const wait = touch && tile.closest('.row-track') === swipedRow && performance.now() - swipedAt < 4000 ? 400 : DWELL;
      dwellTimer = setTimeout(() => { if (scrollPick === tile && !hovered) pickTile(tile, true); }, wait);
      return;
    }
    Previews.play(tile);
    const row = tile.closest('.row-track');
    if (!row) return;
    // The row's clock (the dot's fill and the move to the next video) starts once the video is actually
    // playing, not when it was picked: on a phone it can take a few seconds to load.
    markDots(tile, null);
    const v = tile.querySelector('video.vp-preview');
    const begin = () => { if (scrollPick === tile && !hovered) runClock(tile, row); };
    if (v && !v.paused && v.readyState >= 3) begin();
    else if (v) v.addEventListener('playing', begin, { once: true });
  };
  const runClock = (tile, row) => {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      if (hovered || scrollPick !== tile || document.hidden || pmActive()) return;
      const list = [...row.children].filter(t => !t.hidden && t.dataset.preview);
      // the next video in the row (sliding it into view), and back to the first after the last
      goTo(list[list.indexOf(tile) + 1] || list[0]);
    }, ADVANCE);
    markDots(tile, ADVANCE);
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
    // the project window: everything stops while it's open, and picks up again from the page when it closes
    document.addEventListener('pm:open', () => { clearTimeout(advanceTimer); clearTimeout(dwellTimer); });
    document.addEventListener('pm:close', () => { hovered = null; scrollPick = null; pickFromScroll(); });
  }

  // Mouse: hovering a tile plays it instead (after a moment, so passing over doesn't flicker)
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    tiles.forEach((tile) => {
      let timer = null;
      tile.addEventListener('mouseenter', () => {
        timer = setTimeout(() => { hovered = tile; markDots(tile, 0); Previews.resume(tile); Previews.play(tile, tile !== scrollPick); }, 300);
      });
      tile.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        // Home page rows: the video you were watching keeps playing (silently) and the row's timer starts
        // again from it, so moving the mouse away doesn't throw you back to another video
        if (hovered === tile && tile.parentElement.classList.contains('row-track') && Previews.current === tile) {
          hovered = null;
          Previews.mute(tile);
          chosen = tile; chosenAt = performance.now();
          pickTile(tile, true);
          return;
        }
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
    // the first/last visible tiles (the phones' snapping lines them up with the row's ends)
    const shown = [...track.children].filter(t => !t.hidden);
    shown[0]?.classList.add('row-first');
    shown[shown.length - 1]?.classList.add('row-last');
    // a tile touching the right edge of the row grows leftwards on hover (see .edge-right in styles.css)
    shown.forEach(t => t.addEventListener('mouseenter', () => {
      const box = track.getBoundingClientRect();
      t.classList.toggle('edge-right', t.getBoundingClientRect().right > box.right - 8);
    }));
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
// (The page doesn't glide down by itself: visitors scroll when they're ready.)
document.addEventListener('DOMContentLoaded', () => {
  const cue = document.querySelector('.scroll-cue');
  if (!cue) return;
  const target = document.querySelector(cue.getAttribute('href'));
  // Where the glide stops: the "Featured Work" heading a comfortable 36px under the menu bar (the section's
  // own top leaves a much bigger gap, as that space is there for the first screen's layout)
  const workY = () => {
    const navH = document.querySelector('header')?.offsetHeight || 64;
    const heading = target.querySelector('.work-head h2') || target;
    return Math.max(0, heading.getBoundingClientRect().top + window.scrollY - navH - 36);
  };
  document.querySelectorAll(`a[href="${cue.getAttribute('href')}"]`).forEach(link => link.addEventListener('click', (e) => {
    if (!target) return;
    e.preventDefault();
    glideTo(workY());
  }));
  const update = () => cue.classList.toggle('is-hidden', window.scrollY > 40);
  window.addEventListener('scroll', update, { passive: true });
  update();
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
  // Each tile shuffles its pictures, starts on a random one, and changes on its own loose rhythm
  // (every 3.5 to 6 seconds, different each time), so the tiles never fall into a pattern.
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  };
  tiles.forEach((tile) => {
    const imgs = shuffle([...tile.querySelectorAll('.category-tile-images img')]);
    if (imgs.length < 2) return;
    imgs.forEach((img, k) => img.classList.toggle('is-on', k === 0));
    let n = 0;
    const next = () => setTimeout(() => {
      if (visible.has(tile) && !document.hidden) {
        imgs[n].classList.remove('is-on');
        n = (n + 1) % imgs.length;
        imgs[n].classList.add('is-on');
      }
      next();
    }, 3500 + Math.random() * 2500);
    setTimeout(next, Math.random() * 3000);
  });
});

// Anonymous visit stats for the admin's Traffic page. No cookies and nothing that identifies a
// person: a random visit ID lives in this tab only (sessionStorage) and resets after 30 idle minutes.
// Skipped when the browser asks not to be tracked (Global Privacy Control / Do Not Track), and in a
// browser that's signed in to the admin (Matthew's own visits).
// A page the browser loads ahead of time (Chrome does this for the homepage while "matthewfregnan.com/admin"
// is still being typed) only counts once it's actually opened.
const startStats = () => {
  try {
    if (navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    try { if (!local && localStorage.getItem('pm-github-token')) return; } catch { /* storage blocked */ }
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
};
if (document.prerendering) document.addEventListener('prerenderingchange', startStats, { once: true });
else startStats();

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
  // Message form: sent to the upload service, which saves it for the admin's Inbox and emails it on.
  const form = panel.querySelector('[data-message-form]');
  if (form) {
    let openedAt = 0;
    new MutationObserver(() => { if (panel.open) openedAt = Date.now(); }).observe(panel, { attributes: true, attributeFilter: ['open'] });
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const endpoint = local ? sessionStorage.getItem('mf_track') : 'https://upload.matthewfregnan.com';
    const error = form.querySelector('.cf-error');
    const send = form.querySelector('.cf-send');
    const fail = (msg, field) => {
      error.textContent = msg;
      error.hidden = false;
      if (field) { field.classList.add('is-wrong'); field.focus(); }
    };
    form.addEventListener('input', (e) => { e.target.classList.remove('is-wrong'); error.hidden = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const name = f.name.value.trim(), email = f.email.value.trim(), message = f.message.value.trim();
      if (!name) return fail('Please add your name.', f.name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email address doesn’t look right.', f.email);
      if (message.length < 5) return fail('Please write a message.', f.message);
      if (!endpoint) return fail('Messages can’t be sent from this test copy of the site.');
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const res = await fetch(`${endpoint}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, page: location.pathname, website: f.website.value, ms: Date.now() - (openedAt || Date.now()) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Your message couldn’t be sent just now. Please email me directly, below.');
        form.hidden = true;
        panel.querySelector('.cf-sent').hidden = false;
        window.mfTrack?.('/message-sent/');   // shows in the visit log on the Traffic page
      } catch (err) {
        fail(err instanceof TypeError ? 'Your message couldn’t be sent (no connection?). Please email me directly, below.' : err.message);
      } finally {
        send.disabled = false;
        send.textContent = 'Send Message';
      }
    });
  }
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

// Home hero logos on phones: swipe them to see more clients faster, in either direction, forever. They
// keep drifting on their own (by scrolling, so a swipe carries on from wherever it is) and pause while
// touched. The logos are there three times; we start in the middle copy and quietly jump by one copy's
// width when you get near either end, so there's always more on both sides.
document.addEventListener('DOMContentLoaded', () => {
  const strip = document.querySelector('.hero-clients');
  const track = strip?.querySelector('.hero-clients-track');
  const sets = track ? track.querySelectorAll('.hero-clients-set') : [];
  if (!strip || sets.length < 3 || !window.matchMedia('(hover: none)').matches) return;
  strip.classList.add('is-swipe');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setW = () => sets[1].offsetLeft - sets[0].offsetLeft;
  const base = () => sets[1].offsetLeft;
  let held = false;
  let resumeAt = 0;
  let last = performance.now();
  // start with the middle copy's first logo just inside the soft left edge
  let pos = base() - strip.clientWidth * 0.11;
  strip.scrollLeft = pos;
  const SPEED = 22;   // pixels per second, about the same pace as the desktop drift
  const wrap = () => {
    const w = setW();
    if (!w) return;
    if (pos >= base() + w * 0.5) pos -= w;
    else if (pos < base() - w * 0.5) pos += w;
    else return;
    strip.scrollLeft = pos;
  };
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!held && now > resumeAt && !reduce) {
      pos += SPEED * dt;
      strip.scrollLeft = pos;
    } else {
      pos = strip.scrollLeft;
    }
    if (!held) wrap();   // never jump under a finger
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

// Client pages: the back link says where it goes. Came from another page on this site: "Back to Social"
// (or wherever) and it returns there, scroll position and all. Arrived from outside: "Home".
document.addEventListener('DOMContentLoaded', () => {
  const link = document.querySelector('[data-smart-back]');
  if (!link) return;
  let from;
  try { from = new URL(document.referrer); } catch { return; }
  if (from.origin !== location.origin || from.pathname === location.pathname) return;
  const names = JSON.parse(link.dataset.names || '{}');
  const parts = from.pathname.split('/').filter(Boolean);
  let label = 'Back';
  if (!parts.length || parts[0] === 'for') label = 'Back to home';
  else if (parts[0] === 'clients') label = 'Back';
  else if (parts.length === 1 && names[parts[0]]) label = `Back to ${names[parts[0]]}`;
  else if (parts.length === 2 && names[parts[0]]) label = 'Back to project';
  link.querySelector('span').textContent = label;
  link.setAttribute('href', from.pathname + from.search);
  link.addEventListener('click', (e) => {
    if (history.length > 1) { e.preventDefault(); history.back(); }
  });
});

// Home rows: titles stay on one line. Each row gets one title size (so the row looks even), small enough
// for nearly all its titles to fit whole, but never below about 80% of normal. The odd long one ends in "…".
document.addEventListener('DOMContentLoaded', () => {
  const rows = [...document.querySelectorAll('.row-track')];
  if (!rows.length) return;
  const fit = () => {
    for (const row of rows) {
      const titles = [...row.querySelectorAll('.portfolio-item-title h2')].filter(h => !h.closest('[hidden]'));
      if (!titles.length) continue;
      titles.forEach(h => { h.style.fontSize = ''; });
      const base = parseFloat(getComputedStyle(titles[0]).fontSize);
      const min = base * 0.8;
      // the size each title needs to fit, from its natural width
      const need = titles.map(h => (h.scrollWidth > h.clientWidth + 1 ? base * (h.clientWidth / h.scrollWidth) : base));
      // fit nearly every title (about 85%): one unusually long title gets "…" rather than shrinking the row
      const sorted = need.slice().sort((x, y) => x - y);
      const size = Math.max(min, sorted[Math.floor(sorted.length * 0.15)]);
      if (size < base) titles.forEach(h => { h.style.fontSize = `${Math.floor(size * 2) / 2}px`; });
    }
  };
  fit();
  document.fonts?.ready.then(fit);   // re-measure once Poppins has loaded
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fit, 150); });
});


// Project window: a project tile (home page rows, section pages, client pages, My work) opens the project
// in a floating window over the page instead of going to its own page: the video fills the top of the
// window (carrying on from the preview if one was playing), with the title and details under it. It's the
// project page's own content (fetched, and fetched ahead on hover), its address goes in the address bar so
// it can be shared or reloaded, and Back, Esc, the close button, a click outside or (phones) pulling it
// down close it again. The tile's video grows into the window and shrinks back into the tile on close.
// Project pages themselves keep their tiles as ordinary links.
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.project-main') || !window.fetch || !window.DOMParser) return;
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TILE = 'a.portfolio-item, a.portfolio-item-vertical';
  const tiles = () => [...document.querySelectorAll(TILE)].filter((a) => !a.closest('.pm'));
  const tileFor = (path) => tiles().find((a) => pathOf(a) === path && !a.hidden) || null;
  // "Get in touch" in the window opens the contact pop-up on top of it, so it lives directly in the page
  // (not inside the footer, which is switched off behind the window), and the window is left as it was
  const contact = document.getElementById('contact-panel');
  if (contact && contact.parentElement !== document.body) document.body.append(contact);
  const mailHref = document.querySelector('a[data-contact]')?.getAttribute('href') || '';
  const contactLink = (text, cls) => `<a class="${cls}" href="${mailHref}" data-contact>${text}</a>`;
  const pathOf = (a) => new URL(a.href, location.href).pathname;
  const isProject = (path) => /^\/[^/]+\/[^/]+\/$/.test(path);
  const pageTitle = document.title;

  const cache = new Map();
  const load = (path) => {
    if (!cache.has(path)) {
      cache.set(path, fetch(path, { credentials: 'same-origin' })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((html) => new DOMParser().parseFromString(html, 'text/html'))
        .catch((e) => { cache.delete(path); throw e; }));
    }
    return cache.get(path);
  };
  // fetch ahead: a mouse resting on a tile, or a finger touching one
  let aheadTimer = null;
  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest?.(TILE);
    if (!a || a.closest('.pm')) return;
    clearTimeout(aheadTimer);
    const path = pathOf(a);
    if (isProject(path)) aheadTimer = setTimeout(() => load(path).catch(() => {}), e.pointerType === 'mouse' ? 120 : 0);
  }, { passive: true });

  const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  // Phones, portrait videos: a full-screen player like Reels / TikTok. The name, title and a line of
  // description sit over the bottom of the video, the post's numbers (likes, comments, views) run down
  // the right with share and sound, tapping the words brings up the full details in a sheet, and
  // swiping up goes to the next project (its picture already waiting underneath). Landscape videos on
  // phones stay pinned at the top while the details scroll under them, as in the YouTube app.
  const phone = window.matchMedia('(max-width: 639px)');
  const svg = (paths, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const RAIL = {
    like: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    view: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
    details: '<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>',
    sound: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
    muted: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  };
  const reelParts = (el, doc, panel, node) => {
    el.classList.add('pm-can-reel');
    const text = (sel) => (node.querySelector(sel)?.textContent || '').trim();
    const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const desc = text('.ctx-description, .pp-details .prose p')
      || [...node.querySelectorAll('.role-list li')].map((li) => li.textContent.trim()).join(' · ');
    const order = { like: 0, comment: 1, view: 2 };
    const stats = [...node.querySelectorAll('.stats-fact li[data-kind]')].sort((a, b) => order[a.dataset.kind] - order[b.dataset.kind]).map((li) => {
      const n = li.querySelector('.stats-n')?.textContent.trim() || '';
      const k = li.dataset.kind;
      return `<span class="pm-rail-item${k === 'view' ? '' : ' is-fill'}" aria-label="${esc(`${n} ${li.querySelector('.stats-w')?.textContent.trim() || ''}`)}">${svg(RAIL[k] || '')}<span>${esc(n)}</span></span>`;
    }).join('');
    const hud = document.createElement('div');
    hud.className = 'pm-hud';
    hud.innerHTML = `<button type="button" class="pm-cap" data-pm-sheet aria-label="Show details">
        ${text('.pp-client') ? `<span class="pm-cap-client">${esc(text('.pp-client'))}</span>` : ''}
        <span class="pm-cap-title">${esc(text('.pp-title'))}</span>
        ${desc ? `<span class="pm-cap-desc">${esc(desc)}</span>` : ''}
        <span class="pm-cap-more">more</span>
      </button>
      <div class="pm-rail">${stats}
        <button type="button" class="pm-rail-item" data-pm-share aria-label="Share">${svg(RAIL.share)}<span>Share</span></button>
        <button type="button" class="pm-rail-item" data-pm-sheet aria-label="Details">${svg(RAIL.details)}<span>Details</span></button>
        <button type="button" class="pm-rail-item" data-pm-sound aria-label="Sound">${svg(RAIL.sound)}<span>Sound</span></button>
      </div>`;
    const peek = document.createElement('div');
    peek.className = 'pm-peek';
    peek.setAttribute('aria-hidden', 'true');
    peek.innerHTML = '<span class="pm-peek-title"></span>';
    const sheetScrim = document.createElement('div');
    sheetScrim.className = 'pm-sheet-scrim';
    sheetScrim.dataset.pmSheetClose = '';
    panel.append(hud, sheetScrim, peek);
    // where the video goes back to when the screen is wide enough for the page layout
    const media = node.querySelector('.pp-media');
    const slot = document.createElement('span');
    slot.className = 'pm-media-slot';
    slot.hidden = true;
    media.before(slot);
  };
  // move the video between the page layout and the full-screen one as the screen changes size
  const arrange = (el) => {
    if (!el.classList.contains('pm-can-reel')) return;
    const reel = phone.matches;
    const panel = el.querySelector('.pm-panel');
    const media = el.querySelector('.pp-media');
    const slot = el.querySelector('.pm-media-slot');
    el.classList.toggle('pm-reel', reel);
    if (!reel) el.classList.remove('pm-sheet-open');
    if (!media || !slot) return;
    if (reel && media.parentElement !== panel) panel.insertBefore(media, panel.querySelector('.pm-sheet'));
    else if (!reel && media.parentElement === panel) slot.after(media);
  };
  phone.addEventListener?.('change', () => { if (box) arrange(box); });
  const reelOn = () => box?.classList.contains('pm-reel');

  // The window, built from the project page: landscape videos sit edge to edge across the top with the
  // details below; portrait ones keep their page layout (video beside the details on wider screens).
  const build = (doc, path) => {
    const main = doc.querySelector('.project-main');
    if (!main) return null;
    const portrait = main.classList.contains('portrait-page');
    const title = (doc.querySelector('.pp-title')?.textContent || '').trim();
    const el = document.createElement('div');
    el.className = `pm${portrait ? ' pm-portrait' : ''}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title || 'Project');
    el.innerHTML = `<div class="pm-scrim" data-pm-close></div>
      <div class="pm-panel" tabindex="-1">
        <button type="button" class="pm-close" data-pm-close aria-label="Close">${ICON_CLOSE}</button>
        <div class="pm-sheet"><div class="pm-info"></div>
          <div class="pm-foot"><span class="pm-cta">Have a project like this? ${contactLink('Get in touch', 'pm-cta-link')}</span></div></div>
      </div>`;
    const panel = el.querySelector('.pm-panel');
    const node = document.importNode(main, true);
    if (!portrait) {
      const media = node.querySelector('.pp-media');
      if (media) panel.insertBefore(media, panel.querySelector('.pm-sheet'));
      else el.classList.add('pm-no-media');
    }
    panel.querySelector('.pm-info').append(node);
    if (portrait && node.querySelector('.pp-media video')) reelParts(el, doc, panel, node);
    const next = doc.querySelector('.more-next');
    if (next && isProject(new URL(next.href, location.href).pathname)) {
      const a = document.createElement('a');
      a.className = 'pm-next';
      a.href = next.getAttribute('href');
      a.innerHTML = `<span class="pm-next-label">Next project</span><span class="pm-next-title"></span>${ICON_NEXT}`;
      a.querySelector('.pm-next-title').textContent = next.querySelector('.more-next-title')?.textContent.trim() || '';
      el.querySelector('.pm-foot').append(a);
      const peek = el.querySelector('.pm-peek-title');
      if (peek) peek.textContent = a.querySelector('.pm-next-title').textContent;
    }
    arrange(el);
    return el;
  };

  let box = null;      // the open window
  let player = null;
  let opener = null;   // the tile it came from
  let openPath = null;
  let leaving = false; // Back has been pressed for it (close button / Esc), waiting for the browser
  // something is opening, changing or closing: clicks wait, and Back / Forward queue up behind it
  let pending = 0;
  let queue = Promise.resolve();
  const run = (job) => {
    pending++;
    queue = queue.then(job).catch((e) => console.warn('Project window:', e)).finally(() => { pending--; });
    return queue;
  };

  const clearNames = () => document.querySelectorAll('[style*="view-transition-name"]').forEach((n) => { n.style.viewTransitionName = ''; });
  const tileMedia = (tile) => tile?.querySelector('img:not(.card-logo), video.card-still');

  // Sound up gently to the player's level; if the browser won't allow sound without a fresh tap, it
  // carries on silently (the player's speaker button turns it on).
  const soundUp = (v) => {
    if (!v.paused && !v.muted && v.volume > 0.05) { v.volume = PLAYER_VOLUME; return; }   // already audible
    player.ramping = true;
    v.volume = 0;
    v.muted = false;
    const silent = () => { player.ramping = false; v.volume = PLAYER_VOLUME; v.muted = true; v.play().catch(() => {}); };
    const ok = () => { if (box && player?.video === v) player.fadeVolume(PLAYER_VOLUME, 700); };
    if (v.paused) v.play().then(ok, silent);
    else {
      ok();
      // some browsers pause a video that turns its sound on without a fresh tap: carry on silently
      setTimeout(() => { if (box && player?.video === v && v.paused) silent(); }, 250);
    }
  };
  const mount = (el, doc, path, handed = null) => {
    box = el;
    openPath = path;
    document.title = doc.title || pageTitle;
    const vp = el.querySelector('.video-player[data-video-sources]');
    player = null;
    if (vp?.dataset.poster) {
      // the thumbnail sits behind the video, so there's never a black frame while it loads
      const c = vp.querySelector('.video-container');
      if (c) {
        c.style.background = `#000 url("${vp.dataset.poster}") center / contain no-repeat`;
        c.querySelector('video')?.addEventListener('playing', () => { c.style.background = '#000'; }, { once: true });
      }
    }
    if (vp) { try { player = new VideoPlayer(vp, { video: handed?.video }); } catch (e) { console.warn('Video player failed to start', e); } }
    if (handed && player?.video !== handed.video) { handed.video.pause(); handed.video.remove(); handed = null; }
    if (handed) try { sessionStorage.removeItem('mf-resume'); } catch { /* fine */ }
    // Watched to the end: a quiet prompt over the last frame (Get in touch / Watch again). It goes as soon
    // as the video plays again.
    const v = player?.video;
    if (v) {
      const end = document.createElement('div');
      end.className = 'pm-end';
      end.hidden = true;
      end.innerHTML = `<p class="pm-end-q">Have a project like this?</p>
        <div class="pm-end-btns">${contactLink('Get in touch', 'pm-end-btn is-main')}<button type="button" class="pm-end-btn" data-again>Watch again</button></div>`;
      player.shell.append(end);
      v.addEventListener('ended', () => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        end.hidden = false;
        requestAnimationFrame(() => requestAnimationFrame(() => end.classList.add('is-shown')));
      });
      v.addEventListener('play', () => { end.classList.remove('is-shown'); end.hidden = true; });
      end.querySelector('[data-again]').addEventListener('click', () => player.toggle());
    }
    // full-screen phone layout: the sound button follows the video, and the next project's picture
    // waits underneath for a swipe up
    const sound = el.querySelector('[data-pm-sound]');
    if (sound && v) {
      const sync = () => {
        sound.querySelector('svg').innerHTML = v.muted ? RAIL.muted : RAIL.sound;
        sound.querySelector('span').textContent = v.muted ? 'Muted' : 'Sound';
        sound.setAttribute('aria-label', v.muted ? 'Turn sound on' : 'Mute');
      };
      v.addEventListener('volumechange', sync);
      sync();
    }
    const nx = el.querySelector('.pm-next');
    const pk = el.querySelector('.pm-peek');
    if (nx && pk) {
      load(pathOf(nx)).then((d) => {
        const p = d.querySelector('.video-player[data-poster]')?.dataset.poster;
        if (p) pk.style.backgroundImage = `url("${p}")`;
      }).catch(() => {});
    }
    return () => {
      const v = player?.video;
      if (!v || box !== el) return;
      if (handed) { soundUp(v); return; }
      // it opened to be watched: play now, from where a preview of it got to if there was one
      let r = null;
      try { r = JSON.parse(sessionStorage.getItem('mf-resume') || 'null'); sessionStorage.removeItem('mf-resume'); } catch { /* fine */ }
      if (r && r.path === path && Date.now() - r.at < 20000 && r.src === (v.getAttribute('src') || '').split('#')[0]) {
        try { v.currentTime = Math.max(0, r.t); } catch { /* not ready: from the start */ }
      }
      v.preload = 'auto';
      soundUp(v);
    };
  };
  const unmount = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { player?.teardown(); } catch { /* gone anyway */ }
    player = null;
  };

  // The grow: the real video player (live, never a still picture, so it can't flash black) flies from
  // the tile's spot to its place in the window while the window fills in around it; closing flies it back.
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const flight = (from, to) => [
    `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${from.width / to.width}, ${from.height / to.height})`,
    'none',
  ];
  const shellOf = (el) => el.querySelector('.pp-media .player-shell');
  const tileRadius = (tile) => getComputedStyle(tile).borderTopLeftRadius || '6px';
  // the corners it lands with: the window's own top corners (landscape), or the player's (portrait)
  const endRadius = (el, shell) => {
    if (el.classList.contains('pm-portrait')) return getComputedStyle(shell).borderTopLeftRadius;
    const r = getComputedStyle(el.querySelector('.pm-panel')).borderTopLeftRadius;
    return `${r} ${r} 0 0`;
  };
  const onScreen = (r) => r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;

  const open = async (path, tile, push = true) => {
    if (box) return;
    root.classList.add('pm-active');   // previews and the rows hold still from here
    tile?.classList.add('is-opening');
    let doc;
    try { doc = await load(path); } catch { doc = null; }
    tile?.classList.remove('is-opening');
    const el = doc && build(doc, path);
    if (!el) { location.href = path; return; }
    opener = tile;
    const from = tile ? (tileMedia(tile) || tile).getBoundingClientRect() : null;
    const handed = tile && tile.dataset.preview && Previews.handOff(tile);
    if (Previews.current) Previews.stop(Previews.current);
    document.dispatchEvent(new Event('pm:open'));
    clearNames();
    if (push) history.pushState({ pm: path }, '', path);
    [...document.body.children].forEach((c) => { if (c !== contact) c.inert = true; });
    const shell0 = shellOf(el);
    const fly = !reduce.matches && onScreen(from) && shell0;
    el.classList.add(fly ? 'pm-flip' : 'pm-animate');
    document.body.append(el);
    root.classList.add('pm-open');
    // only when the preview is the same video as the project's (some long videos preview a short clip)
    const want = el.querySelector('.video-player video')?.getAttribute('src');
    const same = handed && want && new URL(want, location.href).href === new URL(tile.dataset.preview.split('#')[0], location.href).href;
    if (handed && !same) { handed.video.pause(); handed.video.remove(); }
    const play = mount(el, doc, path, same ? handed : null);
    el.querySelector('.pm-panel').focus({ preventScroll: true });
    play();
    window.mfTrack?.(path);
    if (fly) {
      const shell = shellOf(el);
      const a = shell.animate({ transform: flight(from, shell.getBoundingClientRect()), borderRadius: [tileRadius(tile), endRadius(el, shell)] }, { duration: 520, easing: EASE });
      a.finished.catch(() => {}).then(() => el.classList.remove('pm-flip'));
    }
  };

  // Next project, from inside the window: the window stays, its contents fade across
  const swap = async (path, push = 'replace', slid = false) => {
    if (!box || path === openPath) return;
    let doc;
    try { doc = await load(path); } catch { doc = null; }
    const el = doc && build(doc, path);
    if (!el) { location.href = path; return; }
    unmount();
    if (push === 'replace') history.replaceState({ pm: path }, '', path);
    if (!reduce.matches) el.classList.add(slid && el.classList.contains('pm-reel') ? 'pm-slid' : 'pm-swapped');
    box.replaceWith(el);
    const play = mount(el, doc, path);
    el.querySelector('.pm-panel').focus({ preventScroll: true });
    opener = tileFor(path);
    play();
    window.mfTrack?.(path);
  };

  const close = async (fromHistory = false) => {
    if (!box) return;
    // the window has its own place in the browser's history: closing it is going Back
    if (!fromHistory && history.state?.pm) { if (!leaving) { leaving = true; history.back(); } return; }
    const el = box;
    const tile = opener && opener.isConnected && !opener.hidden ? opener : null;
    const to = tile ? (tileMedia(tile) || tile).getBoundingClientRect() : null;
    const shell = shellOf(el);
    const pulled = el.classList.contains('pm-dragging');
    if (el.classList.contains('pm-flip')) {
      // closed while still growing in: the grow stops where it is, and the close carries on from there
      shell?.getAnimations().forEach((x) => { x.commitStyles?.(); x.cancel(); });
      el.classList.remove('pm-flip');
    }
    // the sound eases away with the picture rather than cutting off
    const v = player?.video;
    if (v && !v.paused && !v.muted && !reduce.matches) {
      const v0 = v.volume;
      const t0 = performance.now();
      player.ramping = true;
      const down = (now) => { const k = Math.min(1, (now - t0) / 300); v.volume = v0 * (1 - k); if (k < 1 && box === el) requestAnimationFrame(down); };
      requestAnimationFrame(down);
    }
    if (pulled && !reduce.matches && shell && onScreen(to) && onScreen(shell.getBoundingClientRect()) && !document.fullscreenElement) {
      // pulled down on a phone: it carries on into its tile, fading as it lands so the tile's picture shows through
      el.classList.add('pm-flip-out');
      const [moved] = flight(to, shell.getBoundingClientRect());
      const r0 = endRadius(el, shell);
      const r1 = tileRadius(tile);
      await shell.animate([
        { transform: 'none', borderRadius: r0, opacity: 1 },
        { transform: moved, borderRadius: r1, opacity: 1, offset: 0.8 },
        { transform: moved, borderRadius: r1, opacity: 0 },
      ], { duration: 440, easing: EASE, fill: 'forwards' }).finished.catch(() => {});
    } else if (!reduce.matches && pulled) {
      // pulled down but its tile isn't on screen: it carries on down and away
      const panel = el.querySelector('.pm-panel');
      el.querySelector('.pm-scrim').animate({ opacity: [getComputedStyle(el.querySelector('.pm-scrim')).opacity, 0] }, { duration: 300, fill: 'forwards' });
      await panel.animate({ transform: [getComputedStyle(panel).transform, `translateY(${window.innerHeight}px)`] }, { duration: 300, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }).finished.catch(() => {});
    } else if (!reduce.matches) {
      // closed with the button, Esc, a click outside or Back: the window settles back and fades away
      el.classList.add('pm-leaving');
      await new Promise((r) => setTimeout(r, 340));
    }
    unmount();
    el.remove();
    box = null; openPath = null; opener = null; leaving = false;
    [...document.body.children].forEach((c) => { c.inert = false; });
    root.classList.remove('pm-open', 'pm-active');
    document.title = pageTitle;
    tile?.focus({ preventScroll: true });
    document.dispatchEvent(new Event('pm:close'));
  };

  // Phones: pull the window down (from the top of it) to close. It follows your finger with the page
  // showing through behind; let go far enough (or flick it) and it flies back into its tile, otherwise it
  // springs back into place.
  // Full-screen phone layout (portrait videos): swipe up for the next project, and the details sheet
  // pulls down to put it away.
  let drag = null;
  const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const sheetOf = () => box?.querySelector('.pm-sheet');
  const showSheet = (on) => {
    if (!box) return;
    const sh = sheetOf();
    if (sh) sh.style.transform = '';
    box.classList.toggle('pm-sheet-open', on);
    if (on && sh) sh.scrollTop = 0;
  };
  const nextPath = () => { const a = box?.querySelector('.pm-next'); return a ? pathOf(a) : null; };
  const springBack = (node, scrim) => {
    node.style.transition = `transform 0.4s ${SPRING}`;
    if (scrim) scrim.style.transition = 'opacity 0.4s ease';
    node.style.transform = '';
    if (scrim) scrim.style.opacity = '';
    setTimeout(() => {
      node.style.transition = '';
      if (scrim) scrim.style.transition = '';
      if (!drag) box?.classList.remove('pm-dragging', 'pm-up');
    }, 420);
  };
  document.addEventListener('touchstart', (e) => {
    if (!box || pending || e.touches.length !== 1 || box.scrollTop > 0) return;
    if (e.target.closest('.vp-bar, input, iframe')) return;
    const t = e.touches[0];
    const base = { x: t.clientX, y: t.clientY, dy: 0, on: false, at: 0, v: 0 };
    if (box.classList.contains('pm-sheet-open')) {
      const sh = sheetOf();
      // in the sheet, from the top of it: pull it down to put it away (a tap outside it does too)
      if (sh && e.target.closest('.pm-sheet') && sh.scrollTop <= 0) drag = { ...base, sheet: sh };
      return;
    }
    if (e.target.closest('.pm-foot')) return;
    drag = { ...base, panel: box.querySelector('.pm-panel'), scrim: box.querySelector('.pm-scrim'), reel: reelOn() };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!drag || !box) return;
    const t = e.touches[0];
    if (!drag.on) {
      const dx = t.clientX - drag.x;
      const dy = t.clientY - drag.y;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const up = dy < 0 && drag.reel && !drag.sheet;
      if ((dy <= 0 && !up) || Math.abs(dx) > Math.abs(dy) || box.scrollTop > 0 || (drag.sheet && drag.sheet.scrollTop > 0)) { drag = null; return; }   // scrolling, not pulling
      drag.on = true;
      drag.up = up;
      drag.y = t.clientY;
      drag.at = performance.now();
      if (!drag.sheet) {
        drag.next = up ? nextPath() : null;
        drag.panel.getAnimations().forEach((a) => a.finish());
        box.classList.remove('pm-flip');
        box.classList.add('pm-dragging');
        box.classList.toggle('pm-up', up);
      }
    }
    e.preventDefault();
    let d = t.clientY - drag.y;
    d = drag.up ? Math.min(0, d) : Math.max(0, d);
    if (drag.up && !drag.next) d *= 0.25;   // nothing after this one: it gives a little, then springs back
    const now = performance.now();
    drag.v = (d - drag.dy) / Math.max(1, now - (drag.last || drag.at));   // px per ms, for a flick
    drag.last = now;
    drag.dy = d;
    if (drag.sheet) { drag.sheet.style.transition = 'none'; drag.sheet.style.transform = `translateY(${d}px)`; return; }
    drag.panel.style.transform = `translateY(${d}px)`;
    if (!drag.up) drag.scrim.style.opacity = String(Math.max(0.2, 1 - d / 600));
  }, { passive: false });
  const letGo = () => {
    const d = drag;
    drag = null;
    if (!d || !d.on || !box) return;
    if (d.sheet) {
      d.sheet.style.transition = '';
      if (d.dy > 90 || (d.dy > 30 && d.v > 0.5)) showSheet(false);
      else d.sheet.style.transform = '';
      return;
    }
    if (d.up) {
      if (d.next && (d.dy < -110 || (d.dy < -36 && d.v < -0.5))) {
        // on up and away: the next one's picture, already underneath, fills the screen and plays
        const el = box;
        const go = !reduce.matches
          ? d.panel.animate({ transform: [`translateY(${d.dy}px)`, `translateY(${-window.innerHeight}px)`] }, { duration: 260, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)', fill: 'forwards' }).finished.catch(() => {})
          : Promise.resolve();
        player?.video?.pause();
        run(async () => { await go; if (box === el) await swap(d.next, 'replace', true); });
        return;
      }
      springBack(d.panel);
      return;
    }
    if (d.dy > 130 || (d.dy > 40 && d.v > 0.6)) { run(() => close()); return; }
    springBack(d.panel, d.scrim);
  };
  document.addEventListener('touchend', letGo);
  document.addEventListener('touchcancel', letGo);

  document.addEventListener('click', (e) => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (box) {
      if (e.target.closest('.pm a[data-contact]')) { player?.video?.pause(); return; }
      if (e.target.closest('[data-pm-close]')) { e.preventDefault(); run(() => close()); return; }
      if (e.target.closest('[data-pm-sheet]')) { showSheet(true); return; }
      if (e.target.closest('[data-pm-sheet-close]')) { showSheet(false); return; }
      if (e.target.closest('[data-pm-sound]')) {
        const v = player?.video;
        if (v) { v.muted = !v.muted; if (!v.muted && v.volume < 0.05) v.volume = PLAYER_VOLUME; }
        return;
      }
      const share = e.target.closest('[data-pm-share]');
      if (share) {
        const url = location.origin + (openPath || location.pathname);
        const label = share.querySelector('span');
        if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
        else navigator.clipboard?.writeText(url).then(() => {
          label.textContent = 'Copied';
          setTimeout(() => { label.textContent = 'Share'; }, 1600);
        }).catch(() => {});
        return;
      }
      const next = e.target.closest('.pm a.pm-next');
      if (next) { e.preventDefault(); if (!pending) run(() => swap(pathOf(next))); }
      return;
    }
    const a = e.target.closest(TILE);
    if (!a || e.defaultPrevented || a.closest('.pm') || !isProject(pathOf(a))) return;
    e.preventDefault();
    if (!pending) run(() => open(pathOf(a), a));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !box || contact?.open || document.fullscreenElement || document.webkitFullscreenElement) return;
    e.preventDefault();
    if (box.classList.contains('pm-sheet-open')) showSheet(false);
    else run(() => close());
  });
  // Back closes it; Forward (after closing) opens it again
  window.addEventListener('popstate', (e) => {
    const p = e.state?.pm;
    run(() => {
      if (p && box) return swap(p, 'none');
      if (p) return open(p, tileFor(p), false);
      if (box) return close(true);
    });
  });
});
