import { Eye, MessageCircle, Plus, Trash2 } from 'lucide-react';
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

import { NumberInput, Row, Segmented, Toggle } from '@/admin/records/layout/editor/inspectorUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';

/**
 * v0.1.396 (ADR-S99) — Dónde aparece el widget (páginas, dispositivo, cuándo)
 * y el saludo que se adelanta junto al botón, con un texto distinto por página.
 */
export function WidgetDisplayEditor({
    config,
    onDisplay,
    onGreeting,
}: {
    config: ContactWidgetConfig;
    onDisplay: (d: WidgetDisplay) => void;
    onGreeting: (g: WidgetGreeting) => void;
}): JSX.Element {
    const d = config.display;
    const g = config.greeting;
    const setD = (patch: Partial<WidgetDisplay>): void => onDisplay({ ...d, ...patch });
    const setG = (patch: Partial<WidgetGreeting>): void => onGreeting({ ...g, ...patch });

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="widget-display" data-testid="widget-display">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <Eye className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <div>
                        <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Dónde aparece')}</h3>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Pega el código una sola vez en todo tu sitio y elige aquí en qué páginas se ve.')}</p>
                    </div>
                </div>
                <Row label={__('Páginas')}>
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
                </Row>
                {d.pages !== 'all' && (
                    <Row
                        label={d.pages === 'only' ? __('La dirección contiene') : __('No aparece si la dirección contiene')}
                        hint={__('Palabras separadas por coma, sin importar mayúsculas ni tildes. Por ejemplo: planes, cotizacion, /contacto')}
                    >
                        <Input value={d.page_terms} onChange={(e) => setD({ page_terms: e.target.value })} placeholder="planes, cotizacion" data-testid="widget-display-terms" />
                        {!d.page_terms.trim() && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-warning">{__('Sin palabras, aparece en todas las páginas.')}</p>}
                    </Row>
                )}
                <Row label={__('Dispositivos')}>
                    <Segmented<WidgetDevice>
                        value={d.devices}
                        onChange={(devices) => setD({ devices })}
                        ariaLabel={__('Dispositivos')}
                        options={[
                            { value: 'all', label: __('Todos') },
                            { value: 'desktop', label: __('Sólo computador') },
                            { value: 'mobile', label: __('Sólo celular') },
                        ]}
                    />
                </Row>
                <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2">
                    <Row label={__('Aparece a los (segundos)')} hint={__('0 = enseguida.')}>
                        <NumberInput value={d.delay_s} min={0} max={WIDGET_MAX_DELAY_S} onChange={(v) => setD({ delay_s: v ?? 0 })} ariaLabel={__('Segundos antes de aparecer')} />
                    </Row>
                    <Row label={__('Aparece al bajar (%)')} hint={__('Cuánto tiene que bajar la persona por la página. 0 = no hace falta.')}>
                        <NumberInput value={d.scroll_pct} min={0} max={WIDGET_MAX_SCROLL_PCT} onChange={(v) => setD({ scroll_pct: v ?? 0 })} ariaLabel={__('Porcentaje de la página')} />
                    </Row>
                </div>
            </section>

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-border-t imcrm-border-border imcrm-pt-5" data-tour="widget-greeting" data-testid="widget-greeting-editor">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <MessageCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <Toggle
                        label={__('Saludar antes de que abran el widget')}
                        hint={__('Un mensaje junto al botón, como «¿Te ayudamos con tu cotización?». Tocarlo abre el widget; si lo cierran, no vuelve en esa visita.')}
                        checked={g.enabled}
                        onChange={(enabled) => setG({ enabled })}
                        testId="widget-greeting-enabled"
                    />
                </div>
                {g.enabled && (
                    <>
                        <Row label={__('El saludo')} hint={__('Se ve en todas las páginas que no tienen el suyo. Vacío = sólo saluda en las páginas de abajo.')}>
                            <Textarea
                                rows={2}
                                maxLength={WIDGET_GREETING_MAX}
                                value={g.text}
                                onChange={(e) => setG({ text: e.target.value })}
                                placeholder={__('¡Hola! ¿Te ayudamos a elegir?')}
                                data-testid="widget-greeting-text"
                            />
                        </Row>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <p className="imcrm-text-xs imcrm-font-medium">{__('Un saludo distinto por página')}</p>
                            {g.rules.map((r, i) => (
                                <div key={i} className="imcrm-grid imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-2.5 sm:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto]" data-testid="widget-greeting-rule">
                                    <Input
                                        value={r.contains}
                                        onChange={(e) => setG({ rules: g.rules.map((x, j) => (j === i ? { ...x, contains: e.target.value } : x)) })}
                                        placeholder={__('Si la dirección contiene… (planes)')}
                                        aria-label={__('Si la dirección contiene')}
                                    />
                                    <Input
                                        value={r.text}
                                        maxLength={WIDGET_GREETING_MAX}
                                        onChange={(e) => setG({ rules: g.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                                        placeholder={__('¿Dudas con los planes? Escríbenos.')}
                                        aria-label={__('El saludo de esa página')}
                                    />
                                    <Button variant="ghost" size="icon" onClick={() => setG({ rules: g.rules.filter((_, j) => j !== i) })} aria-label={__('Quitar')}>
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                    </Button>
                                </div>
                            ))}
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
                        </div>
                        <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2">
                            <Row label={__('Saluda a los (segundos)')}>
                                <NumberInput value={g.delay_s} min={0} max={WIDGET_MAX_DELAY_S} onChange={(v) => setG({ delay_s: v ?? 0 })} ariaLabel={__('Segundos antes de saludar')} />
                            </Row>
                            <div className="imcrm-pt-5">
                                <Toggle label={__('También en el celular')} hint={__('En pantallas chicas tapa un poco más.')} checked={g.mobile} onChange={(mobile) => setG({ mobile })} />
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
