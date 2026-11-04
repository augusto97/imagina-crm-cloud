import { useMemo } from 'react';
import { AlertTriangle, Code2, Info, Lock } from 'lucide-react';
import {
    DEFAULT_PUBLIC_THEME,
    PUBLIC_CSS_MAX,
    PUBLIC_ROUND_RADIUS,
    contrastRatio,
    mixHex,
    resolvePublicPalettes,
    sanitizePublicCss,
    type FormConfig,
    type PublicTheme,
    type PublicThemeMode,
    type Shadow,
} from '@imagina-base/shared';

import { Choice, ColorField, FontSelect, NumberField, StyleSection } from '@/components/design/DesignStyleControls';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { IMAGE_MAX_SIDE } from '@/lib/imageResize';
import { cn } from '@/lib/utils';

import { Check } from '../../automations/email/EmailBlockInspector';
import { ImageUpload } from './ImageUpload';
import {
    WIDTH_PRESETS,
    effectiveTheme,
    fallbackAccent,
    isClassicTheme,
    patchDarkColor,
    patchTheme,
    patchThemeSection,
    resetThemeSection,
    themeHasCustomCss,
    themeSectionModified,
    type ThemeResetKey,
    type ThemeSectionKey,
} from './themeOps';

/**
 * v0.1.351 (ADR-S94) — Panel de diseño del formulario: TODO el tema en
 * secciones plegables (colores, tipografía, página, fondo, portada,
 * dividido, tarjeta, campos, opciones, botón y CSS propio). Cada cambio pasa
 * por `onChange` (deshacer/rehacer) y la vista previa lo muestra al instante.
 */

type Weight = PublicTheme['typography']['title_weight'];
const WEIGHTS: Array<{ value: string; label: string }> = [
    { value: '400', label: 'Normal' },
    { value: '500', label: 'Media' },
    { value: '600', label: 'Semi' },
    { value: '700', label: 'Negrita' },
    { value: '800', label: 'Extra' },
];
const SHADOW_OPTIONS: Array<{ value: Shadow; label: string }> = [
    { value: 'none', label: 'Sin' },
    { value: 'sm', label: 'Suave' },
    { value: 'md', label: 'Media' },
    { value: 'lg', label: 'Fuerte' },
];
const SIZE_OPTIONS = [
    { value: 'sm', label: 'Chico' },
    { value: 'md', label: 'Mediano' },
    { value: 'lg', label: 'Grande' },
] as const;

/** Clases estables documentadas para el CSS propio. */
const CSS_CLASSES: Array<[string, string]> = [
    ['.ib-card', 'la tarjeta del formulario'],
    ['.ib-header', 'el encabezado (logo, título y descripción)'],
    ['.ib-title', 'el título del formulario'],
    ['.ib-cover', 'la portada'],
    ['.ib-item', 'cada pregunta (etiqueta, campo y ayuda)'],
    ['.ib-label', 'la etiqueta de una pregunta'],
    ['.ib-input', 'los campos de texto, número, fecha y listas'],
    ['.ib-choice', 'cada opción (lista, botón o tarjeta)'],
    ['.ib-help', 'el texto de ayuda de una pregunta'],
    ['.ib-error', 'el mensaje de error'],
    ['.ib-btn-primary', 'el botón de enviar y «Siguiente»'],
];

function Hint({ children, warn }: { children: React.ReactNode; warn?: boolean }): JSX.Element {
    return (
        <p
            className={cn(
                'imcrm-flex imcrm-gap-1 imcrm-text-[10.5px] imcrm-leading-snug',
                warn ? 'imcrm-rounded-md imcrm-bg-warning/10 imcrm-px-2 imcrm-py-1.5 imcrm-text-foreground' : 'imcrm-text-muted-foreground',
            )}
        >
            {warn ? <AlertTriangle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-warning" /> : <Info className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />}
            <span>{children}</span>
        </p>
    );
}

function Grid({ children }: { children: React.ReactNode }): JSX.Element {
    return <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">{children}</div>;
}

/** Lo que ofrece el número de esquinas; más allá, «Redondo». */
const RADIUS_MAX = 40;

/**
 * Esquinas de campos, opciones y botón: un número de 0 a 40 px o «Redondo»
 * (PUBLIC_ROUND_RADIUS = 999, completamente redondo). Un 999 guardado se ve
 * con «Redondo» marcado; nunca se recorta a 40.
 */
function RadiusField({ label, value, fallback, onChange, testId }: { label: string; value: number; fallback: number; onChange: (v: number) => void; testId?: string }): JSX.Element {
    const round = value >= PUBLIC_ROUND_RADIUS;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={testId}>
            {round ? (
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>
            ) : (
                <NumberField
                    label={label}
                    unit="px"
                    min={0}
                    // Un valor viejo mayor a 40 (y distinto de «Redondo») se muestra tal cual.
                    max={Math.max(RADIUS_MAX, value)}
                    value={value}
                    placeholder={String(fallback)}
                    onChange={(v) => onChange(v == null ? fallback : Math.round(v))}
                />
            )}
            <Check
                label={__('Redondo (esquinas completas)')}
                checked={round}
                onChange={(on) => onChange(on ? PUBLIC_ROUND_RADIUS : Math.min(fallback, RADIUS_MAX))}
                testId={testId ? `${testId}-round` : undefined}
            />
        </div>
    );
}

function pct(n: number): number {
    return Math.round(n * 100);
}

export function ThemeInspector({
    config,
    onChange,
    brand,
    isAdmin,
    showLogo,
}: {
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    /** Color de la marca de la empresa (acento cuando el tema no fija uno). */
    brand: string;
    /** Sólo un administrador escribe CSS propio. */
    isAdmin: boolean;
    /** Si el formulario muestra el logo (Ajustes). */
    showLogo: boolean;
}): JSX.Element {
    const s = config.settings;
    const t = useMemo(() => effectiveTheme(s), [s]);
    const classic = isClassicTheme(s);
    const fallback = fallbackAccent(s, brand);
    const accent = t.colors.accent ?? s.accent_color ?? null;
    const pal = useMemo(() => resolvePublicPalettes(t, fallback), [t, fallback]);
    const derivedDark = useMemo(() => resolvePublicPalettes({ ...t, mode: 'auto', dark_colors: null }, fallback).dark, [t, fallback]);
    const D = DEFAULT_PUBLIC_THEME;

    const set = <K extends ThemeSectionKey>(key: K, patch: Partial<PublicTheme[K]>): void => onChange(patchThemeSection(config, key, patch));
    const sec = (key: ThemeResetKey) => ({
        modified: themeSectionModified(s, key),
        onReset: () => onChange(resetThemeSection(config, key)),
    });
    const int = (v: number | null, def: number): number => (v == null ? def : Math.round(v));

    // Contraste del texto sobre la superficie donde se lee (tarjeta, o fondo sin tarjeta).
    const surface = t.layout.container === 'plain' ? pal.main.background : pal.main.card;
    const textContrast = contrastRatio(pal.main.text, surface);
    const mutedContrast = contrastRatio(pal.main.muted, surface);
    const cssCheck = useMemo(() => sanitizePublicCss(t.custom_css), [t.custom_css]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-p-4" data-tour="form-design-inspector" data-testid="form-design-inspector">
            <div>
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Diseño del formulario')}</p>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {classic
                        ? __('Tiene el diseño de siempre («Clásico»). Elige una plantilla o cambia cualquier ajuste.')
                        : __('Vale para todo el formulario. Toca una pregunta en la vista previa para darle su propio diseño.')}
                </p>
            </div>

            <StyleSection title={__('Colores')} defaultOpen testId="form-theme-colors" {...sec('colors')}>
                <Choice<PublicThemeMode>
                    label={__('Modo')}
                    value={t.mode}
                    options={[
                        { value: 'light', label: __('Claro') },
                        { value: 'dark', label: __('Oscuro') },
                        { value: 'auto', label: __('Automático'), title: __('Según el dispositivo') },
                    ]}
                    onChange={(v) => onChange(patchTheme(config, { mode: v }))}
                />
                {t.mode === 'auto' && (
                    <Hint>{__('Se ve claro u oscuro según el dispositivo de quien responde. Para ver cada uno, usa «Claro / Oscuro» arriba de la vista previa.')}</Hint>
                )}
                {t.mode === 'dark' && <Hint>{__('Oscuro siempre: elige colores oscuros para el fondo y la tarjeta (o aplica la plantilla «Oscuro»).')}</Hint>}
                <ColorField
                    label={__('Acento (botones y detalles)')}
                    value={accent}
                    placeholder={brand}
                    onChange={(v) => set('colors', { accent: v })}
                />
                <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Vacío = el color de tu marca.')}</p>
                <Grid>
                    <ColorField label={__('Fondo')} value={t.colors.background} allowEmpty={false} onChange={(v) => v && set('colors', { background: v })} />
                    <ColorField label={__('Tarjeta')} value={t.colors.card} allowEmpty={false} onChange={(v) => v && set('colors', { card: v })} />
                    <ColorField label={__('Texto')} value={t.colors.text} allowEmpty={false} onChange={(v) => v && set('colors', { text: v })} />
                    <ColorField label={__('Texto secundario')} value={t.colors.muted} allowEmpty={false} onChange={(v) => v && set('colors', { muted: v })} />
                    <ColorField label={__('Bordes')} value={t.colors.border} allowEmpty={false} onChange={(v) => v && set('colors', { border: v })} />
                    <ColorField label={__('Errores')} value={t.colors.error} allowEmpty={false} onChange={(v) => v && set('colors', { error: v })} />
                    <ColorField label={__('Fondo de los campos')} value={t.colors.input_bg} allowEmpty={false} onChange={(v) => v && set('colors', { input_bg: v })} />
                    <ColorField label={__('Borde de los campos')} value={t.colors.input_border} allowEmpty={false} onChange={(v) => v && set('colors', { input_border: v })} />
                </Grid>
                {textContrast < 4.5 && (
                    <Hint warn>
                        {__('El texto se lee poco sobre la tarjeta (contraste %s a 1; lo recomendado es 4,5 a 1).').replace('%s', textContrast.toFixed(1).replace('.', ','))}
                    </Hint>
                )}
                {textContrast >= 4.5 && mutedContrast < 3 && <Hint warn>{__('El texto secundario (ayudas, ejemplos) casi no se ve sobre la tarjeta.')}</Hint>}

                {t.mode === 'auto' && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-testid="form-theme-dark-colors">
                        <Choice<'auto' | 'custom'>
                            label={__('Colores del modo oscuro')}
                            value={t.dark_colors ? 'custom' : 'auto'}
                            options={[
                                { value: 'auto', label: __('Automáticos'), title: __('Automáticos (recomendado)') },
                                { value: 'custom', label: __('Personalizar') },
                            ]}
                            onChange={(v) => onChange(patchTheme(config, { dark_colors: v === 'custom' ? (t.dark_colors ?? {}) : null }))}
                        />
                        {!t.dark_colors ? (
                            <Hint>{__('Automáticos (recomendado): se calculan solos a partir de los claros, con buen contraste.')}</Hint>
                        ) : (
                            <>
                                <Hint>{__('Vacío = el calculado (se ve punteado).')}</Hint>
                                <ColorField
                                    label={__('Acento')}
                                    value={t.dark_colors.accent ?? null}
                                    placeholder={derivedDark?.accent}
                                    onChange={(v) => onChange(patchDarkColor(config, 'accent', v))}
                                />
                                <Grid>
                                    {(
                                        [
                                            ['background', __('Fondo')],
                                            ['card', __('Tarjeta')],
                                            ['text', __('Texto')],
                                            ['muted', __('Texto secundario')],
                                            ['border', __('Bordes')],
                                            ['error', __('Errores')],
                                            ['input_bg', __('Fondo de los campos')],
                                            ['input_border', __('Borde de los campos')],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <ColorField
                                            key={key}
                                            label={label}
                                            value={t.dark_colors?.[key] ?? null}
                                            placeholder={derivedDark?.[key]}
                                            onChange={(v) => onChange(patchDarkColor(config, key, v))}
                                        />
                                    ))}
                                </Grid>
                            </>
                        )}
                    </div>
                )}
            </StyleSection>

            <StyleSection title={__('Tipografía')} testId="form-theme-typography" {...sec('typography')}>
                <FontSelect label={__('Fuente del texto')} value={t.typography.font} onChange={(f) => f && set('typography', { font: f })} medium="web" />
                <FontSelect
                    label={__('Fuente de los títulos')}
                    value={t.typography.heading_font}
                    onChange={(f) => set('typography', { heading_font: f })}
                    medium="web"
                    inheritLabel={__('La misma del texto')}
                />
                <Grid>
                    <NumberField
                        label={__('Tamaño del texto')}
                        unit="px"
                        min={12}
                        max={22}
                        value={t.typography.base_size}
                        placeholder={String(D.typography.base_size)}
                        onChange={(v) => set('typography', { base_size: int(v, D.typography.base_size) })}
                    />
                    <NumberField
                        label={__('Interlineado')}
                        min={1.1}
                        max={2.2}
                        step={0.05}
                        value={t.typography.line_height}
                        placeholder="1,5"
                        onChange={(v) => set('typography', { line_height: v ?? D.typography.line_height })}
                    />
                    <NumberField
                        label={__('Tamaño del título')}
                        unit="px"
                        min={16}
                        max={64}
                        value={t.typography.title_size}
                        placeholder={String(D.typography.title_size)}
                        onChange={(v) => set('typography', { title_size: int(v, D.typography.title_size) })}
                    />
                    <NumberField
                        label={__('Letras del título')}
                        unit="px"
                        min={-2}
                        max={8}
                        step={0.1}
                        value={t.typography.title_letter_spacing}
                        placeholder="-0,24"
                        onChange={(v) => set('typography', { title_letter_spacing: v ?? D.typography.title_letter_spacing })}
                    />
                    <NumberField
                        label={__('Tamaño de las preguntas')}
                        unit="px"
                        min={12}
                        max={30}
                        value={t.typography.question_size}
                        placeholder={String(D.typography.question_size)}
                        onChange={(v) => set('typography', { question_size: int(v, D.typography.question_size) })}
                    />
                </Grid>
                <Choice
                    label={__('Peso del título')}
                    value={String(t.typography.title_weight)}
                    options={WEIGHTS.map((w) => ({ ...w, label: __(w.label) }))}
                    onChange={(v) => set('typography', { title_weight: Number(v) as Weight })}
                />
                <Choice
                    label={__('Peso de las preguntas')}
                    value={String(t.typography.question_weight)}
                    options={WEIGHTS.map((w) => ({ ...w, label: __(w.label) }))}
                    onChange={(v) => set('typography', { question_weight: Number(v) as Weight })}
                />
            </StyleSection>

            <StyleSection title={__('Página')} testId="form-theme-layout" {...sec('layout')}>
                <Choice
                    label={__('Ancho del formulario')}
                    value={String(t.layout.width)}
                    options={WIDTH_PRESETS.map((w) => ({ value: String(w.value), label: __(w.label), title: `${w.value} px` }))}
                    onChange={(v) => set('layout', { width: Number(v) })}
                />
                <Grid>
                    <NumberField
                        label={__('Ancho exacto')}
                        unit="px"
                        min={360}
                        max={1200}
                        step={10}
                        value={t.layout.width}
                        placeholder={String(D.layout.width)}
                        onChange={(v) => set('layout', { width: int(v, D.layout.width) })}
                    />
                    <NumberField
                        label={__('Alto del logo')}
                        unit="px"
                        min={16}
                        max={160}
                        value={t.layout.logo_size}
                        placeholder={String(D.layout.logo_size)}
                        onChange={(v) => set('layout', { logo_size: int(v, D.layout.logo_size) })}
                    />
                    <NumberField
                        label={__('Relleno')}
                        unit="px"
                        min={8}
                        max={72}
                        value={t.layout.padding}
                        placeholder={String(D.layout.padding)}
                        onChange={(v) => set('layout', { padding: int(v, D.layout.padding) })}
                    />
                    <NumberField
                        label={__('Entre preguntas')}
                        unit="px"
                        min={4}
                        max={56}
                        value={t.layout.gap}
                        placeholder={String(D.layout.gap)}
                        onChange={(v) => set('layout', { gap: int(v, D.layout.gap) })}
                    />
                </Grid>
                {!showLogo && <Hint>{__('El logo se muestra si lo enciendes en «Ajustes» (Mostrar el logo de la empresa).')}</Hint>}
                <Choice
                    label={__('Contenedor')}
                    value={t.layout.container}
                    options={[
                        { value: 'card', label: __('Con tarjeta') },
                        { value: 'plain', label: __('Sin tarjeta') },
                    ]}
                    onChange={(v) => set('layout', { container: v })}
                />
                <Choice
                    label={__('Encabezado')}
                    value={t.layout.header_align}
                    options={[
                        { value: 'left', label: __('A la izquierda') },
                        { value: 'center', label: __('Centrado') },
                    ]}
                    onChange={(v) => set('layout', { header_align: v })}
                />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Check label={__('Mostrar el título')} checked={t.layout.show_title} onChange={(v) => set('layout', { show_title: v })} />
                    <Check label={__('Mostrar la descripción')} checked={t.layout.show_description} onChange={(v) => set('layout', { show_description: v })} />
                    <Check
                        label={__('Franja de color arriba de la tarjeta')}
                        checked={t.layout.band && !t.cover.enabled}
                        disabled={t.cover.enabled}
                        onChange={(v) => set('layout', { band: v })}
                    />
                    <Check label={__('Centrar en la pantalla')} checked={t.layout.vertical_center} onChange={(v) => set('layout', { vertical_center: v })} />
                    <Check
                        label={__('Al insertarlo en otro sitio, mostrar el fondo')}
                        checked={t.layout.embed_background}
                        onChange={(v) => set('layout', { embed_background: v })}
                    />
                </div>
                {t.cover.enabled && <Hint>{__('Con portada no se dibuja la franja de color.')}</Hint>}
                <Choice
                    label={__('Avance (varias páginas)')}
                    value={t.layout.progress}
                    options={[
                        { value: 'bar', label: __('Barra') },
                        { value: 'steps', label: __('Pasos') },
                        { value: 'none', label: __('Nada') },
                    ]}
                    onChange={(v) => set('layout', { progress: v })}
                />
                <Hint>{__('El avance sólo se ve si el formulario tiene saltos de página.')}</Hint>
            </StyleSection>

            <StyleSection title={__('Fondo')} testId="form-theme-background" {...sec('background')}>
                <Choice
                    label={__('Tipo de fondo')}
                    value={t.background.kind}
                    options={[
                        { value: 'color', label: __('Color') },
                        { value: 'gradient', label: __('Degradado') },
                        { value: 'image', label: __('Imagen') },
                    ]}
                    onChange={(v) => set('background', { kind: v })}
                />
                {t.background.kind !== 'image' && (
                    <Grid>
                        <ColorField
                            label={t.background.kind === 'gradient' ? __('Desde') : __('Color del fondo')}
                            value={t.colors.background}
                            allowEmpty={false}
                            onChange={(v) => v && set('colors', { background: v })}
                        />
                        {t.background.kind === 'gradient' && (
                            <ColorField
                                label={__('Hasta')}
                                value={t.background.gradient_to}
                                placeholder={mixHex(pal.main.background, pal.main.accent, 0.35)}
                                onChange={(v) => set('background', { gradient_to: v })}
                            />
                        )}
                    </Grid>
                )}
                {t.background.kind === 'gradient' && (
                    <NumberField
                        label={__('Ángulo')}
                        unit="°"
                        min={0}
                        max={360}
                        step={15}
                        value={t.background.gradient_angle}
                        placeholder="135"
                        onChange={(v) => set('background', { gradient_angle: int(v, D.background.gradient_angle) })}
                    />
                )}
                {t.background.kind === 'image' && (
                    <>
                        <ImageUpload
                            label={__('Imagen de fondo')}
                            fileId={t.background.file_id}
                            maxSide={IMAGE_MAX_SIDE.background}
                            onChange={(id) => set('background', { file_id: id })}
                            hint={t.background.file_id === null ? __('Mientras no subas una, se usa el color de fondo.') : undefined}
                            testId="form-theme-bg-image"
                        />
                        <Choice
                            label={__('Ajuste')}
                            value={t.background.fit}
                            options={[
                                { value: 'cover', label: __('Cubrir') },
                                { value: 'contain', label: __('Contener') },
                                { value: 'repeat', label: __('Repetir') },
                            ]}
                            onChange={(v) => set('background', { fit: v })}
                        />
                        <Grid>
                            <NumberField
                                label={__('Oscurecer')}
                                unit="%"
                                min={0}
                                max={85}
                                step={5}
                                value={pct(t.background.overlay)}
                                placeholder="0"
                                onChange={(v) => set('background', { overlay: (v ?? 0) / 100 })}
                            />
                            <NumberField
                                label={__('Desenfoque')}
                                unit="px"
                                min={0}
                                max={24}
                                value={t.background.blur}
                                placeholder="0"
                                onChange={(v) => set('background', { blur: int(v, 0) })}
                            />
                        </Grid>
                    </>
                )}
                <Choice
                    label={__('Patrón')}
                    value={t.background.pattern}
                    options={[
                        { value: 'none', label: __('Ninguno') },
                        { value: 'dots', label: __('Puntos') },
                        { value: 'grid', label: __('Cuadrícula') },
                        { value: 'diagonal', label: __('Diagonal') },
                    ]}
                    onChange={(v) => set('background', { pattern: v })}
                />
            </StyleSection>

            <StyleSection title={__('Portada')} testId="form-theme-cover" {...sec('cover')}>
                <Check label={__('Mostrar una portada arriba de la tarjeta')} checked={t.cover.enabled} onChange={(v) => set('cover', { enabled: v })} testId="form-theme-cover-toggle" />
                {t.cover.enabled && (
                    <>
                        <Hint>{__('Sin imagen se usa un degradado del color de tu marca.')}</Hint>
                        <ImageUpload
                            label={__('Imagen de la portada')}
                            fileId={t.cover.file_id}
                            maxSide={IMAGE_MAX_SIDE.cover}
                            onChange={(id) => set('cover', { file_id: id })}
                            testId="form-theme-cover-image"
                        />
                        <Grid>
                            <NumberField
                                label={__('Alto')}
                                unit="px"
                                min={60}
                                max={480}
                                step={10}
                                value={t.cover.height}
                                placeholder={String(D.cover.height)}
                                onChange={(v) => set('cover', { height: int(v, D.cover.height) })}
                            />
                            <NumberField
                                label={__('Oscurecer')}
                                unit="%"
                                min={0}
                                max={85}
                                step={5}
                                value={pct(t.cover.overlay)}
                                placeholder="0"
                                onChange={(v) => set('cover', { overlay: (v ?? 0) / 100 })}
                            />
                        </Grid>
                        {t.cover.file_id !== null && (
                            <Choice
                                label={__('Parte de la imagen que se ve')}
                                value={t.cover.position}
                                options={[
                                    { value: 'top', label: __('Arriba') },
                                    { value: 'center', label: __('Centro') },
                                    { value: 'bottom', label: __('Abajo') },
                                ]}
                                onChange={(v) => set('cover', { position: v })}
                            />
                        )}
                    </>
                )}
            </StyleSection>

            <StyleSection title={__('Dividido')} testId="form-theme-split" {...sec('split')}>
                <Check label={__('Dividir la pantalla: una imagen al costado')} checked={t.split.enabled} onChange={(v) => set('split', { enabled: v })} testId="form-theme-split-toggle" />
                {t.split.enabled && (
                    <>
                        <Hint>{__('Sin imagen se usa el color de tu marca. En el celular, la imagen va arriba del formulario.')}</Hint>
                        <Choice
                            label={__('Lado de la imagen')}
                            value={t.split.side}
                            options={[
                                { value: 'left', label: __('Izquierda') },
                                { value: 'right', label: __('Derecha') },
                            ]}
                            onChange={(v) => set('split', { side: v })}
                        />
                        <ImageUpload
                            label={__('Imagen del costado')}
                            fileId={t.split.file_id}
                            maxSide={IMAGE_MAX_SIDE.split}
                            onChange={(id) => set('split', { file_id: id })}
                            testId="form-theme-split-image"
                        />
                        <Grid>
                            <ColorField label={__('Color del panel')} value={t.split.color} placeholder={pal.main.accent} onChange={(v) => set('split', { color: v })} />
                            <NumberField
                                label={__('Oscurecer')}
                                unit="%"
                                min={0}
                                max={85}
                                step={5}
                                value={pct(t.split.overlay)}
                                placeholder="0"
                                onChange={(v) => set('split', { overlay: (v ?? 0) / 100 })}
                            />
                        </Grid>
                        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Frase grande sobre el panel (opcional)')}</span>
                            <Input
                                value={t.split.headline}
                                maxLength={160}
                                placeholder={__('Ej.: Cuéntanos de tu proyecto')}
                                onChange={(e) => set('split', { headline: e.target.value })}
                                className="imcrm-h-8 imcrm-text-xs"
                            />
                        </label>
                    </>
                )}
            </StyleSection>

            <StyleSection title={__('Tarjeta')} testId="form-theme-card" {...sec('card')}>
                {t.layout.container === 'plain' && <Hint>{__('El formulario está «Sin tarjeta» (Página): estos ajustes no se ven.')}</Hint>}
                <Grid>
                    <NumberField
                        label={__('Esquinas')}
                        unit="px"
                        min={0}
                        max={48}
                        value={t.card.radius}
                        placeholder={String(D.card.radius)}
                        onChange={(v) => set('card', { radius: int(v, D.card.radius) })}
                    />
                    <NumberField
                        label={__('Borde')}
                        unit="px"
                        min={0}
                        max={4}
                        value={t.card.border_width}
                        placeholder={String(D.card.border_width)}
                        onChange={(v) => set('card', { border_width: int(v, D.card.border_width) })}
                    />
                </Grid>
                <Choice<Shadow> label={__('Sombra')} value={t.card.shadow} options={SHADOW_OPTIONS.map((o) => ({ ...o, label: __(o.label) }))} onChange={(v) => set('card', { shadow: v })} />
            </StyleSection>

            <StyleSection title={__('Campos')} testId="form-theme-inputs" {...sec('inputs')}>
                <Choice
                    label={__('Estilo')}
                    value={t.inputs.style}
                    options={[
                        { value: 'outlined', label: __('Borde'), title: __('Con borde') },
                        { value: 'filled', label: __('Relleno'), title: __('Con relleno') },
                        { value: 'underline', label: __('Línea'), title: __('Sólo una línea abajo') },
                        { value: 'pill', label: __('Redondo'), title: __('Redondeado') },
                    ]}
                    onChange={(v) => set('inputs', { style: v })}
                />
                <Choice
                    label={__('Tamaño')}
                    value={t.inputs.size}
                    options={SIZE_OPTIONS.map((o) => ({ ...o, label: __(o.label) }))}
                    onChange={(v) => set('inputs', { size: v })}
                />
                {t.inputs.style !== 'pill' && t.inputs.style !== 'underline' && (
                    <RadiusField
                        label={__('Esquinas')}
                        value={t.inputs.radius}
                        fallback={D.inputs.radius}
                        onChange={(radius) => set('inputs', { radius })}
                        testId="form-theme-inputs-radius"
                    />
                )}
                {t.inputs.style === 'pill' && <Hint>{__('«Redondo»: los campos llevan las esquinas completamente redondas.')}</Hint>}
                <Grid>
                    <NumberField
                        label={__('Grosor del borde')}
                        unit="px"
                        min={0}
                        max={3}
                        step={0.5}
                        value={t.inputs.border_width}
                        placeholder={String(D.inputs.border_width)}
                        onChange={(v) => set('inputs', { border_width: v ?? D.inputs.border_width })}
                    />
                </Grid>
                <Choice
                    label={__('Etiqueta de cada pregunta')}
                    value={t.inputs.label_position}
                    options={[
                        { value: 'top', label: __('Arriba') },
                        { value: 'left', label: __('Al costado'), title: __('A la izquierda') },
                        { value: 'floating', label: __('Dentro'), title: __('Dentro del campo') },
                    ]}
                    onChange={(v) => set('inputs', { label_position: v })}
                />
                {t.inputs.label_position === 'left' && <Hint>{__('A la izquierda en pantallas anchas; en el celular queda arriba.')}</Hint>}
                {t.inputs.label_position === 'floating' && <Hint>{__('La etiqueta va dentro del campo y sube al escribir.')}</Hint>}
            </StyleSection>

            <StyleSection title={__('Opciones')} testId="form-theme-choices" {...sec('choices')}>
                <Choice
                    label={__('Cómo se ven las opciones')}
                    value={t.choices.style}
                    options={[
                        { value: 'list', label: __('Lista') },
                        { value: 'buttons', label: __('Botones') },
                        { value: 'cards', label: __('Tarjetas') },
                    ]}
                    onChange={(v) => set('choices', { style: v })}
                />
                <Choice
                    label={__('Columnas')}
                    value={String(t.choices.columns)}
                    options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
                    onChange={(v) => set('choices', { columns: Number(v) })}
                />
                <RadiusField
                    label={__('Esquinas')}
                    value={t.choices.radius}
                    fallback={D.choices.radius}
                    onChange={(radius) => set('choices', { radius })}
                    testId="form-theme-choices-radius"
                />
                <Choice
                    label={__('Imágenes de las tarjetas')}
                    value={t.choices.image_ratio}
                    options={[
                        { value: 'square', label: __('Cuadradas') },
                        { value: 'landscape', label: __('Horizontales') },
                        { value: 'portrait', label: __('Verticales') },
                    ]}
                    onChange={(v) => set('choices', { image_ratio: v })}
                />
                <Hint>{__('En el celular, como mucho 2 columnas. Cada pregunta puede elegir otro estilo en «Diseño de esta pregunta».')}</Hint>
            </StyleSection>

            <StyleSection title={__('Botón')} testId="form-theme-button" {...sec('button')}>
                <Choice
                    label={__('Estilo')}
                    value={t.button.style}
                    options={[
                        { value: 'filled', label: __('Relleno') },
                        { value: 'outline', label: __('Contorno') },
                        { value: 'soft', label: __('Suave') },
                        { value: 'text', label: __('Texto'), title: __('Sólo texto') },
                    ]}
                    onChange={(v) => set('button', { style: v })}
                />
                <Choice
                    label={__('Tamaño')}
                    value={t.button.size}
                    options={SIZE_OPTIONS.map((o) => ({ ...o, label: __(o.label) }))}
                    onChange={(v) => set('button', { size: v })}
                />
                {!t.button.full_width && (
                    <Choice
                        label={__('Alineación')}
                        value={t.button.align}
                        options={[
                            { value: 'left', label: __('Izquierda') },
                            { value: 'center', label: __('Centro') },
                            { value: 'right', label: __('Derecha') },
                        ]}
                        onChange={(v) => set('button', { align: v })}
                    />
                )}
                <RadiusField
                    label={__('Esquinas')}
                    value={t.button.radius}
                    fallback={D.button.radius}
                    onChange={(radius) => set('button', { radius })}
                    testId="form-theme-button-radius"
                />
                <Choice
                    label={__('Ícono')}
                    value={t.button.icon}
                    options={[
                        { value: 'none', label: __('Ninguno') },
                        { value: 'arrow', label: '→', title: __('Flecha') },
                        { value: 'send', label: __('Enviar'), title: __('Avión de papel') },
                        { value: 'check', label: '✓', title: __('Visto') },
                    ]}
                    onChange={(v) => set('button', { icon: v })}
                />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Check label={__('Ancho completo')} checked={t.button.full_width} onChange={(v) => set('button', { full_width: v })} />
                    <Check label={__('Con sombra')} checked={t.button.shadow} onChange={(v) => set('button', { shadow: v })} />
                    <Check label={__('Texto en mayúsculas')} checked={t.button.uppercase} onChange={(v) => set('button', { uppercase: v })} />
                </div>
            </StyleSection>

            <StyleSection
                title={__('CSS propio')}
                testId="form-theme-css"
                modified={themeSectionModified(s, 'custom_css')}
                onReset={isAdmin ? () => onChange(resetThemeSection(config, 'custom_css')) : undefined}
            >
                {isAdmin ? (
                    <>
                        <Hint>{__('Para retoques finos. Se aplica sobre este diseño, también en la vista previa. No se permite cargar nada de afuera (url, @import).')}</Hint>
                        <Textarea
                            rows={8}
                            spellCheck={false}
                            value={t.custom_css}
                            maxLength={PUBLIC_CSS_MAX}
                            placeholder={'.ib-title {\n  letter-spacing: 1px;\n}'}
                            onChange={(e) => onChange(patchTheme(config, { custom_css: e.target.value.slice(0, PUBLIC_CSS_MAX) }))}
                            className="imcrm-font-mono imcrm-text-[11px] imcrm-leading-relaxed"
                            data-testid="form-theme-css-input"
                        />
                        <p className="imcrm-text-right imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground">
                            {t.custom_css.length.toLocaleString('es')} / {PUBLIC_CSS_MAX.toLocaleString('es')}
                        </p>
                        {cssCheck.removed.length > 0 && (
                            <Hint warn>
                                {__('Al publicarlo se quita: %s.').replace('%s', cssCheck.removed.join(', '))}
                            </Hint>
                        )}
                        <details className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-text-[11px]">
                            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-px-2 imcrm-py-1.5 imcrm-font-medium">
                                <Code2 className="imcrm-h-3 imcrm-w-3" />
                                {__('Clases que puedes usar')}
                            </summary>
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                                {CSS_CLASSES.map(([cls, what]) => (
                                    <li key={cls} className="imcrm-flex imcrm-gap-2">
                                        <code className="imcrm-shrink-0 imcrm-font-mono imcrm-text-[10.5px] imcrm-text-foreground">{cls}</code>
                                        <span className="imcrm-text-muted-foreground">{__(what)}</span>
                                    </li>
                                ))}
                            </ul>
                            <p className="imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5 imcrm-text-muted-foreground">
                                {__('Los colores del diseño están en variables, por ejemplo var(--ib-accent) y var(--ib-card).')}
                            </p>
                        </details>
                    </>
                ) : (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-theme-css-locked">
                        <Lock className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                        <span>
                            {__('El CSS propio lo agrega un administrador.')}{' '}
                            {themeHasCustomCss(s) && __('Este diseño trae CSS propio y se conserva tal cual.')}
                        </span>
                    </p>
                )}
            </StyleSection>
        </div>
    );
}
