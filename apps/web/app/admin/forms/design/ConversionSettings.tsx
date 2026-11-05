import { useState } from 'react';
import { BarChart3, Check as CheckIcon, Copy, ExternalLink, Link2 } from 'lucide-react';

import {
    ATTRIBUTION_DEFAULT_KEYS,
    ATTRIBUTION_FIELD_TYPES,
    ATTRIBUTION_KEYS,
    ATTRIBUTION_LABELS,
    ATTRIBUTION_URL_KEYS,
    attributionFieldFor,
    attributionFieldKey,
    COLLECTION_CURRENCY_OPTIONS,
    CONVERSION_EVENT_BOOKING,
    CONVERSION_EVENT_FORM,
    parseGoogleAdsSendTo,
    REDIRECT_MAX_DELAY_S,
    REDIRECT_URL_RE,
    redirectVariables,
    type AttributionKey,
    type AttributionSettings,
    type ConversionSettings,
    type ConversionValueMode,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateField } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import { useToast } from '@/components/ui/toast';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';

const selectClass =
    'imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring';

/** Monedas que se pueden informar (las de los cobros, sin repetir). */
const CURRENCIES: ReadonlyArray<{ value: string; label: string }> = (() => {
    const seen = new Set<string>();
    const out: Array<{ value: string; label: string }> = [];
    for (const list of Object.values(COLLECTION_CURRENCY_OPTIONS)) {
        for (const c of list) {
            if (seen.has(c.value)) continue;
            seen.add(c.value);
            out.push(c);
        }
    }
    return out;
})();

/** Lo que no se ve de entrada (las campañas casi nunca lo usan). */
const EXTRA_KEYS = ATTRIBUTION_KEYS.filter((k) => !ATTRIBUTION_DEFAULT_KEYS.includes(k));

/** El nombre de la columna que se crea para un dato. */
function columnLabel(k: AttributionKey): string {
    return ATTRIBUTION_LABELS[k].replace(/\s*\([^)]*\)\s*$/, '');
}

/**
 * v0.1.374 (ADR-S97) — «Medir conversiones»: lo que el formulario (o la
 * agenda) le avisa al sitio donde está insertado y dónde se guarda de dónde
 * vino cada registro. El evento para Tag Manager sale siempre; aquí se suma
 * la etiqueta de Google Ads, el píxel de Meta, el valor y el origen.
 */
export function ConversionSettings({
    kind,
    conversion,
    attribution,
    onChange,
    fields,
    takenFieldIds,
    listId,
    calcs = [],
    canCharge = false,
}: {
    kind: 'form' | 'booking';
    conversion: ConversionSettings;
    attribution: AttributionSettings;
    onChange: (patch: { conversion?: ConversionSettings; attribution?: AttributionSettings }) => void;
    fields: FieldEntity[];
    /** Campos que el formulario ya pregunta (o la agenda ya escribe): no sirven para el origen. */
    takenFieldIds: ReadonlySet<number>;
    listId: number | string;
    calcs?: ReadonlyArray<{ key: string; name: string }>;
    /** El formulario cobra al enviar (el valor puede ser lo que se cobra). */
    canCharge?: boolean;
}): JSX.Element {
    const setConv = (patch: Partial<ConversionSettings>): void => onChange({ conversion: { ...conversion, ...patch } });
    const setAttr = (patch: Partial<AttributionSettings>): void => onChange({ attribution: { ...attribution, ...patch } });
    const isBooking = kind === 'booking';
    const eventName = isBooking ? CONVERSION_EVENT_BOOKING : CONVERSION_EVENT_FORM;
    const [adsRaw, setAdsRaw] = useState(conversion.google_ads ?? '');
    const [copied, setCopied] = useState(false);
    const [showExtra, setShowExtra] = useState(() => EXTRA_KEYS.some((k) => attributionFieldFor(attribution, k) !== null));
    const [creating, setCreating] = useState(false);
    const create = useCreateField(listId);
    const toast = useToast();

    const adsParsed = adsRaw.trim() === '' ? null : parseGoogleAdsSendTo(adsRaw);
    const adsBad = adsRaw.trim() !== '' && adsParsed === null;
    const usable = fields.filter((f) => ATTRIBUTION_FIELD_TYPES.has(f.type) && !takenFieldIds.has(f.id));
    const used = new Set(ATTRIBUTION_KEYS.flatMap((k) => {
        const id = attributionFieldFor(attribution, k);
        return id !== null ? [id] : [];
    }));
    const missingDefaults = ATTRIBUTION_DEFAULT_KEYS.filter((k) => attributionFieldFor(attribution, k) === null);

    const valueModes: Array<{ value: ConversionValueMode; label: string }> = [
        { value: 'none', label: __('Sin valor') },
        { value: 'fixed', label: __('Un valor fijo') },
        ...(kind === 'form' && canCharge ? [{ value: 'payment' as const, label: __('Lo que se cobra al enviar') }] : []),
        ...(kind === 'form' && calcs.length > 0 ? [{ value: 'calc' as const, label: __('El resultado de un cálculo') }] : []),
        ...(kind === 'booking' ? [{ value: 'price' as const, label: __('El precio del servicio') }] : []),
    ];

    const copyEvent = (): void => {
        void navigator.clipboard?.writeText(eventName).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };

    /** Crea las columnas que faltan (texto; enlace para las direcciones) y las elige. */
    const createColumns = async (): Promise<void> => {
        setCreating(true);
        const next: Record<string, unknown> = { ...attribution, enabled: true };
        try {
            for (const k of missingDefaults) {
                const f = await create.mutateAsync({ label: columnLabel(k), type: ATTRIBUTION_URL_KEYS.has(k) ? 'url' : 'text', is_required: false, config: {} } as never);
                next[attributionFieldKey(k)] = f.id;
            }
            onChange({ attribution: next as AttributionSettings });
            toast.success(__('Columnas listas'), __('Guarda para que empiecen a llenarse con cada respuesta nueva.'));
        } catch (err) {
            onChange({ attribution: next as AttributionSettings });
            toast.error(__('No se pudieron crear todas las columnas'), err instanceof Error ? err.message : undefined);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Section title={__('Medir conversiones')}>
            <div data-tour={isBooking ? 'booking-conversions' : 'form-conversions'} className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="conversion-settings">
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    <BarChart3 className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                    <span>
                        {kind === 'booking'
                            ? __('Insertada en tu sitio, cada cita le avisa al sitio con el evento')
                            : __('Insertado en tu sitio, cada envío le avisa al sitio con el evento')}{' '}
                        <button
                            type="button"
                            onClick={copyEvent}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-font-mono imcrm-text-foreground"
                            title={__('Copiar el nombre del evento')}
                            data-testid="conversion-event-name"
                        >
                            {eventName}
                            {copied ? <CheckIcon className="imcrm-h-3 imcrm-w-3" /> : <Copy className="imcrm-h-3 imcrm-w-3" />}
                        </button>{' '}
                        {__('para Google Tag Manager, sin configurar nada. Aquí puedes sumar tu etiqueta de Google Ads, el píxel de Meta y guardar de dónde vino cada registro.')}{' '}
                        <a href="/#/aprende/formularios/formularios-medir-conversiones" target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-0.5 imcrm-text-primary hover:imcrm-underline">
                            {__('Cómo se usa')}
                            <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        </a>
                    </span>
                </p>

                <Field
                    label={__('Etiqueta de conversión de Google Ads')}
                    hint={
                        adsBad
                            ? __('No reconocemos ese código. Pega el fragmento del evento que te da Google Ads o el «AW-123456789/AbC…».')
                            : adsParsed
                              ? __('Se dispara con la etiqueta de Google que ya tiene tu sitio. Si usas Tag Manager, mejor arma la etiqueta allá con el evento de arriba (con las dos, la misma conversión no se cuenta dos veces).')
                              : __('Opcional. En Google Ads: Objetivos → Conversiones → tu acción → Configurar la etiqueta. Pega el fragmento del evento (el que tiene «send_to»).')
                    }
                >
                    <Input
                        value={adsRaw}
                        placeholder="AW-123456789/AbCdEfGhIj"
                        onChange={(e) => {
                            const raw = e.target.value;
                            setAdsRaw(raw);
                            const parsed = raw.trim() === '' ? null : parseGoogleAdsSendTo(raw);
                            if (raw.trim() === '' || parsed) setConv({ google_ads: parsed });
                        }}
                        onBlur={() => {
                            if (adsParsed) setAdsRaw(adsParsed);
                        }}
                        aria-invalid={adsBad}
                        data-testid="conversion-google-ads"
                    />
                    {adsParsed && (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-success" data-testid="conversion-google-ads-ok">
                            <CheckIcon className="imcrm-h-3 imcrm-w-3" />
                            {adsParsed}
                        </p>
                    )}
                </Field>

                <Check
                    label={kind === 'booking' ? __('Registrar «Schedule» en el píxel de Meta del sitio') : __('Registrar «Lead» en el píxel de Meta del sitio')}
                    checked={conversion.meta_event}
                    onChange={(v) => setConv({ meta_event: v })}
                    testId="conversion-meta"
                />

                <Field label={__('Valor de la conversión')} hint={__('Google y Meta lo usan para medir cuánto vale cada campaña.')}>
                    <select
                        className={selectClass}
                        value={valueModes.some((m) => m.value === conversion.value) ? conversion.value : 'none'}
                        onChange={(e) => setConv({ value: e.target.value as ConversionValueMode })}
                        data-testid="conversion-value"
                    >
                        {valueModes.map((m) => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </Field>
                {conversion.value === 'fixed' && (
                    <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                        <Input
                            type="number"
                            min={0}
                            step="any"
                            value={conversion.amount ?? ''}
                            placeholder="50000"
                            onChange={(e) => setConv({ amount: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                            data-testid="conversion-amount"
                        />
                        <select className={selectClass} value={conversion.currency} onChange={(e) => setConv({ currency: e.target.value })} data-testid="conversion-currency">
                            {CURRENCIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                    {c.value}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {conversion.value === 'calc' && (
                    <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                        <select className={selectClass} value={conversion.calc_key ?? ''} onChange={(e) => setConv({ calc_key: e.target.value || null })} data-testid="conversion-calc">
                            <option value="">{__('Elige un cálculo')}</option>
                            {calcs.map((c) => (
                                <option key={c.key} value={c.key}>
                                    {c.name || c.key}
                                </option>
                            ))}
                        </select>
                        <select className={selectClass} value={conversion.currency} onChange={(e) => setConv({ currency: e.target.value })}>
                            {CURRENCIES.map((c) => (
                                <option key={c.value} value={c.value}>
                                    {c.value}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
                {conversion.value === 'price' && (
                    <select className={selectClass} value={conversion.currency} onChange={(e) => setConv({ currency: e.target.value })} aria-label={__('Moneda')}>
                        {CURRENCIES.map((c) => (
                            <option key={c.value} value={c.value}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                )}

                <Check
                    label={__('Conversiones mejoradas: enviar el correo y el teléfono a las etiquetas del sitio')}
                    checked={conversion.share_contact}
                    onChange={(v) => setConv({ share_contact: v })}
                    testId="conversion-share-contact"
                />
                {conversion.share_contact && (
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Google los cifra antes de usarlos y así atribuye mejor las conversiones. Son datos personales: actívalo sólo si tu política de datos lo contempla y en Google Ads activaste las conversiones mejoradas.')}
                    </p>
                )}

                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="attribution-settings">
                    <Check
                        label={kind === 'booking' ? __('Guardar de dónde vino cada cita') : __('Guardar de dónde vino cada registro')}
                        checked={attribution.enabled}
                        onChange={(v) => setAttr({ enabled: v })}
                        testId="attribution-enabled"
                    />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('La campaña (utm), el id del clic del anuncio y la página donde se llenó, en columnas del registro. Así ves en un tablero qué campaña trae clientes.')}
                    </p>
                    {attribution.enabled && (
                        <>
                            {[...ATTRIBUTION_DEFAULT_KEYS, ...(showExtra ? EXTRA_KEYS : [])].map((k) => {
                                const current = attributionFieldFor(attribution, k);
                                return (
                                    <div key={k} className="imcrm-grid imcrm-grid-cols-[minmax(0,1fr)_minmax(0,1fr)] imcrm-items-center imcrm-gap-2">
                                        <span className="imcrm-truncate imcrm-text-xs" title={ATTRIBUTION_LABELS[k]}>
                                            {ATTRIBUTION_LABELS[k]}
                                        </span>
                                        <select
                                            className={selectClass}
                                            value={current === null ? '' : String(current)}
                                            onChange={(e) => setAttr({ [attributionFieldKey(k)]: e.target.value === '' ? null : Number(e.target.value) } as Partial<AttributionSettings>)}
                                            data-testid={`attribution-field-${k}`}
                                        >
                                            <option value="">{__('No guardar')}</option>
                                            {usable
                                                .filter((f) => f.id === current || !used.has(f.id))
                                                .map((f) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.label}
                                                    </option>
                                                ))}
                                        </select>
                                    </div>
                                );
                            })}
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                {missingDefaults.length > 0 && (
                                    <Button size="sm" variant="outline" onClick={() => void createColumns()} disabled={creating} data-testid="attribution-create-columns">
                                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {creating ? __('Creando…') : __('Crear las columnas que faltan')}
                                    </Button>
                                )}
                                {!showExtra && (
                                    <button type="button" className="imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => setShowExtra(true)}>
                                        {__('Más datos (término, contenido, Microsoft, TikTok…)')}
                                    </button>
                                )}
                            </div>
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {__('Para no perder la campaña cuando la persona navega por tu sitio antes de llegar al formulario, pega el script de inserción en todas las páginas (pesa poco y queda guardado en el navegador).')}
                            </p>
                        </>
                    )}
                </div>
            </div>
        </Section>
    );
}

/**
 * v0.1.374 — La dirección de una página de gracias, con su ayuda: las
 * variables (`{{…}}`) que se pueden usar y el aviso de que el correo y el
 * teléfono nunca viajan en una dirección.
 */
export function ThankYouUrlField({
    value,
    delay,
    onChange,
    onDelay,
    variables,
    placeholder,
    testId,
}: {
    value: string | null;
    delay: number;
    onChange: (url: string | null) => void;
    onDelay: (seconds: number) => void;
    variables: ReadonlyArray<{ token: string; label: string }>;
    placeholder: string;
    testId: string;
}): JSX.Element {
    const [raw, setRaw] = useState(value ?? '');
    const bad = raw.trim() !== '' && !REDIRECT_URL_RE.test(raw.trim());
    const used = new Set(redirectVariables(raw));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <Field
                label={__('O llevar a esta página de gracias')}
                hint={
                    bad
                        ? __('Tiene que empezar con https:// y las variables van después del dominio (en la ruta o después de «?»).')
                        : __('Opcional. Ideal para medir conversiones con la etiqueta de tu sitio. Puedes pasarle datos con variables (el correo y el teléfono nunca viajan: Google Analytics no permite datos personales en las direcciones).')
                }
            >
                <Input
                    value={raw}
                    placeholder={placeholder}
                    aria-invalid={bad}
                    onChange={(e) => {
                        const v = e.target.value;
                        setRaw(v);
                        const t = v.trim();
                        if (t === '') onChange(null);
                        else if (REDIRECT_URL_RE.test(t)) onChange(t);
                    }}
                    data-testid={testId}
                />
            </Field>
            {variables.length > 0 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                    {variables.map((v) => (
                        <button
                            key={v.token}
                            type="button"
                            title={v.label}
                            className={`imcrm-rounded imcrm-border imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[10px] ${used.has(v.token) ? 'imcrm-border-primary imcrm-text-primary' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground'}`}
                            onClick={() => {
                                const base = raw.trim() || 'https://';
                                const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
                                const name = v.token.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
                                const next = `${base}${sep}${name}={{${v.token}}}`;
                                setRaw(next);
                                if (REDIRECT_URL_RE.test(next)) onChange(next);
                            }}
                        >
                            {`{{${v.token}}}`}
                        </button>
                    ))}
                </div>
            )}
            {(value ?? '') !== '' && (
                <Field label={__('Antes de ir, mostrar el agradecimiento')}>
                    <select className={selectClass} value={String(delay)} onChange={(e) => onDelay(Number(e.target.value))} data-testid={`${testId}-delay`}>
                        <option value="0">{__('No, ir enseguida')}</option>
                        {[2, 3, 5, REDIRECT_MAX_DELAY_S].map((s) => (
                            <option key={s} value={s}>
                                {__('%s segundos').replace('%s', String(s))}
                            </option>
                        ))}
                    </select>
                </Field>
            )}
        </div>
    );
}
