/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables (set by the active theme, see src/shared/themes.ts) so a
// theme can restyle the whole app. Written as "r g b" channels so opacity classes like
// bg-accent/30 keep working.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`

const slate = {}
for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) slate[step] = v(`--c-slate-${step}`)

const hues = {}
for (const hue of ['rose', 'amber', 'emerald', 'sky', 'violet']) {
  hues[hue] = {}
  for (const shade of [100, 200, 300, 400]) hues[hue][shade] = v(`--c-${hue}-${shade}`)
}

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: v('--c-bg'),
          soft: v('--c-soft'),
          card: v('--c-card'),
          hover: v('--c-hover')
        },
        line: v('--c-line'),
        accent: {
          DEFAULT: v('--c-accent'),
          soft: v('--c-accent-soft')
        },
        teal: v('--c-teal'),
        muted: v('--c-muted'),
        fg: v('--c-fg'),
        'on-accent': v('--c-on-accent'),
        surface: {
          1: v('--c-surface-1'),
          2: v('--c-surface-2')
        },
        white: v('--c-white'),
        // Always white, for text on photos, video and dark overlays that stay dark in every theme.
        'solid-white': '#ffffff',
        slate,
        ...hues
      },      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(18px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' }
        },
        slideOutRight: {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(24px)' }
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      },
      animation: {
        fadeIn: 'fadeIn 0.25s ease-out',
        fadeInUp: 'fadeInUp 0.3s ease-out both',
        slideInRight: 'slideInRight 0.26s ease-out both',
        slideOutRight: 'slideOutRight 0.22s ease-in both',
        scaleIn: 'scaleIn 0.2s ease-out both'
      }
    }
  },
  plugins: []
}
