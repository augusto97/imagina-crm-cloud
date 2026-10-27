import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { WHATS_NEW_SLIDE_LIMITS, type WhatsNewMedia, type WhatsNewSlide } from '@imagina-base/shared';

import { loadDemoManifest } from '@/admin/learn/demos/demoManifest';
import { hasIllustration, Illustration, ILLUSTRATION_KEYS } from '@/admin/learn/illustrations/registry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';

/**
 * Lo visual de una novedad en la consola (v0.1.325): la ilustración animada
 * (las del centro de aprendizaje), una captura real paso a paso y el
 * carrusel de diapositivas. La vista previa de al lado los muestra en vivo.
 */

/** `vistas-kanban` → «vistas kanban» (para leer la lista de claves). */
function humanKey(key: string): string {
    return key.replace(/-/g, ' ');
}

function useDemoKeys(): Array<{ key: string; title: string }> {
    const [keys, setKeys] = useState<Array<{ key: string; title: string }>>([]);
    useEffect(() => {
        let alive = true;
        void loadDemoManifest().then((m) => {
            if (!alive || !m) return;
            setKeys(Object.entries(m.demos).map(([key, d]) => ({ key, title: d.title })));
        });
        return () => {
            alive = false;
        };
    }, []);
    return keys;
}

/** Elegir una ilustración por su clave (con sugerencias) y verla. */
export function IllustrationPicker({
    id,
    value,
    onChange,
    label,
}: {
    id: string;
    value: string | null;
    onChange: (v: string | null) => void;
    label: string;
}): JSX.Element {
    const listId = useId();
    const [text, setText] = useState(value ?? '');
    useEffect(() => setText(value ?? ''), [value]);
    const known = value !== null && hasIllustration(value);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Input
                    id={id}
                    list={listId}
                    value={text}
                    placeholder={__('Escribe para buscar: vistas, kanban, correo…')}
                    onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        setText(e.target.value);
                        if (v === '') onChange(null);
                        else if (hasIllustration(v)) onChange(v);
                    }}
                    data-testid={`${id}-input`}
                />
                {value && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} aria-label={__('Quitar la ilustración')}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    </Button>
                )}
            </div>
            <datalist id={listId}>
                {ILLUSTRATION_KEYS.map((k) => (
                    <option key={k} value={k}>
                        {humanKey(k)}
                    </option>
                ))}
            </datalist>
            {text.trim() !== '' && !hasIllustration(text.trim().toLowerCase()) && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elige una de la lista de sugerencias.')}</p>
            )}
            {known && value && (
                <div className="imcrm-max-w-xs" data-testid={`${id}-preview`}>
                    <Illustration name={value} />
                </div>
            )}
        </div>
    );
}

export function WhatsNewMediaEditor({
    media,
    onChange,
    upload,
    problem,
}: {
    media: WhatsNewMedia;
    onChange: (m: WhatsNewMedia) => void;
    /** Lo que falta en lo visual (p. ej. una diapositiva sin título). */
    problem?: string | null;
    /** Sube una imagen y devuelve su URL. */
    upload: (file: File) => Promise<string>;
}): JSX.Element {
    const demos = useDemoKeys();
    const fileRefs = useRef(new Map<number, HTMLInputElement>());
    const [uploadingAt, setUploadingAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const setSlide = (i: number, patch: Partial<WhatsNewSlide>): void =>
        onChange({ ...media, slides: media.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
    const move = (i: number, by: -1 | 1): void => {
        const next = [...media.slides];
        const j = i + by;
        if (j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j]!, next[i]!];
        onChange({ ...media, slides: next });
    };
    const pick = async (i: number, file: File | undefined): Promise<void> => {
        if (!file) return;
        setUploadingAt(i);
        setError(null);
        try {
            setSlide(i, { image_url: await upload(file) });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploadingAt(null);
            const el = fileRefs.current.get(i);
            if (el) el.value = '';
        }
    };

    return (
        <fieldset className="imcrm-m-0 imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3.5" data-testid="whats-new-media-editor">
            <legend className="imcrm-px-1 imcrm-text-sm imcrm-font-medium">{__('Animación y carrusel (opcional)')}</legend>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {__('Las ilustraciones se animan con los colores de cada empresa, en modo claro y oscuro. Si pones una imagen arriba, la imagen va primero.')}
            </p>
            <IllustrationPicker id="wn-illustration" label={__('Ilustración animada')} value={media.illustration} onChange={(v) => onChange({ ...media, illustration: v })} />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="wn-demo">{__('Captura real paso a paso')}</Label>
                <select
                    id="wn-demo"
                    value={media.demo ?? ''}
                    onChange={(e) => onChange({ ...media, demo: e.target.value || null })}
                    className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                >
                    <option value="">{__('Sin captura')}</option>
                    {media.demo && !demos.some((d) => d.key === media.demo) && <option value={media.demo}>{media.demo}</option>}
                    {demos.map((d) => (
                        <option key={d.key} value={d.key}>
                            {d.title}
                        </option>
                    ))}
                </select>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {demos.length === 0
                        ? __('Este servidor no tiene capturas grabadas: se ve la ilustración.')
                        : __('Si en un servidor no hay capturas, se ve la ilustración.')}
                </p>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Carrusel de diapositivas')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(__('%1$d de %2$d'), media.slides.length, WHATS_NEW_SLIDE_LIMITS.max)}
                    </span>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para mostrar varias cosas de la novedad, una por diapositiva. Si hay diapositivas, reemplazan a la ilustración de arriba.')}
                </p>
                {media.slides.map((s, i) => (
                    <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid={`whats-new-slide-editor-${i}`}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                            <span className="imcrm-text-xs imcrm-font-semibold imcrm-text-muted-foreground">{sprintf(__('Diapositiva %d'), i + 1)}</span>
                            <span className="imcrm-flex-1" />
                            <Button type="button" size="sm" variant="ghost" className="imcrm-h-7 imcrm-w-7 imcrm-p-0" onClick={() => move(i, -1)} disabled={i === 0} aria-label={__('Subir')}>
                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="imcrm-h-7 imcrm-w-7 imcrm-p-0" onClick={() => move(i, 1)} disabled={i === media.slides.length - 1} aria-label={__('Bajar')}>
                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="imcrm-h-7 imcrm-w-7 imcrm-p-0"
                                onClick={() => onChange({ ...media, slides: media.slides.filter((_, j) => j !== i) })}
                                aria-label={__('Quitar la diapositiva')}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            </Button>
                        </div>
                        <Input
                            value={s.title}
                            maxLength={WHATS_NEW_SLIDE_LIMITS.title}
                            onChange={(e) => setSlide(i, { title: e.target.value })}
                            placeholder={__('Título de la diapositiva')}
                            aria-label={sprintf(__('Título de la diapositiva %d'), i + 1)}
                        />
                        <Textarea
                            rows={2}
                            value={s.text}
                            maxLength={WHATS_NEW_SLIDE_LIMITS.text}
                            onChange={(e) => setSlide(i, { text: e.target.value })}
                            placeholder={__('Una o dos líneas que expliquen esta parte.')}
                            aria-label={sprintf(__('Texto de la diapositiva %d'), i + 1)}
                        />
                        <IllustrationPicker id={`wn-slide-${i}-illustration`} label={__('Ilustración')} value={s.illustration} onChange={(v) => setSlide(i, { illustration: v })} />
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <input
                                ref={(el) => {
                                    if (el) fileRefs.current.set(i, el);
                                    else fileRefs.current.delete(i);
                                }}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="imcrm-sr-only"
                                onChange={(e) => void pick(i, e.target.files?.[0])}
                            />
                            <Button type="button" size="sm" variant="outline" onClick={() => fileRefs.current.get(i)?.click()} disabled={uploadingAt !== null}>
                                {uploadingAt === i ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden /> : <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                {s.image_url ? __('Cambiar la imagen') : __('O una imagen')}
                            </Button>
                            {s.image_url && (
                                <Button type="button" size="sm" variant="ghost" onClick={() => setSlide(i, { image_url: null })}>
                                    {__('Quitar la imagen')}
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
                {(error ?? problem) && <p className="imcrm-text-xs imcrm-text-destructive" data-testid="whats-new-media-error">{error ?? problem}</p>}
                {media.slides.length < WHATS_NEW_SLIDE_LIMITS.max && (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="imcrm-self-start"
                        onClick={() =>
                            onChange({
                                ...media,
                                slides: [...media.slides, { title: '', text: '', illustration: null, demo: null, image_url: null }],
                            })
                        }
                        data-testid="whats-new-add-slide"
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Agregar una diapositiva')}
                    </Button>
                )}
            </div>
        </fieldset>
    );
}
