import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Globe, RefreshCw, Trash2 } from 'lucide-react';
import type { WidgetProblem } from '@imagina-base/shared';

import { CodeBlock } from '@/admin/forms/EmbedCodePicker';
import { DomainChips } from '@/admin/forms/DomainChips';
import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { WIDGET_SECTION_INFO, problemSection } from './widgetSections';
import { PanelBody, SubSection, Switch } from './widgetUi';

/**
 * v0.1.408 — «Instalar en tu sitio»: publicarlo (con lo que falta), el código
 * en tres pasos, los sitios donde puede aparecer y, al final, cambiar el
 * código o eliminarlo.
 */
export function WidgetInstallPanel({
    enabled,
    busy,
    problems,
    onTogglePublish,
    onFix,
    code,
    domains,
    onDomains,
    onRegenerate,
    regenerating,
    onDelete,
    deleting,
}: {
    enabled: boolean;
    busy: boolean;
    problems: WidgetProblem[];
    onTogglePublish: () => void;
    onFix: (p: WidgetProblem) => void;
    code: string;
    domains: string[];
    onDomains: (v: string[]) => void;
    onRegenerate: () => void;
    regenerating: boolean;
    onDelete: () => void;
    deleting: boolean;
}): JSX.Element {
    const [copied, setCopied] = useState(false);
    const blocked = !enabled && problems.length > 0;
    return (
        <PanelBody testId="widget-publish" tour="widget-publish">
            <SubSection title={__('Publicar')}>
                <div
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-p-3',
                        enabled ? 'imcrm-border-success/30 imcrm-bg-success/[0.07]' : 'imcrm-border-border imcrm-bg-card',
                    )}
                >
                    <span
                        className={cn('imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full', enabled ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground')}
                        aria-hidden
                    >
                        {enabled ? <CheckCircle2 className="imcrm-h-5 imcrm-w-5" /> : <Globe className="imcrm-h-5 imcrm-w-5" />}
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-text-[13.5px] imcrm-font-semibold">{enabled ? __('Publicado') : __('Sin publicar')}</p>
                        <p className="imcrm-text-[11.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {enabled ? __('Se ve en los sitios donde pegaste el código.') : blocked ? __('Arregla lo de abajo para poder publicarlo.') : __('Sin publicar, el código pegado no muestra nada.')}
                        </p>
                    </div>
                    <Switch checked={enabled} onChange={onTogglePublish} label={__('Publicado')} disabled={busy || blocked} testId="widget-enabled" />
                </div>
                {problems.length > 0 && (
                    <div className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-warning/30" data-testid="widget-problems">
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-[12.5px] imcrm-font-medium">
                            <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-text-warning" />
                            {problems.length === 1 ? __('Falta una cosa antes de publicar') : sprintf(__('Faltan %d cosas antes de publicar'), problems.length)}
                        </p>
                        <ul className="imcrm-divide-y imcrm-divide-border">
                            {problems.map((p, i) => (
                                <li key={i}>
                                    <button type="button" onClick={() => onFix(p)} className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[12.5px] hover:imcrm-bg-muted/50">
                                        <span className="imcrm-min-w-0 imcrm-flex-1">{p.message}</span>
                                        <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary">{__(WIDGET_SECTION_INFO[problemSection(p)].label)}</span>
                                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </SubSection>

            <SubSection
                title={__('El código para tu sitio')}
                action={
                    <Button
                        size="sm"
                        className="imcrm-h-8 imcrm-gap-1.5"
                        onClick={() => {
                            void navigator.clipboard?.writeText(code).then(() => {
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1600);
                            });
                        }}
                        data-testid="widget-copy-code"
                    >
                        {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {copied ? __('Copiado') : __('Copiar código')}
                    </Button>
                }
            >
                <CodeBlock code={code} testId="widget-code" />
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {[
                        __('Copia el código.'),
                        __('Pégalo una sola vez en el pie de tu sitio, antes de </body>. En WordPress, con un plugin para agregar código al pie o en el tema.'),
                        __('Publícalo: el botón aparece en todas las páginas que elegiste en «Dónde aparece».'),
                    ].map((t, i) => (
                        <li key={i} className="imcrm-flex imcrm-gap-2.5 imcrm-text-[12.5px] imcrm-leading-snug">
                            <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary">{i + 1}</span>
                            <span className="imcrm-pt-px">{t}</span>
                        </li>
                    ))}
                </ol>
            </SubSection>

            <SubSection title={__('Sitios donde puede aparecer')} hint={__('Escribe un sitio y pulsa Enter (ej.: tuempresa.com). Sin sitios, aparece en cualquiera donde pegues el código. Si un formulario sólo se puede insertar en ciertos sitios, agrega ahí también este.')}>
                <DomainChips value={domains} onChange={onDomains} testId="widget-domains" autoFocus={false} max={20} />
            </SubSection>

            <SubSection title={__('Más opciones')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-p-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <p className="imcrm-text-[13px] imcrm-font-medium">{__('Cambiar el código')}</p>
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('El código viejo deja de funcionar hasta que pegues el nuevo.')}</p>
                        </div>
                        <Button variant="outline" size="sm" disabled={regenerating} onClick={onRegenerate} className="imcrm-shrink-0 imcrm-gap-1.5" data-testid="widget-regenerate">
                            <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Cambiar')}
                        </Button>
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-p-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <p className="imcrm-text-[13px] imcrm-font-medium imcrm-text-destructive">{__('Eliminar el widget')}</p>
                            <p className="imcrm-text-[11.5px] imcrm-text-muted-foreground">{__('Desaparece de tu sitio. Los registros que llegaron por él se quedan en sus listas.')}</p>
                        </div>
                        <Button variant="outline" size="sm" disabled={deleting} onClick={onDelete} className="imcrm-shrink-0 imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive" data-testid="widget-delete">
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Eliminar')}
                        </Button>
                    </div>
                </div>
            </SubSection>
        </PanelBody>
    );
}
