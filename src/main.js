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

// Video fallback: if the video that was working when the site was built has since been made
// private or deleted, switch to the next link (YouTube / Instagram / Vimeo) for that project.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.video-player[data-video-sources]').forEach(async (player) => {
    let sources;
    try {
      sources = JSON.parse(player.dataset.videoSources);
    } catch {
      return;
    }
    const start = Number(player.dataset.active) || 0;
    if (sources.length < 2) return;

    // true = plays, false = broken, null = can't tell (treat as fine)
    const plays = async (source) => {
      if (!source.check) return null;
      try {
        const res = await fetch(source.check);
        if (res.ok) return true;
        return [401, 403, 404].includes(res.status) ? false : null;
      } catch {
        return null;
      }
    };

    if ((await plays(sources[start])) !== false) return;
    for (let i = 0; i < sources.length; i++) {
      if (i === start) continue;
      if ((await plays(sources[i])) === false) continue;
      const container = player.querySelector('.video-container');
      const iframe = container.querySelector('iframe');
      container.classList.toggle('is-instagram', sources[i].kind === 'instagram');
      container.classList.toggle('is-vertical', sources[i].kind !== 'instagram' && container.dataset.vertical === 'true');
      iframe.src = sources[i].embed;
      const stats = player.querySelector('.video-stats');
      if (stats && stats.dataset.kind !== sources[i].kind) stats.remove();
      return;
    }
  });
});
