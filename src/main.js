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
// - Vimeo / YouTube / Instagram (backups) use their normal embeds.
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
    const shape = src.kind === 'instagram' ? 'is-instagram' : (this.vertical ? 'is-vertical' : '');
    for (const node of [this.shell, this.container]) {
      node.classList.remove('is-instagram', 'is-vertical');
      if (shape) node.classList.add(shape);
    }
    this.teardown();
    const stats = this.root.querySelector('.video-stats');
    if (stats && stats.dataset.kind !== src.kind) stats.remove();
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
      this.verify();
    }
  }

  // ------------------------------------------------------------------ hosted file
  setupFile(video) {
    this.video = video;
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
    on(video, 'play', () => this.setPlaying(true));
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

// Hover previews: short-form tiles with a hosted video play it silently while the mouse is over
// them (desktop only; on phones a tap just opens the project). The video only loads on hover.
document.addEventListener('DOMContentLoaded', () => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('[data-preview]').forEach((tile) => {
    let video = null;
    let timer = null;
    tile.addEventListener('mouseenter', () => {
      timer = setTimeout(() => {
        if (!video) {
          video = document.createElement('video');
          video.className = 'vp-preview';
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.src = tile.dataset.preview;
          tile.insertBefore(video, tile.querySelector('.portfolio-item-title'));
        }
        video.currentTime = 0;
        video.play().then(() => tile.classList.add('is-previewing')).catch(() => {});
      }, 150); // ignore the mouse just passing over
    });
    tile.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      tile.classList.remove('is-previewing');
      if (video) setTimeout(() => { if (!tile.classList.contains('is-previewing')) video.pause(); }, 350);
    });
  });
});

// Home page scroll nudge: smooth-scroll to the work, and fade the arrow out once the page scrolls.
document.addEventListener('DOMContentLoaded', () => {
  const cue = document.querySelector('.scroll-cue');
  if (!cue) return;
  const target = document.querySelector(cue.getAttribute('href'));
  cue.addEventListener('click', (e) => {
    if (!target) return;
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
  const update = () => cue.classList.toggle('is-hidden', window.scrollY > 40);
  window.addEventListener('scroll', update, { passive: true });
  update();
});
