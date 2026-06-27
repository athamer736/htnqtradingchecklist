/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0d12',
          soft: '#11141b',
          card: '#161a23',
          hover: '#1c212c'
        },
        line: '#252a36',
        accent: {
          DEFAULT: '#3b82f6',
          soft: '#1d4ed8'
        },
        teal: '#14b8a6',
        muted: '#8b94a7'
      },
      fontFamily: {
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
