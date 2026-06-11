/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cvat: {
          bg:       '#0d0d0d',
          surface:  '#161616',
          panel:    '#1e1e1e',
          border:   '#2e2e2e',
          hover:    '#252525',
          gold:     '#c8a84b',
          'gold-h': '#e0bc5e',
          text:     '#e2e2e2',
          muted:    '#777777',
          pending:  '#6b7280',
          annotated:'#22c55e',
          review:   '#f59e0b',
          done:     '#3b82f6',
        },
      },
    },
  },
  plugins: [],
}

