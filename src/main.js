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
