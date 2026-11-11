import { Building2, PanelBottom } from 'lucide-react';
import type { ContactWidgetConfig, ContactWidgetOptions } from '@imagina-base/shared';

import { NumberInput, Row } from '@/admin/records/layout/editor/inspectorUi';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';

import { ColorChoice, IconSelect } from './WidgetButtonEditor';
import { ChoiceCard, PanelBody, SubSection, SwitchRow, WidgetArt } from './widgetUi';

/**
 * v0.1.408 — «Apariencia» del widget: qué se abre al tocar el botón (con un
 * dibujo de cada opción), el botón redondo, de qué lado va y el celular.
 */
export function WidgetLookEditor({
    config,
    options,
    onChange,
}: {
    config: ContactWidgetConfig;
    options: ContactWidgetOptions;
    onChange: (patch: Partial<ContactWidgetConfig>) => void;
}): JSX.Element {
    const accent = config.color ?? options.brand_color ?? '#2563eb';
    return (
        <PanelBody testId="widget-look" tour="widget-look">
            <SubSection title={__('Al tocar el botón')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2.5" role="radiogroup" aria-label={__('Al tocar el botón')}>
                    <ChoiceCard
                        active={config.layout === 'card'}
                        onClick={() => onChange({ layout: 'card' })}
                        art={<WidgetArt variant="card" side={config.position} accent={accent} />}
                        title={__('Panel tipo chat')}
                        hint={__('Un saludo y los botones; un formulario o la agenda se abren ahí mismo.')}
                        testId="widget-layout-card"
                    />
                    <ChoiceCard
                        active={config.layout === 'menu'}
                        onClick={() => onChange({ layout: 'menu' })}
                        art={<WidgetArt variant="menu" side={config.position} accent={accent} />}
                        title={__('Botones apilados')}
                        hint={__('Los botones salen uno sobre otro, encima del botón redondo.')}
                        testId="widget-layout-menu"
                    />
                </div>
            </SubSection>

            {config.layout === 'card' && (
                <SubSection title={__('El panel')}>
                    <Row label={__('Saludo')}>
                        <Input value={config.title} maxLength={80} onChange={(e) => onChange({ title: e.target.value })} data-testid="widget-title" />
                    </Row>
                    <Row label={__('Debajo del saludo')}>
                        <Input value={config.subtitle} maxLength={200} onChange={(e) => onChange({ subtitle: e.target.value })} />
                    </Row>
                    <SwitchRow
                        icon={Building2}
                        label={__('Mostrar el logo de la empresa')}
                        hint={options.logo_url ? undefined : __('Todavía no hay logo: súbelo en Ajustes → Marca.')}
                        checked={config.show_logo}
                        onChange={(v) => onChange({ show_logo: v })}
                    />
                </SubSection>
            )}

            <SubSection title={__('El botón redondo')}>
                <Row label={__('Color')} hint={__('El del botón redondo y el encabezado del panel.')}>
                    <ColorChoice value={config.color} fallbackLabel={__('El de tu marca')} fallbackColor={options.brand_color} onChange={(c) => onChange({ color: c })} />
                </Row>
                <Row label={__('Ícono')}>
                    <IconSelect value={config.launcher_icon} onChange={(icon) => onChange({ launcher_icon: icon ?? 'chat' })} />
                </Row>
                <Row label={__('Texto al lado (opcional)')} hint={__('Por ejemplo, «¿Hablamos?». Vacío = sólo el ícono.')}>
                    <Input value={config.launcher_label} maxLength={40} placeholder={__('¿Hablamos?')} onChange={(e) => onChange({ launcher_label: e.target.value })} data-testid="widget-launcher-label" />
                </Row>
            </SubSection>

            <SubSection title={__('Posición')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2.5" role="radiogroup" aria-label={__('Lado de la pantalla')}>
                    {(['left', 'right'] as const).map((side) => (
                        <ChoiceCard
                            key={side}
                            active={config.position === side}
                            onClick={() => onChange({ position: side })}
                            art={<WidgetArt variant="launcher" side={side} accent={accent} />}
                            title={side === 'left' ? __('Abajo a la izquierda') : __('Abajo a la derecha')}
                            testId={`widget-position-${side}`}
                        />
                    ))}
                </div>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2.5">
                    <Row label={__('Separación del costado')}>
                        <PxInput value={config.offset_x} onChange={(v) => onChange({ offset_x: v })} ariaLabel={__('Separación del costado en píxeles')} />
                    </Row>
                    <Row label={__('Separación de abajo')}>
                        <PxInput value={config.offset_y} onChange={(v) => onChange({ offset_y: v })} ariaLabel={__('Separación de abajo en píxeles')} />
                    </Row>
                </div>
            </SubSection>

            <SubSection title={__('En el celular')}>
                <SwitchRow
                    icon={PanelBottom}
                    label={__('Una barra fija abajo')}
                    hint={__('En vez del botón redondo, los botones van en una barra a lo ancho de la pantalla (con más de tres, los demás en «Más»).')}
                    checked={config.mobile_bar}
                    onChange={(v) => onChange({ mobile_bar: v })}
                    testId="widget-mobile-bar"
                />
            </SubSection>
        </PanelBody>
    );
}

function PxInput({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel: string }): JSX.Element {
    return (
        <div className="imcrm-relative">
            <NumberInput value={value} min={0} max={200} onChange={(v) => onChange(Math.round(v ?? 0))} ariaLabel={ariaLabel} />
            <span className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2.5 imcrm-top-1/2 -imcrm-translate-y-1/2 imcrm-text-[11px] imcrm-text-muted-foreground">px</span>
        </div>
    );
}
