import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
    prefix: 'imcrm-',
    // NOTA: NO usar `important: '#imcrm-root'` — Radix Dialog/Popover/
    // Sheet renderizan su contenido vía Portal como hijo directo de
    // <body>, fuera de #imcrm-root. Si el selector important está
    // activo, las clases `imcrm-fixed`/`imcrm-z-50`/etc. NO aplican al
    // contenido portaleado y los dialogs caen en flujo normal al final
    // de la página. El prefix `imcrm-` ya da el aislamiento contra
    // estilos de wp-admin.
    darkMode: ['class', '[data-imcrm-theme="dark"]'],
    content: ['./app/**/*.{ts,tsx}', './src/**/*.php'],
    corePlugins: {
        preflight: false,
    },
    theme: {
        container: {
            center: true,
            padding: '1rem',
        },
        extend: {
            colors: {
                border: 'hsl(var(--imcrm-border))',
                input: 'hsl(var(--imcrm-input))',
                ring: 'hsl(var(--imcrm-ring))',
                background: 'hsl(var(--imcrm-background))',
                foreground: 'hsl(var(--imcrm-foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--imcrm-primary))',
                    foreground: 'hsl(var(--imcrm-primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--imcrm-secondary))',
                    foreground: 'hsl(var(--imcrm-secondary-foreground))',
                },
                muted: {
                    DEFAULT: 'hsl(var(--imcrm-muted))',
                    foreground: 'hsl(var(--imcrm-muted-foreground))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--imcrm-accent))',
                    foreground: 'hsl(var(--imcrm-accent-foreground))',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--imcrm-destructive))',
                    foreground: 'hsl(var(--imcrm-destructive-foreground))',
                },
                success: {
                    DEFAULT: 'hsl(var(--imcrm-success))',
                    foreground: 'hsl(var(--imcrm-success-foreground))',
                },
                warning: {
                    DEFAULT: 'hsl(var(--imcrm-warning))',
                    foreground: 'hsl(var(--imcrm-warning-foreground))',
                },
                info: {
                    DEFAULT: 'hsl(var(--imcrm-info))',
                    foreground: 'hsl(var(--imcrm-info-foreground))',
                },
                card: {
                    DEFAULT: 'hsl(var(--imcrm-card))',
                    foreground: 'hsl(var(--imcrm-card-foreground))',
                },
                popover: {
                    DEFAULT: 'hsl(var(--imcrm-popover))',
                    foreground: 'hsl(var(--imcrm-popover-foreground))',
                },
                sidebar: {
                    DEFAULT: 'hsl(var(--imcrm-sidebar))',
                    foreground: 'hsl(var(--imcrm-sidebar-foreground))',
                    border: 'hsl(var(--imcrm-sidebar-border))',
                    accent: 'hsl(var(--imcrm-sidebar-accent))',
                    'accent-foreground': 'hsl(var(--imcrm-sidebar-accent-foreground))',
                },
                canvas: 'hsl(var(--imcrm-canvas))',
                tone: {
                    cyan: 'hsl(var(--imcrm-tone-cyan))',
                    mint: 'hsl(var(--imcrm-tone-mint))',
                    rose: 'hsl(var(--imcrm-tone-rose))',
                    blue: 'hsl(var(--imcrm-tone-blue))',
                    violet: 'hsl(var(--imcrm-tone-violet))',
                    amber: 'hsl(var(--imcrm-tone-amber))',
                    slate: 'hsl(var(--imcrm-tone-slate))',
                },
            },
            borderRadius: {
                sm: '4px',
                md: '6px',
                lg: '8px',
                xl: '12px',
            },
            fontFamily: {
                sans: [
                    'Inter',
                    'ui-sans-serif',
                    'system-ui',
                    '-apple-system',
                    'Segoe UI',
                    'Roboto',
                    'Helvetica Neue',
                    'Arial',
                    'sans-serif',
                ],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
            letterSpacing: {
                tight: '-0.01em',
            },
            boxShadow: {
                // Sombras en capas (estilo Linear / Vercel) — un blur
                // suave amplio + un edge nítido cerca del elemento dan
                // depth sin "halo gris". Aumentamos la opacidad
                // ligeramente respecto a la versión anterior porque
                // 0.04 era demasiado plano sobre fondos claros.
                'imcrm-sm': '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 1px 0 rgb(15 23 42 / 0.02)',
                'imcrm-md': '0 4px 6px -2px rgb(15 23 42 / 0.05), 0 2px 4px -2px rgb(15 23 42 / 0.04)',
                'imcrm-lg': '0 12px 24px -8px rgb(15 23 42 / 0.10), 0 6px 12px -4px rgb(15 23 42 / 0.06)',
                'imcrm-xl': '0 24px 48px -12px rgb(15 23 42 / 0.18), 0 12px 24px -6px rgb(15 23 42 / 0.10)',
                // Inner shadow para inputs / wells.
                'imcrm-inset': 'inset 0 1px 2px 0 rgb(15 23 42 / 0.05)',
            },
            transitionDuration: {
                '150': '150ms',
                '200': '200ms',
            },
            transitionTimingFunction: {
                'imcrm-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            keyframes: {
                'imcrm-fade-in': {
                    from: { opacity: '0' },
                    to: { opacity: '1' },
                },
                'imcrm-slide-in-right': {
                    from: { transform: 'translateX(100%)' },
                    to: { transform: 'translateX(0)' },
                },
                'imcrm-scale-in': {
                    from: { opacity: '0', transform: 'scale(0.96)' },
                    to: { opacity: '1', transform: 'scale(1)' },
                },
            },
            animation: {
                'imcrm-fade-in': 'imcrm-fade-in 150ms ease-out',
                'imcrm-slide-in-right': 'imcrm-slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                'imcrm-scale-in': 'imcrm-scale-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
            },
        },
    },
    plugins: [animate],
};

export default config;
