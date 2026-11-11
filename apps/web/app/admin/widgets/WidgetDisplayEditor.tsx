import { MessageCircle, Monitor, Plus, Smartphone, Trash2 } from 'lucide-react';
import {
    WIDGET_GREETING_MAX,
    WIDGET_MAX_DELAY_S,
    WIDGET_MAX_GREETING_RULES,
    WIDGET_MAX_SCROLL_PCT,
    type ContactWidgetConfig,
    type WidgetDevice,
    type WidgetDisplay,
    type WidgetGreeting,
    type WidgetPageMode,
} from '@imagina-base/shared';

import { NumberInput, Row, Segmented } from '@/admin/records/layout/editor/inspectorUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';

import { PanelBody, SubSection, SwitchRow } from './widgetUi';

/**
 * v0.1.396 (ADR-S99) — Dónde aparece el widget (páginas, dispositivo, cuándo).
 * v0.1.408 — el saludo pasó a su propio panel (`WidgetGreetingEditor`).
 */
export function WidgetDisplayEditor({ config, onDisplay }: { config: ContactWidgetConfig; onDisplay: (d: WidgetDisplay) => void }): JSX.Element {
    const d = config.display;
    const setD = (patch: Partial<WidgetDisplay>): void => onDisplay({ ...d, ...patch });
    return (
        <PanelBody testId="widget-display" tour="widget-display">
            <SubSection title={__('En qué páginas')}>
                <Segmented<WidgetPageMode>
                    value={d.pages}
                    onChange={(pages) => setD({ pages })}
                    ariaLabel={__('Páginas')}
                    options={[
                        { value: 'all', label: __('Todas') },
                        { value: 'only', label: __('Sólo estas') },
                        { value: 'except', label: __('Todas menos') },
                    ]}
                />
                {d.pages !== 'all' && (
                    <Row
                        label={d.pages === 'only' ? __('La dirección contiene') : __('No aparece si la dirección contiene')}
                        hint={__('Palabras separadas por coma, sin importar mayúsculas ni tildes. Por ejemplo: planes, cotizacion, /contacto')}
                    >
                        <Input value={d.page_terms} onChange={(e) => setD({ page_terms: e.target.value })} placeholder="planes, cotizacion" data-testid="widget-display-terms" />
                        {!d.page_terms.trim() && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-warning">{__('Sin palabras, aparece en todas las páginas.')}</p>}
                    </Row>
                )}
            </SubSection>
            <SubSection title={__('En qué dispositivos')}>
                <Segmented<WidgetDevice>
                    value={d.devices}
                    onChange={(devices) => setD({ devices })}
                    ariaLabel={__('Dispositivos')}
                    options={[
                        { value: 'all', label: __('Todos') },
                        { value: 'desktop', label: __('Computador'), icon: <Monitor /> },
                        { value: 'mobile', label: __('Celular'), icon: <Smartphone /> },
                    ]}
                />
            </SubSection>
            <SubSection title={__('Cuándo aparece')} hint={__('Para no interrumpir apenas entra la persona.')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2.5">
                    <Row label={__('A los (segundos)')} hint={__('0 = enseguida.')}>
                        <NumberInput value={d.delay_s} min={0} max={WIDGET_MAX_DELAY_S} onChange={(v) => setD({ delay_s: v ?? 0 })} ariaLabel={__('Segundos antes de aparecer')} />
                    </Row>
                    <Row label={__('Al bajar (%)')} hint={__('0 = no hace falta bajar.')}>
                        <NumberInput value={d.scroll_pct} min={0} max={WIDGET_MAX_SCROLL_PCT} onChange={(v) => setD({ scroll_pct: v ?? 0 })} ariaLabel={__('Porcentaje de la página')} />
                    </Row>
                </div>
            </SubSection>
        </PanelBody>
    );
}

/** v0.1.396 — El saludo que se adelanta junto al botón, con un texto distinto por página. */
export function WidgetGreetingEditor({ config, onGreeting }: { config: ContactWidgetConfig; onGreeting: (g: WidgetGreeting) => void }): JSX.Element {
    const g = config.greeting;
    const setG = (patch: Partial<WidgetGreeting>): void => onGreeting({ ...g, ...patch });
    return (
        <PanelBody testId="widget-greeting-editor" tour="widget-greeting">
            <SubSection title={__('Saludar')}>
                <SwitchRow
                    boxed
                    icon={MessageCircle}
                    label={__('Saludar antes de que abran el widget')}
                    hint={__('Un mensaje junto al botón, como «¿Te ayudamos con tu cotización?». Tocarlo abre el widget; si lo cierran, no vuelve en esa visita.')}
                    checked={g.enabled}
                    onChange={(enabled) => setG({ enabled })}
                    testId="widget-greeting-enabled"
                />
            </SubSection>
            {g.enabled && (
                <>
                    <SubSection title={__('El saludo')} hint={__('Se ve en todas las páginas que no tienen el suyo. Vacío = sólo saluda en las páginas de abajo.')}>
                        <Textarea
                            rows={2}
                            maxLength={WIDGET_GREETING_MAX}
                            value={g.text}
                            onChange={(e) => setG({ text: e.target.value })}
                            placeholder={__('¡Hola! ¿Te ayudamos a elegir?')}
                            data-testid="widget-greeting-text"
                        />
                    </SubSection>
                    <SubSection title={__('Un saludo distinto por página')} hint={__('Gana la primera regla cuya palabra está en la dirección de la página.')}>
                        {g.rules.length > 0 && (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                {g.rules.map((r, i) => (
                                    <li key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-testid="widget-greeting-rule">
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                            <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground">{__('Si la dirección contiene')}</span>
                                            <Input
                                                value={r.contains}
                                                onChange={(e) => setG({ rules: g.rules.map((x, j) => (j === i ? { ...x, contains: e.target.value } : x)) })}
                                                placeholder="planes"
                                                aria-label={__('Si la dirección contiene')}
                                                className="imcrm-h-8"
                                            />
                                            <Button variant="ghost" size="icon" className="imcrm-h-8 imcrm-w-8 imcrm-shrink-0" onClick={() => setG({ rules: g.rules.filter((_, j) => j !== i) })} aria-label={__('Quitar')}>
                                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                            </Button>
                                        </div>
                                        <Input
                                            value={r.text}
                                            maxLength={WIDGET_GREETING_MAX}
                                            onChange={(e) => setG({ rules: g.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                                            placeholder={__('¿Dudas con los planes? Escríbenos.')}
                                            aria-label={__('El saludo de esa página')}
                                            className="imcrm-h-8"
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                        {g.rules.length < WIDGET_MAX_GREETING_RULES && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="imcrm-self-start"
                                onClick={() => setG({ rules: [...g.rules, { contains: '', text: '' }] })}
                                data-testid="widget-greeting-add-rule"
                            >
                                <Plus className="imcrm-h-4 imcrm-w-4" />
                                {__('Agregar un saludo para una página')}
                            </Button>
                        )}
                    </SubSection>
                    <SubSection title={__('Cuándo saluda')}>
                        <Row label={__('A los (segundos)')}>
                            <NumberInput value={g.delay_s} min={0} max={WIDGET_MAX_DELAY_S} onChange={(v) => setG({ delay_s: v ?? 0 })} ariaLabel={__('Segundos antes de saludar')} />
                        </Row>
                        <SwitchRow icon={Smartphone} label={__('También en el celular')} hint={__('En pantallas chicas tapa un poco más.')} checked={g.mobile} onChange={(mobile) => setG({ mobile })} />
                    </SubSection>
                </>
            )}
        </PanelBody>
    );
}
