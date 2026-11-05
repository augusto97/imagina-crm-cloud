import { useState } from 'react';
import { AppWindow, CheckIcon, Copy, Maximize2, MousePointerClick, PanelRight, PanelTop, SquareMousePointer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { buttonInk, defaultEmbedLabel, embedCode, embedPopupAttribute, safeHex, type EmbedMode, type EmbedOpen, type EmbedTarget } from './embedCode';

const MODES: Array<{ id: EmbedMode; label: string; hint: string; icon: typeof PanelTop }> = [
    { id: 'inline', label: 'En la página', hint: 'Se ve dentro de tu página. Se carga cuando la persona baja hasta él.', icon: PanelTop },
    { id: 'popup', label: 'Ventana al hacer clic', hint: 'Un botón abre una ventana. No se carga nada hasta que alguien lo toca: lo más liviano para un sitio con muchas visitas.', icon: MousePointerClick },
    { id: 'float', label: 'Botón flotante', hint: 'Un botón fijo en una esquina de cada página donde pegues el código. También carga sólo al hacer clic.', icon: SquareMousePointer },
];

/** v0.1.359 — cómo se abre la ventana del botón o del botón flotante. */
const OPENS: Array<{ id: EmbedOpen; label: string; hint: string; icon: typeof PanelTop }> = [
    { id: 'window', label: 'Ventana', hint: 'Una ventana al centro de la pantalla.', icon: AppWindow },
    { id: 'side', label: 'Panel lateral', hint: 'Entra deslizándose desde un costado; tu página se sigue viendo detrás.', icon: PanelRight },
    { id: 'full', label: 'Pantalla completa', hint: 'Ocupa toda la pantalla, sin distracciones. Ideal para formularios largos.', icon: Maximize2 },
];

/**
 * v0.1.352 (ADR-S95) — Cómo insertar el formulario o la agenda en el sitio de
 * la empresa: en la página, en una ventana al hacer clic o con un botón
 * flotante. Las dos últimas no cargan nada hasta que alguien las usa.
 */
export function EmbedCodePicker({
    target,
    accent,
    testId,
    dataTour,
    bare,
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
}): JSX.Element {
    const [mode, setMode] = useState<EmbedMode>('inline');
    const [label, setLabel] = useState(defaultEmbedLabel(target.kind));
    const [color, setColor] = useState(safeHex(accent));
    const [position, setPosition] = useState<'right' | 'left'>('right');
    const [open, setOpen] = useState<EmbedOpen>('window');
    const [copied, setCopied] = useState<'code' | 'attr' | null>(null);
    const code = embedCode(target, mode, { label, color, position, open });
    const popupAttr = embedPopupAttribute(target, open, position);
    // La esquina del flotante y, en el botón, el lado del panel lateral.
    const showSide = mode === 'float' || open === 'side';
    const copy = (text: string, which: 'code' | 'attr'): void => {
        void navigator.clipboard.writeText(text).then(() => {
            setCopied(which);
            window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
        });
    };
    const current = MODES.find((m) => m.id === mode)!;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour={dataTour}>
            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Insertar en tu sitio')}</span>
            <div role="radiogroup" aria-label={__('Cómo insertarlo')} className="imcrm-grid imcrm-gap-1.5 sm:imcrm-grid-cols-3">
                {MODES.map((m) => {
                    const Icon = m.icon;
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
                                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-transition-colors',
                                on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-foreground' : 'imcrm-border-border imcrm-bg-background hover:imcrm-bg-muted',
                            )}
                        >
                            <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', on ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} />
                            <span className="imcrm-font-medium">{__(m.label)}</span>
                        </button>
                    );
                })}
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__(current.hint)}</p>
            {mode === 'inline' && bare && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid={`${testId}-style`}>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cómo se ve en tu página')}</span>
                    <div role="radiogroup" aria-label={__('Cómo se ve en tu página')} className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                        {([
                            { id: false, label: __('Con su tarjeta') },
                            { id: true, label: __('Sin marco') },
                        ] as const).map((o) => (
                            <Button
                                key={String(o.id)}
                                type="button"
                                size="sm"
                                variant={bare.value === o.id ? 'default' : 'outline'}
                                className="imcrm-h-8 imcrm-text-xs"
                                role="radio"
                                aria-checked={bare.value === o.id}
                                onClick={() => bare.onChange(o.id)}
                                data-testid={`${testId}-style-${o.id ? 'bare' : 'card'}`}
                            >
                                {o.label}
                            </Button>
                        ))}
                    </div>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {bare.value
                            ? __('Sin fondo, sin borde y sin espacio alrededor: ocupa exactamente el lugar que le das, como el formulario que ya tenías.')
                            : __('Se ve con su fondo y su tarjeta, igual que en el enlace directo.')}
                        {bare.unsaved && ' '}
                        {bare.unsaved && <strong className="imcrm-font-medium imcrm-text-foreground">{__('Guarda los cambios para que tu sitio lo muestre así.')}</strong>}
                    </p>
                </div>
            )}
            {mode !== 'inline' && bare?.value && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid={`${testId}-style-note`}>
                    {__('«Sin marco» sólo aplica cuando va dentro de tu página: en una ventana o un panel se ve con su tarjeta.')}
                </p>
            )}
            {mode !== 'inline' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid={`${testId}-open`}>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cómo se abre')}</span>
                    <div role="radiogroup" aria-label={__('Cómo se abre')} className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                        {OPENS.map((o) => {
                            const Icon = o.icon;
                            const on = o.id === open;
                            return (
                                <Button
                                    key={o.id}
                                    type="button"
                                    size="sm"
                                    variant={on ? 'default' : 'outline'}
                                    className="imcrm-h-8 imcrm-gap-1.5 imcrm-text-xs"
                                    role="radio"
                                    aria-checked={on}
                                    title={__(o.hint)}
                                    onClick={() => setOpen(o.id)}
                                    data-testid={`${testId}-open-${o.id}`}
                                >
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__(o.label)}
                                </Button>
                            );
                        })}
                    </div>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__(OPENS.find((o) => o.id === open)!.hint)}</p>
                </div>
            )}
            {mode !== 'inline' && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-gap-2">
                    <label className="imcrm-flex imcrm-min-w-[160px] imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Texto del botón')}
                        <Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="imcrm-h-8 imcrm-text-xs" data-testid={`${testId}-label`} />
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Color')}
                        <input
                            type="color"
                            value={safeHex(color)}
                            onChange={(e) => setColor(e.target.value)}
                            className="imcrm-h-8 imcrm-w-12 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-0.5"
                            aria-label={__('Color del botón')}
                        />
                    </label>
                    {showSide && (
                        <div
                            role="radiogroup"
                            aria-label={mode === 'float' ? __('Esquina') : __('Lado')}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground"
                        >
                            {mode === 'float' ? __('Esquina') : __('Lado')}
                            <div className="imcrm-flex imcrm-gap-1">
                                {(['left', 'right'] as const).map((p) => (
                                    <Button key={p} type="button" size="sm" variant={position === p ? 'default' : 'outline'} className="imcrm-h-8 imcrm-text-xs" role="radio" aria-checked={position === p} onClick={() => setPosition(p)}>
                                        {p === 'left' ? __('Izquierda') : __('Derecha')}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                    <span
                        aria-hidden="true"
                        className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-full imcrm-px-4 imcrm-text-xs imcrm-font-semibold imcrm-shadow-sm"
                        style={{ background: safeHex(color), color: buttonInk(safeHex(color)) }}
                        data-testid={`${testId}-preview`}
                    >
                        {label.trim() || defaultEmbedLabel(target.kind)}
                    </span>
                </div>
            )}
            <div className="imcrm-flex imcrm-items-start imcrm-gap-1.5">
                <Textarea
                    readOnly
                    value={code}
                    rows={mode === 'float' ? 2 : 3}
                    className="imcrm-min-h-0 imcrm-resize-none imcrm-font-mono imcrm-text-[11px]"
                    onFocus={(e) => e.currentTarget.select()}
                    data-testid={testId}
                />
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-shrink-0 imcrm-gap-1"
                    onClick={() => copy(code, 'code')}
                    data-testid={`${testId}-copy`}
                >
                    {copied === 'code' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {copied === 'code' ? __('Copiado') : __('Copiar')}
                </Button>
            </div>
            {mode === 'popup' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('¿Prefieres un botón o enlace de tu sitio? Pégale este atributo y pega el script una sola vez en la página:')}
                    </p>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <code
                            className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-font-mono imcrm-text-[11px]"
                            title={popupAttr}
                            data-testid={`${testId}-attr`}
                        >
                            {popupAttr}
                        </code>
                        <Button variant="ghost" size="sm" className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-px-2 imcrm-text-xs" onClick={() => copy(popupAttr, 'attr')}>
                            {copied === 'attr' ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {copied === 'attr' ? __('Copiado') : __('Copiar')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
