/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './templates/**/*.html',
    './templates/**/*.ejs',
    './src/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme colors - will refine after analyzing Squarespace site
        'site-bg': '#0a0a0a',
        'site-bg-secondary': '#141414',
        'site-text': '#ffffff',
        'site-text-muted': '#a0a0a0',
        'site-accent': '#ffffff',
      },
      fontFamily: {
        'sans': ['Poppins', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [],
}
