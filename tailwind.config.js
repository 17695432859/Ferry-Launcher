/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        ink: {
          1: 'var(--text-1)',
          2: 'var(--text-2)',
          3: 'var(--text-3)'
        }
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
        card: 'var(--radius-card)'
      },
      boxShadow: {
        panel: 'var(--panel-shadow)'
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)'
      }
    }
  },
  plugins: []
}
