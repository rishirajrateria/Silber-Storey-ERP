import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      colors: { accent: 'rgb(var(--accent) / <alpha-value>)', ink: '#e9eef8', mute: '#8a94ad' },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: { glass: 'inset 0 0 0 1px rgba(255,255,255,.04), inset 0 1px 0 rgba(255,255,255,.08), 0 20px 50px rgba(0,0,0,.45)', soft: '0 0 18px rgba(94,230,255,.18)' },
    },
  },
  plugins: [],
} satisfies Config;
