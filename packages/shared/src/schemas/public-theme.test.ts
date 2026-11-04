import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PUBLIC_THEME,
    publicThemeFileIds,
    publicThemeSchema,
    readPublicTheme,
} from './public-theme';
import {
    buildPublicThemeCss,
    contrastRatio,
    cssUrl,
    deriveDarkPalette,
    ensureContrast,
    publicThemePreloadFont,
    publicThemeView,
    publicThemeWebFonts,
    resolvePublicPalettes,
    sanitizePublicCss,
} from './public-theme-css';
import { PUBLIC_THEME_PRESET_IDS, publicThemePresets } from './public-theme-presets';
import { buildPublicFormItems, formConfigFileIds, formConfigSchema } from './form';

describe('tema de las páginas públicas', () => {
    it('sin tema se ve como siempre: tarjeta de 660 px, gris de fondo y la franja', () => {
        const css = buildPublicThemeCss(DEFAULT_PUBLIC_THEME, { accent: '#0e7490' });
        expect(css).toContain('--ib-width:660px');
        expect(css).toContain('--ib-bg:#f4f5f7');
        expect(css).toContain('--ib-accent:#0e7490');
        expect(css).toContain('--ib-card-radius:14px');
        const view = publicThemeView(DEFAULT_PUBLIC_THEME);
        expect(view.band).toBe(true);
        expect(view.cover).toBe(false);
        expect(view.classes).toEqual(expect.arrayContaining(['ib-container-card', 'ib-input-outlined', 'ib-labels-top', 'ib-btn-filled']));
    });

    it('lee con tolerancia: una sección rota cae al valor de fábrica sin perder el resto', () => {
        const t = readPublicTheme({ typography: { font: 'comic-sans', base_size: 9999 }, layout: { width: 800 }, mode: 'raro' });
        expect(t.typography.font).toBe('modern');
        expect(t.layout.width).toBe(800);
        expect(t.mode).toBe('light');
        expect(readPublicTheme('no es un objeto')).toEqual(DEFAULT_PUBLIC_THEME);
    });

    it('el modo oscuro automático calcula una paleta legible con el acento aclarado', () => {
        const dark = deriveDarkPalette(DEFAULT_PUBLIC_THEME.colors, '#1e3a8a');
        expect(contrastRatio(dark.text, dark.card)).toBeGreaterThan(7);
        expect(contrastRatio(dark.accent, dark.card)).toBeGreaterThanOrEqual(3);
        const theme = publicThemeSchema.parse({ mode: 'auto' });
        const css = buildPublicThemeCss(theme, { accent: '#1e3a8a' });
        expect(css).toContain('@media (prefers-color-scheme: dark)');
        expect(css).toContain(':root[data-scheme=dark]');
        expect(resolvePublicPalettes(publicThemeSchema.parse({}), '#1e3a8a').dark).toBeNull();
    });

    it('el acento como texto se oscurece hasta leerse sobre la tarjeta', () => {
        const yellow = '#ffe14d';
        const fixed = ensureContrast(yellow, '#ffffff', 4.5);
        expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
        const css = buildPublicThemeCss(DEFAULT_PUBLIC_THEME, { accent: yellow });
        expect(css).toContain(`--ib-accent:${yellow}`);
        expect(css).toContain('--ib-accent-ink:#111827');
    });

    it('sólo pide las fuentes web que usa, y precarga la del texto', () => {
        const t = publicThemeSchema.parse({ typography: { font: 'inter', heading_font: 'playfair' } });
        expect(publicThemeWebFonts(t).sort()).toEqual(['inter', 'playfair']);
        const css = buildPublicThemeCss(t, { accent: '#0e7490' });
        expect(css).toContain('/email-fonts/inter-400-normal.woff2');
        expect(css).toContain('/email-fonts/playfair-700-normal.woff2');
        expect(css).not.toContain('lora');
        expect(publicThemePreloadFont(t)).toBe('/email-fonts/inter-400-normal.woff2');
        expect(publicThemePreloadFont(DEFAULT_PUBLIC_THEME)).toBeNull();
    });

    it('fondo, portada y panel dividido: imágenes propias y nada de URLs raras', () => {
        const t = publicThemeSchema.parse({
            background: { kind: 'image', file_id: 3, blur: 6, overlay: 0.3 },
            cover: { enabled: true, file_id: 4, overlay: 0.2 },
            split: { enabled: true, side: 'right', file_id: 5 },
        });
        expect(publicThemeFileIds(t).sort()).toEqual([3, 4, 5]);
        const css = buildPublicThemeCss(t, {
            accent: '#0e7490',
            images: { background: '/api/v1/files/3/signed?tenant=1&exp=1&sig=x', cover: 'javascript:alert(1)', split: '/api/v1/files/5/signed?x=1' },
        });
        expect(css).toContain('url("/api/v1/files/3/signed?tenant=1&exp=1&sig=x")');
        expect(css).toContain('filter:blur(6px)');
        expect(css).not.toContain('javascript');
        // Sin imagen válida, la portada es un degradado de la marca.
        expect(css).toMatch(/\.ib-cover\{background:linear-gradient\(rgba\(0,0,0,0\.2\),rgba\(0,0,0,0\.2\)\),linear-gradient\(135deg, #0e7490/);
        expect(publicThemeView(t).classes).toEqual(expect.arrayContaining(['ib-split', 'ib-split-right', 'ib-has-bg']));
        expect(cssUrl('//evil.com/x.png')).toBeNull();
        expect(cssUrl('https://ok.test/a b')).toBeNull();
    });

    it('el CSS propio no puede cargar nada de afuera ni cerrar la etiqueta', () => {
        const r = sanitizePublicCss(
            `@import url(https://evil.test/x.css); .ib-title{color:red;background:url(https://evil.test/p.png)} </style><script>alert(1)</script>
             .a{background:u\\72l(https://evil.test)} @font-face{font-family:x;src:url(a.woff)} .b{width:expression(alert(1))} .c{background:image-set("a.png" 1x)}`,
        );
        expect(r.css).not.toMatch(/url\(|@import|<|expression\(|@font-face|image-set\(|\\/i);
        expect(r.css).toContain('.ib-title{color:red;');
        expect(r.removed).toEqual(expect.arrayContaining(['@import', 'url() y otras cargas', 'barras invertidas']));
        // Y el tema lo incluye ya limpio.
        const css = buildPublicThemeCss(publicThemeSchema.parse({ custom_css: '.ib-btn{border-radius:0} </style>' }), { accent: '#0e7490' });
        expect(css).toContain('.ib-btn{border-radius:0}');
        expect(css).not.toContain('</style>');
    });

    it('las 13 plantillas son temas válidos y toman el color de la marca', () => {
        const presets = publicThemePresets('#e11d48');
        expect(presets.map((p) => p.id)).toEqual([...PUBLIC_THEME_PRESET_IDS]);
        for (const p of presets) {
            expect(publicThemeSchema.safeParse(p.theme).success).toBe(true);
            expect(p.theme.preset).toBe(p.id);
            expect(p.swatch.accent).toBe('#e11d48');
            // El texto se lee sobre la tarjeta en todas.
            expect(contrastRatio(p.theme.colors.text, p.theme.colors.card)).toBeGreaterThan(7);
        }
        expect(presets.find((p) => p.id === 'dark')!.theme.mode).toBe('dark');
        expect(presets.find((p) => p.id === 'vibrant')!.theme.background.kind).toBe('gradient');
        // Las redondeadas conservan sus secciones (una sección fuera de rango se perdería entera).
        const pills = presets.find((p) => p.id === 'pills')!.theme;
        expect(pills.button).toMatchObject({ radius: 999, full_width: true, size: 'lg' });
        expect(pills.choices).toMatchObject({ style: 'buttons', radius: 999 });
    });
});

describe('preguntas con el diseño nuevo', () => {
    const fields = [
        { id: 1, slug: 'tipo', label: 'Tipo', type: 'select', is_required: false, config: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } },
        { id: 2, slug: 'extras', label: 'Extras', type: 'multi_select', is_required: false, config: { options: [{ value: 'x', label: 'X' }] } },
        { id: 3, slug: 'nombre', label: 'Nombre', type: 'text', is_required: false, config: {} },
    ];

    it('el estilo de las opciones sale del tema salvo que la pregunta elija otro, con su imagen', () => {
        const config = formConfigSchema.parse({
            items: [
                { id: 'aaaa1111', type: 'field', field_id: 1, option_images: { a: 9 }, width: 'half' },
                { id: 'bbbb2222', type: 'field', field_id: 2, display: 'buttons' },
                { id: 'cccc3333', type: 'field', field_id: 3, width: 'half', hide_label: true },
                { id: 'dddd4444', type: 'image', file_id: 7, alt: 'Local', width: 'third' },
            ],
            settings: { theme: { choices: { style: 'cards' } } },
        });
        const items = buildPublicFormItems(config, fields, [], { imageUrl: (id) => `/api/v1/files/${id}/signed` });
        const tipo = items[0] as Extract<(typeof items)[number], { type: 'field' }>;
        expect(tipo.display).toBe('radio');
        expect(tipo.choice_style).toBe('cards');
        expect(tipo.width).toBe('half');
        expect(tipo.options?.[0]?.image_url).toBe('/api/v1/files/9/signed');
        expect(tipo.options?.[1]?.image_url).toBeUndefined();
        const extras = items[1] as Extract<(typeof items)[number], { type: 'field' }>;
        expect(extras.display).toBe('checkboxes');
        expect(extras.choice_style).toBe('buttons');
        expect((items[2] as { hide_label?: boolean }).hide_label).toBe(true);
        expect(items[3]).toMatchObject({ type: 'image', url: '/api/v1/files/7/signed', alt: 'Local', width: 'third' });
        expect(formConfigFileIds(config).sort()).toEqual([7, 9]);
    });

    it('un formulario guardado antes sigue igual (lista, ancho completo, sin tema)', () => {
        const config = formConfigSchema.parse({ items: [{ id: 'aaaa1111', type: 'field', field_id: 1, display: 'radio' }] });
        expect(config.settings.theme).toBeNull();
        const [item] = buildPublicFormItems(config, fields) as Array<{ choice_style?: string; width?: string; display: string }>;
        expect(item).toMatchObject({ display: 'radio', choice_style: 'list', width: 'full' });
    });
});
