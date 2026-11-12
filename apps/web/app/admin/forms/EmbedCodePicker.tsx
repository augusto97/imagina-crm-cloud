import { useState, type ReactNode } from 'react';
import { AppWindow, CheckIcon, ChevronRight, Copy, Maximize2, PanelRight, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { EmbedDemo } from './EmbedDemo';
import { defaultEmbedLabel, embedCode, embedPopupAttribute, safeHex, withEmbedOrigin, type EmbedMode, type EmbedOpen, type EmbedTarget } from './embedCode';
import { highlightEmbedCode, type CodeToken } from './shareHelpers';

const MODES: Array<{ id: EmbedMode; label: string; short: string }> = [
    { id: 'inline', label: 'En la página', short: 'Dentro del contenido de tu página.' },
    { id: 'popup', label: 'Ventana al hacer clic', short: 'Un botón lo abre en una ventana o un panel.' },
    { id: 'float', label: 'Botón flotante', short: 'Fijo en una esquina, como el de un chat.' },
];

/** v0.1.359 — cómo se abre la ventana del botón o del botón flotante. */
const OPENS: Array<{ id: EmbedOpen; label: string; hint: string; icon: LucideIcon }> = [
    { id: 'window', label: 'Ventana', hint: 'Una ventana al centro de la pantalla.', icon: AppWindow },
    { id: 'side', label: 'Panel', hint: 'Entra deslizándose desde un costado; tu página se sigue viendo detrás.', icon: PanelRight },
    { id: 'full', label: 'Completa', hint: 'Ocupa toda la pantalla, sin distracciones. Ideal para formularios largos.', icon: Maximize2 },
];

const WHERE: Record<EmbedMode, string> = {
    inline: 'Pégalo en tu página donde quieras que aparezca.',
    popup: 'Pégalo donde quieras el botón. Si pones varios, el script basta una vez por página.',
    float: 'Pégalo una vez en las páginas donde quieras el botón (por ejemplo, en el pie de tu sitio).',
};

/**
 * v0.1.352 (ADR-S95) — Cómo insertar el formulario o la agenda en el sitio de
 * la empresa: en la página, en una ventana al hacer clic o con un botón
 * flotante. Las dos últimas no cargan nada hasta que alguien las usa.
 *
 * v0.1.397 — En tres pasos (cómo va, ajústalo, copia el código), con el código
 * completo en un bloque que se lee y la demostración en vivo ocupando todo el
 * alto a la derecha. En pantallas angostas: elegir → ver cómo queda → copiar.
 */
export function EmbedCodePicker({
    target,
    accent,
    testId,
    dataTour,
    bare,
    demo,
    extra,
    embedOrigin,
}: {
    target: EmbedTarget;
    accent: string;
    testId: string;
    dataTour?: string;
    /**
     * v0.1.369 — «Con su tarjeta» o «Sin marco» al insertarlo en la página. Es
     * parte del diseño (se guarda con el formulario o la agenda), así que el
     * cambio necesita «Guardar» para que tu sitio lo muestre.
     */
    bare?: { value: boolean; onChange: (bare: boolean) => void; unsaved: boolean };
    /**
     * v0.1.381 — La demostración en vivo (un sitio de ejemplo con el formulario
     * o la agenda reales). Sin esto, sólo las opciones y el código.
     */
    demo?: { path: string; version: string; published: boolean; dirty: boolean; onPublish?: () => void; onSave?: () => void; busy?: boolean };
    /** Lo que va debajo del código (p. ej. los sitios permitidos). */
    extra?: ReactNode;
    /**
     * v0.1.409 (ADR-S102) — La dirección rápida (por Cloudflare): el código
     * sale de ahí. La demostración sigue por la dirección de la app.
     */
    embedOrigin?: string | null;
}): JSX.Element {
    const wide = useMediaQuery('(min-width: 1024px)');
    const [mode, setMode] = useState<EmbedMode>('inline');
    const [label, setLabel] = useState(defaultEmbedLabel(target.kind));
    const [color, setColor] = useState(safeHex(accent));
    const [position, setPosition] = useState<'right' | 'left'>('right');
    const [open, setOpen] = useState<EmbedOpen>('window');
    const [copied, setCopied] = useState<'code' | 'attr' | null>(null);
    const codeTarget = withEmbedOrigin(target, embedOrigin);
    const code = embedCode(codeTarget, mode, { label, color, position, open });
    const popupAttr = embedPopupAttribute(codeTarget, open, position);
    // La esquina del flotante y, en el botón, el lado del panel lateral.
    const showSide = mode === 'float' || open === 'side';
    const copy = (text: string, which: 'code' | 'attr'): void => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(which);
            window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
        });
    };

    const chooser = (
        <>
            <Step n={1} title={__('Cómo va en tu sitio')}>
                <div role="radiogroup" aria-label={__('Cómo insertarlo')} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-tour={dataTour}>
                    {MODES.map((m) => {
                        const on = m.id === mode;
                        return (
                            <button
                                key={m.id}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => setMode(m.id)}
                                data-testid={`${testId}-mode-${m.id}`}
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-p-2 imcrm-text-left imcrm-transition-colors',
                                    on ? 'imcrm-border-primary imcrm-bg-primary/[0.06] imcrm-ring-1 imcrm-ring-primary' : 'imcrm-border-border hover:imcrm-border-foreground/20 hover:imcrm-bg-muted/50',
                                )}
                            >
                                <ModeThumb mode={m.id} on={on} />
                                <span className="imcrm-min-w-0 imcrm-flex-1">
                                    <span className="imcrm-block imcrm-text-sm imcrm-font-medium imcrm-leading-tight">{__(m.label)}</span>
                                    <span className="imcrm-mt-0.5 imcrm-block imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{__(m.short)}</span>
                                </span>
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'imcrm-mr-1 imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border-2',
                                        on ? 'imcrm-border-primary' : 'imcrm-border-muted-foreground/40',
                                    )}
                                >
                                    {on && <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary" />}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {mode === 'inline'
                        ? __('Se carga cuando la persona baja hasta él.')
                        : __('No carga nada hasta que alguien lo toca: lo más liviano para un sitio con muchas visitas.')}
                </p>
            </Step>

            <Step n={2} title={mode === 'inline' ? __('Cómo se ve en tu página') : __('El botón y cómo se abre')}>
                {mode === 'inline' ? (
                    bare ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={`${testId}-style`}>
                            <Segmented
                                ariaLabel={__('Cómo se ve en tu página')}
                                value={bare.value ? 'bare' : 'card'}
                                onChange={(v) => bare.onChange(v === 'bare')}
                                options={[
                                    { id: 'card', label: __('Con su tarjeta'), testId: `${testId}-style-card` },
                                    { id: 'bare', label: __('Sin marco'), testId: `${testId}-style-bare` },
                                ]}
                            />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {bare.value
                                    ? __('Sin fondo, sin borde y sin espacio alrededor: ocupa exactamente el lugar que le das.')
                                    : __('Con su fondo y su tarjeta, igual que en el enlace directo.')}
                            </p>
                            {bare.unsaved && <UnsavedNote text={__('Guarda los cambios para que tu sitio lo muestre así.')} />}
                        </div>
                    ) : target.kind === 'shop' ? (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid={`${testId}-shop-inline`}>
                            {__('La tienda se ve completa en el espacio que le das, con su propio scroll: 900 px de alto (puedes cambiarlo en el código).')}
                        </p>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Se ve con su fondo y su tarjeta, igual que en el enlace directo.')}</p>
                    )
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={`${testId}-open`}>
                            <FieldLabel>{__('Se abre como')}</FieldLabel>
                            <Segmented
                                ariaLabel={__('Cómo se abre')}
                                value={open}
                                onChange={setOpen}
                                options={OPENS.map((o) => ({ id: o.id, label: __(o.label), icon: o.icon, title: __(o.hint), testId: `${testId}-open-${o.id}` }))}
                            />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(OPENS.find((o) => o.id === open)!.hint)}</p>
                        </div>
                        <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                            <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                                <FieldLabel>{__('Texto del botón')}</FieldLabel>
                                <Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="imcrm-h-9" data-testid={`${testId}-label`} />
                            </label>
                            <label
                                className="imcrm-relative imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-lg imcrm-shadow-sm imcrm-ring-1 imcrm-ring-inset imcrm-ring-black/10"
                                style={{ background: safeHex(color) }}
                                title={__('Color del botón')}
                            >
                                <input
                                    type="color"
                                    value={safeHex(color)}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full imcrm-cursor-pointer imcrm-opacity-0"
                                    aria-label={__('Color del botón')}
                                    data-testid={`${testId}-color`}
                                />
                            </label>
                        </div>
                        {showSide && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <FieldLabel>{mode === 'float' ? __('Esquina') : __('Lado del panel')}</FieldLabel>
                                <Segmented
                                    ariaLabel={mode === 'float' ? __('Esquina') : __('Lado')}
                                    value={position}
                                    onChange={setPosition}
                                    options={[
                                        { id: 'left', label: __('Izquierda'), testId: `${testId}-side-left` },
                                        { id: 'right', label: __('Derecha'), testId: `${testId}-side-right` },
                                    ]}
                                />
                            </div>
                        )}
                        {bare?.value && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid={`${testId}-style-note`}>
                                {__('«Sin marco» sólo aplica cuando va dentro de tu página: en una ventana o un panel se ve con su tarjeta.')}
                            </p>
                        )}
                    </div>
                )}
            </Step>
        </>
    );

    const codeStep = (
        <Step
            n={3}
            title={__('Copia el código')}
            action={
                <Button size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => copy(code, 'code')} data-testid={`${testId}-copy`}>
                    {copied === 'code' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {copied === 'code' ? __('Copiado') : __('Copiar código')}
                </Button>
            }
        >
            <CodeBlock code={code} testId={testId} />
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(WHERE[mode])}</p>
            {mode === 'popup' && (
                <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid={`${testId}-own-button`}>
                    <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-1.5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-font-medium [&::-webkit-details-marker]:imcrm-hidden">
                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-90" />
                        {__('¿Prefieres usar un botón o enlace que ya tienes?')}
                    </summary>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-2.5">
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agrégale este atributo y pega el script del código una sola vez en la página.')}</p>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <code
                                className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px]"
                                title={popupAttr}
                                data-testid={`${testId}-attr`}
                            >
                                {popupAttr}
                            </code>
                            <Button variant="outline" size="sm" className="imcrm-h-8 imcrm-shrink-0 imcrm-gap-1 imcrm-text-xs" onClick={() => copy(popupAttr, 'attr')} data-testid={`${testId}-attr-copy`}>
                                {copied === 'attr' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {copied === 'attr' ? __('Copiado') : __('Copiar')}
                            </Button>
                        </div>
                    </div>
                </details>
            )}
        </Step>
    );

    if (!demo)
        return (
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-5">
                {chooser}
                {codeStep}
                {extra}
            </div>
        );

    const demoEl = (
        <EmbedDemo
            kind={target.kind}
            path={demo.path}
            version={demo.version}
            mode={mode}
            open={open}
            position={position}
            label={label}
            color={color}
            bare={!!bare?.value}
            published={demo.published}
            dirty={demo.dirty}
            onPublish={demo.onPublish}
            onSave={demo.onSave}
            busy={demo.busy}
            fill={wide}
            testId={testId}
            title={target.title}
        />
    );
    // En la computadora: los pasos a la izquierda (con su propio scroll) y la
    // demostración a la derecha, a todo el alto. En pantallas angostas: elegir →
    // ver cómo queda → copiar el código (en ese orden).
    if (!wide)
        return (
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-5 imcrm-px-4 imcrm-py-4 sm:imcrm-px-5">
                {chooser}
                {demoEl}
                {codeStep}
                {extra}
            </div>
        );
    return (
        <div className="imcrm-grid imcrm-h-full imcrm-min-h-0 imcrm-grid-cols-[minmax(330px,390px)_minmax(0,1fr)]">
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-5 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border imcrm-px-5 imcrm-py-4" data-testid={`${testId}-steps`}>
                {chooser}
                {codeStep}
                {extra}
            </div>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-col imcrm-p-4">{demoEl}</div>
        </div>
    );
}

function Step({ n, title, action, children }: { n: number; title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2.5">
            <div className="imcrm-flex imcrm-min-h-8 imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary">
                    {n}
                </span>
                <h3 className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm imcrm-font-semibold">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
    return <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{children}</span>;
}

function UnsavedNote({ text }: { text: string }): JSX.Element {
    return (
        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium">
            <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-warning" />
            {text}
        </p>
    );
}

/** Un control segmentado (radios con aspecto de pestañas). */
export function Segmented<T extends string>({
    value,
    onChange,
    options,
    ariaLabel,
}: {
    value: T;
    onChange: (v: T) => void;
    options: Array<{ id: T; label: string; icon?: LucideIcon; title?: string; testId?: string }>;
    ariaLabel: string;
}): JSX.Element {
    return (
        <div role="radiogroup" aria-label={ariaLabel} className="imcrm-grid imcrm-auto-cols-fr imcrm-grid-flow-col imcrm-gap-0.5 imcrm-rounded-lg imcrm-bg-muted imcrm-p-0.5">
            {options.map((o) => {
                const on = o.id === value;
                const Icon = o.icon;
                return (
                    <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={o.title}
                        onClick={() => onChange(o.id)}
                        data-testid={o.testId}
                        className={cn(
                            'imcrm-inline-flex imcrm-h-8 imcrm-min-w-0 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2 imcrm-text-xs imcrm-transition-colors',
                            on ? 'imcrm-bg-card imcrm-font-medium imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />}
                        <span className="imcrm-truncate">{o.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

const TOKEN_COLOR: Record<CodeToken['kind'], string> = {
    tag: '#7dd3fc',
    attr: '#c4b5fd',
    str: '#86efac',
    punct: '#94a3b8',
    text: '#e2e8f0',
};

/** El código completo, coloreado y legible (en los dos temas va sobre fondo oscuro). */
export function CodeBlock({ code, testId }: { code: string; testId: string }): JSX.Element {
    return (
        <pre
            className="imcrm-max-h-44 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded-lg imcrm-px-3 imcrm-py-2.5 imcrm-font-mono imcrm-text-[11.5px] imcrm-leading-relaxed"
            style={{ background: '#0f172a', color: '#e2e8f0' }}
            tabIndex={0}
            aria-label={__('Código para insertar')}
            data-testid={testId}
            data-code={code}
        >
            {highlightEmbedCode(code).map((t, i) => (
                <span key={i} style={{ color: TOKEN_COLOR[t.kind] }}>
                    {t.value}
                </span>
            ))}
        </pre>
    );
}

/** v0.1.381 — Un dibujo chico de cada forma de insertar (la página y dónde queda). */
function ModeThumb({ mode, on }: { mode: EmbedMode; on: boolean }): JSX.Element {
    const accent = on ? 'hsl(var(--imcrm-primary))' : 'hsl(var(--imcrm-muted-foreground) / 0.55)';
    const line = 'hsl(var(--imcrm-muted-foreground) / 0.22)';
    return (
        <span
            aria-hidden="true"
            className="imcrm-relative imcrm-block imcrm-h-12 imcrm-w-[72px] imcrm-shrink-0 imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background"
        >
            <span className="imcrm-absolute imcrm-left-0 imcrm-right-0 imcrm-top-0 imcrm-h-2" style={{ background: line }} />
            <span className="imcrm-absolute imcrm-left-2 imcrm-top-3.5 imcrm-h-1 imcrm-w-1/2 imcrm-rounded" style={{ background: line }} />
            <span className="imcrm-absolute imcrm-left-2 imcrm-h-1 imcrm-w-1/3 imcrm-rounded" style={{ background: line, top: 22 }} />
            {mode === 'inline' && <span className="imcrm-absolute imcrm-bottom-1.5 imcrm-left-2 imcrm-right-2 imcrm-h-4 imcrm-rounded-sm" style={{ border: `1.5px solid ${accent}`, background: on ? 'hsl(var(--imcrm-primary) / 0.12)' : 'transparent' }} />}
            {mode === 'popup' && (
                <>
                    <span className="imcrm-absolute imcrm-bottom-2 imcrm-left-2 imcrm-h-2 imcrm-w-6 imcrm-rounded-full" style={{ background: accent }} />
                    <span className="imcrm-absolute imcrm-right-2 imcrm-top-3 imcrm-h-6 imcrm-w-7 imcrm-rounded-sm imcrm-shadow-sm" style={{ border: `1.5px solid ${accent}`, background: 'hsl(var(--imcrm-card))' }} />
                </>
            )}
            {mode === 'float' && <span className="imcrm-absolute imcrm-bottom-1.5 imcrm-right-2 imcrm-h-2.5 imcrm-w-8 imcrm-rounded-full imcrm-shadow-sm" style={{ background: accent }} />}
        </span>
    );
}
