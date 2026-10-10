import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      colors: { accent: 'rgb(var(--accent) / <alpha-value>)', ink: '#f2f2f2', mute: '#8c8c8c' },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: { glass: 'inset 0 1px 0 rgba(255,255,255,.06), 0 24px 60px rgba(0,0,0,.6)', soft: '0 0 0 1px rgba(255,255,255,.12)' },
    },
  },
  plugins: [],
} satisfies Config;
