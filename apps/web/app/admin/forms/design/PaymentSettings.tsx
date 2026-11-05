import { useQuery } from '@tanstack/react-query';
import { Calculator, CreditCard, PenLine } from 'lucide-react';
import { Link } from 'react-router';

import { COLLECTION_PROVIDER_LABEL, type FormConfig, type FormPaymentSource } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { api } from '@/cloud/session';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';
import { updateSettings } from '../formDesignOps';
import { RecallPicker, withToken } from './LogicPanel';

const SOURCES: Array<{ value: FormPaymentSource; title: string; hint: string; icon: typeof CreditCard }> = [
    { value: 'fixed', title: 'Monto fijo', hint: 'Todos pagan lo mismo (una inscripción, una entrada).', icon: CreditCard },
    { value: 'calc', title: 'Según un cálculo', hint: 'El precio cambia con lo que eligen (el plan, la cantidad).', icon: Calculator },
    { value: 'field', title: 'Lo escribe la persona', hint: 'Un aporte, una donación o un abono, con mínimo y máximo.', icon: PenLine },
];

const selectClass =
    'imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring';

const toAmount = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * v0.1.361 — Cobrar al enviar: con la conexión de cobro del equipo (Mercado
 * Pago o Wompi), el monto (fijo, de un cálculo o el que escribe la persona) y
 * qué pasa después de enviar. El monto lo vuelve a calcular el servidor.
 */
export function PaymentSettings({ config, fields, onChange }: { config: FormConfig; fields: FieldEntity[]; onChange: (next: FormConfig) => void }): JSX.Element {
    const p = config.settings.payment;
    const set = (patch: Partial<FormConfig['settings']['payment']>): void => onChange(updateSettings(config, { payment: { ...p, ...patch } }));
    const conns = useQuery({ queryKey: ['collections-connections'], queryFn: () => api.collectionConnections(), retry: false, staleTime: 60_000 });
    const team = (conns.data ?? []).filter((c) => c.shared !== false);
    const conn = team.find((c) => c.id === p.connection_id) ?? null;
    const wompi = conn?.provider === 'wompi';
    const asked = new Set(config.items.flatMap((i) => (i.type === 'field' ? [i.field_id] : [])));
    const amountFields = fields.filter((f) => asked.has(f.id) && (f.type === 'number' || f.type === 'currency'));
    const calcs = config.settings.calcs;
    const missing =
        p.enabled &&
        (p.connection_id === null
            ? __('Elige con qué cuenta se cobra.')
            : p.source === 'fixed' && !(p.amount !== null && p.amount > 0)
              ? __('Escribe el monto a cobrar.')
              : p.source === 'calc' && (p.calc_key === null || !calcs.some((c) => c.key === p.calc_key))
                ? __('Elige el cálculo que da el monto.')
                : p.source === 'field' && (p.field_id === null || !amountFields.some((f) => f.id === p.field_id))
                  ? __('Elige la pregunta donde la persona escribe el monto.')
                  : null);

    return (
        <Section title={__('Cobrar al enviar')}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-payment" data-tour="form-payment">
                <Check label={__('Cobrar al enviar el formulario')} checked={p.enabled} onChange={(v) => set({ enabled: v })} testId="form-payment-enabled" />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Al enviar, la persona paga con la cuenta de Mercado Pago o Wompi de la empresa: el dinero llega a esa cuenta. La respuesta queda guardada y su pago aparece en la ficha del registro.')}
                </p>
                {p.enabled && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                        <Field label={__('Con qué cuenta se cobra')}>
                            {!conns.isLoading && team.length === 0 ? (
                                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-payment-no-connection">
                                    {__('No hay una conexión de cobro del equipo (Mercado Pago o Wompi).')}{' '}
                                    <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                        {__('Conéctala en Ajustes → Integraciones')}
                                    </Link>
                                </p>
                            ) : (
                                <select
                                    className={selectClass}
                                    value={p.connection_id ?? ''}
                                    onChange={(e) => {
                                        const id = e.target.value ? Number(e.target.value) : null;
                                        const next = team.find((c) => c.id === id);
                                        set({ connection_id: id, ...(next?.provider === 'wompi' ? { currency: 'COP' } : {}) });
                                    }}
                                    data-testid="form-payment-connection"
                                >
                                    <option value="">{__('Elige una conexión…')}</option>
                                    {team.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {`${c.name} · ${COLLECTION_PROVIDER_LABEL[c.provider]}${c.test_mode ? ` (${__('prueba')})` : ''}`}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </Field>

                        <Field label={__('Concepto del cobro')} hint={__('Lo que ve en el pago. Vacío = el título del formulario.')}>
                            <Input
                                value={p.title}
                                maxLength={200}
                                placeholder={__('Inscripción de {{nombre}}')}
                                onChange={(e) => set({ title: e.target.value })}
                                data-testid="form-payment-title"
                            />
                            <RecallPicker config={config} fields={fields} onPick={(t) => set({ title: withToken(p.title, t) })} />
                        </Field>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <span className="imcrm-text-xs imcrm-font-medium">{__('Cuánto se cobra')}</span>
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5 sm:imcrm-grid-cols-3" role="radiogroup" aria-label={__('Cuánto se cobra')}>
                                {SOURCES.map((src) => {
                                    const on = p.source === src.value;
                                    const Icon = src.icon;
                                    return (
                                        <button
                                            key={src.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={on}
                                            onClick={() => set({ source: src.value })}
                                            className={cn(
                                                'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-p-2 imcrm-text-left imcrm-transition-colors',
                                                on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent',
                                            )}
                                            data-testid={`form-payment-source-${src.value}`}
                                        >
                                            <Icon className={cn('imcrm-h-4 imcrm-w-4', on ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} />
                                            <span className="imcrm-text-xs imcrm-font-medium">{__(src.title)}</span>
                                            <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(src.hint)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {p.source === 'fixed' && (
                            <Field label={__('Monto')}>
                                <Input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={p.amount ?? ''}
                                    onChange={(e) => set({ amount: toAmount(e.target.value) })}
                                    data-testid="form-payment-amount"
                                />
                            </Field>
                        )}
                        {p.source === 'calc' &&
                            (calcs.length === 0 ? (
                                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-payment-no-calc">
                                    {__('Primero crea un cálculo en la pestaña «Lógica» → «Cálculos y puntaje»: por ejemplo, el precio de cada plan como sus puntos. El resultado es lo que se cobra.')}
                                </p>
                            ) : (
                                <Field label={__('El cálculo que da el monto')} hint={__('La persona ve el total antes de enviar.')}>
                                    <select className={selectClass} value={p.calc_key ?? ''} onChange={(e) => set({ calc_key: e.target.value || null })} data-testid="form-payment-calc">
                                        <option value="">{__('Elige un cálculo…')}</option>
                                        {calcs.map((c) => (
                                            <option key={c.id} value={c.key}>
                                                {c.name || c.key}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            ))}
                        {p.source === 'field' &&
                            (amountFields.length === 0 ? (
                                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-payment-no-field">
                                    {__('Agrega al formulario una pregunta de número o moneda (por ejemplo, «¿Cuánto quieres aportar?»).')}
                                </p>
                            ) : (
                                <>
                                    <Field label={__('La pregunta con el monto')}>
                                        <select
                                            className={selectClass}
                                            value={p.field_id ?? ''}
                                            onChange={(e) => set({ field_id: e.target.value ? Number(e.target.value) : null })}
                                            data-testid="form-payment-field"
                                        >
                                            <option value="">{__('Elige una pregunta…')}</option>
                                            {amountFields.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.label}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                        <Field label={__('Mínimo')}>
                                            <Input type="number" min={0} step="any" value={p.min ?? ''} onChange={(e) => set({ min: toAmount(e.target.value) })} data-testid="form-payment-min" />
                                        </Field>
                                        <Field label={__('Máximo')}>
                                            <Input type="number" min={0} step="any" value={p.max ?? ''} onChange={(e) => set({ max: toAmount(e.target.value) })} data-testid="form-payment-max" />
                                        </Field>
                                    </div>
                                </>
                            ))}

                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                            <Field label={__('Moneda')} hint={wompi ? __('Wompi cobra en pesos colombianos.') : undefined}>
                                <Input
                                    value={p.currency}
                                    maxLength={3}
                                    disabled={wompi}
                                    onChange={(e) => {
                                        const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
                                        if (v.length === 3) set({ currency: v });
                                    }}
                                    data-testid="form-payment-currency"
                                />
                            </Field>
                            <Field label={__('El link sirve (días)')}>
                                <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={p.expires_days}
                                    onChange={(e) => {
                                        const n = Math.round(Number(e.target.value));
                                        if (Number.isFinite(n)) set({ expires_days: Math.min(30, Math.max(1, n)) });
                                    }}
                                    data-testid="form-payment-days"
                                />
                            </Field>
                        </div>

                        <Field label={__('Después de enviar')}>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Después de enviar')}>
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input type="radio" checked={p.after === 'redirect'} onChange={() => set({ after: 'redirect' })} data-testid="form-payment-after-redirect" />
                                    <span>{__('Llevar directo a pagar')}</span>
                                </label>
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input type="radio" checked={p.after === 'button'} onChange={() => set({ after: 'button' })} data-testid="form-payment-after-button" />
                                    <span>{__('Mostrar el botón para pagar en la pantalla de gracias')}</span>
                                </label>
                            </div>
                        </Field>
                        <Field label={__('Texto del botón')}>
                            <Input value={p.button_label} maxLength={60} placeholder={__('Ir a pagar')} onChange={(e) => set({ button_label: e.target.value })} data-testid="form-payment-button" />
                        </Field>

                        {missing && (
                            <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-payment-missing">
                                {missing} {__('Mientras tanto, el formulario recibe respuestas sin cobrar.')}
                            </p>
                        )}
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Si el total da cero, no se cobra. Para ver quién pagó en la lista, en la ficha de un registro → «Cobros» → «Elegir columnas». Para avisar cuando llega el pago, usa una automatización «Cuando se recibe un pago».')}
                        </p>
                    </div>
                )}
            </div>
        </Section>
    );
}
