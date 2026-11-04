import { useState } from 'react';
import { CheckIcon, Copy, MousePointerClick, PanelTop, SquareMousePointer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { buttonInk, defaultEmbedLabel, embedCode, embedPopupAttribute, safeHex, type EmbedMode, type EmbedTarget } from './embedCode';

const MODES: Array<{ id: EmbedMode; label: string; hint: string; icon: typeof PanelTop }> = [
    { id: 'inline', label: 'En la página', hint: 'Se ve dentro de tu página. Se carga cuando la persona baja hasta él.', icon: PanelTop },
    { id: 'popup', label: 'Ventana al hacer clic', hint: 'Un botón abre una ventana. No se carga nada hasta que alguien lo toca: lo más liviano para un sitio con muchas visitas.', icon: MousePointerClick },
    { id: 'float', label: 'Botón flotante', hint: 'Un botón fijo en una esquina de cada página donde pegues el código. También carga sólo al hacer clic.', icon: SquareMousePointer },
];

/**
 * v0.1.352 (ADR-S95) — Cómo insertar el formulario o la agenda en el sitio de
 * la empresa: en la página, en una ventana al hacer clic o con un botón
 * flotante. Las dos últimas no cargan nada hasta que alguien las usa.
 */
export function EmbedCodePicker({ target, accent, testId, dataTour }: { target: EmbedTarget; accent: string; testId: string; dataTour?: string }): JSX.Element {
    const [mode, setMode] = useState<EmbedMode>('inline');
    const [label, setLabel] = useState(defaultEmbedLabel(target.kind));
    const [color, setColor] = useState(safeHex(accent));
    const [position, setPosition] = useState<'right' | 'left'>('right');
    const [copied, setCopied] = useState<'code' | 'attr' | null>(null);
    const code = embedCode(target, mode, { label, color, position });
    const popupAttr = embedPopupAttribute(target);
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
                    {mode === 'float' && (
                        <div role="radiogroup" aria-label={__('Esquina')} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Esquina')}
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
