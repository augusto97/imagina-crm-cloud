import { useState } from 'react';
import { BarChart3, Check as CheckIcon, Copy, ExternalLink } from 'lucide-react';

import {
    COLLECTION_CURRENCY_OPTIONS,
    CONVERSION_EVENT_BOOKING,
    CONVERSION_EVENT_FORM,
    googleAdsIdFromSendTo,
    parseGoogleAdsSendTo,
    parseGoogleTagId,
    parseMetaPixelId,
    REDIRECT_MAX_DELAY_S,
    REDIRECT_URL_RE,
    redirectVariables,
    type ConversionSettings,
    type ConversionValueMode,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';

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

/**
 * v0.1.374 (ADR-S97) — «Medir conversiones»: lo que el formulario (o la
 * agenda) le avisa al sitio donde está insertado. El evento para Tag Manager
 * sale siempre; aquí se suma la etiqueta de Google Ads, el píxel de Meta y el
 * valor. v0.1.386 — de dónde vino cada registro se elige en `OriginColumns`.
 */
export function ConversionSettings({
    kind,
    conversion,
    onChange,
    calcs = [],
    canCharge = false,
}: {
    kind: 'form' | 'booking';
    conversion: ConversionSettings;
    onChange: (patch: { conversion?: ConversionSettings }) => void;
    calcs?: ReadonlyArray<{ key: string; name: string }>;
    /** El formulario cobra al enviar (el valor puede ser lo que se cobra). */
    canCharge?: boolean;
}): JSX.Element {
    const setConv = (patch: Partial<ConversionSettings>): void => onChange({ conversion: { ...conversion, ...patch } });
    const isBooking = kind === 'booking';
    const eventName = isBooking ? CONVERSION_EVENT_BOOKING : CONVERSION_EVENT_FORM;
    const [adsRaw, setAdsRaw] = useState(conversion.google_ads ?? '');
    const [copied, setCopied] = useState(false);
    const [gaRaw, setGaRaw] = useState(conversion.google_tag_id ?? '');
    const [pixelRaw, setPixelRaw] = useState(conversion.meta_pixel_id ?? '');

    const adsParsed = adsRaw.trim() === '' ? null : parseGoogleAdsSendTo(adsRaw);
    const adsBad = adsRaw.trim() !== '' && adsParsed === null;
    const gaParsed = gaRaw.trim() === '' ? null : parseGoogleTagId(gaRaw);
    const gaBad = gaRaw.trim() !== '' && gaParsed === null;
    const pixelParsed = pixelRaw.trim() === '' ? null : parseMetaPixelId(pixelRaw);
    const pixelBad = pixelRaw.trim() !== '' && pixelParsed === null;
    const adsId = googleAdsIdFromSendTo(conversion.google_ads);
    const directEmpty = conversion.direct_tags && !adsId && !conversion.google_tag_id && !conversion.meta_pixel_id;

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

                <div
                    className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3"
                    data-testid="direct-tags-settings"
                    data-tour={isBooking ? 'booking-direct-tags' : 'form-direct-tags'}
                >
                    <Check
                        label={__('Cargar mis etiquetas en el enlace directo')}
                        checked={conversion.direct_tags}
                        onChange={(v) => setConv({ direct_tags: v })}
                        testId="direct-tags-enabled"
                    />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {isBooking
                            ? __('Para cuando el anuncio lleva directo al enlace de la agenda, sin tu sitio de por medio: la página carga tus etiquetas de Google y Meta y registra la cita ahí. Insertada en tu sitio no se cargan (ahí mandan las de tu sitio).')
                            : __('Para cuando el anuncio lleva directo al enlace del formulario, sin tu sitio de por medio: la página carga tus etiquetas de Google y Meta y registra el envío ahí. Insertado en tu sitio no se cargan (ahí mandan las de tu sitio).')}
                    </p>
                    {conversion.direct_tags && (
                        <>
                            <p className="imcrm-text-[11px] imcrm-leading-snug" data-testid="direct-tags-ads">
                                {adsId
                                    ? __('Google Ads: usa la etiqueta de conversión de arriba (%s).').replace('%s', adsId)
                                    : __('Google Ads: pega arriba la etiqueta de conversión para medir las campañas de Google Ads.')}
                            </p>
                            <Field
                                label={__('ID de Google Analytics (opcional)')}
                                hint={
                                    gaBad
                                        ? __('No reconocemos ese ID. Empieza con «G-» (por ejemplo, G-AB12CD34EF).')
                                        : __('Empieza con «G-». En Google Analytics: Administrar → Flujos de datos → tu flujo web. Registra la visita y el evento «generate_lead».')
                                }
                            >
                                <Input
                                    value={gaRaw}
                                    placeholder="G-AB12CD34EF"
                                    onChange={(e) => {
                                        const raw = e.target.value;
                                        setGaRaw(raw);
                                        const parsed = raw.trim() === '' ? null : parseGoogleTagId(raw);
                                        if (raw.trim() === '' || parsed) setConv({ google_tag_id: parsed });
                                    }}
                                    onBlur={() => {
                                        if (gaParsed) setGaRaw(gaParsed);
                                    }}
                                    aria-invalid={gaBad}
                                    data-testid="direct-tags-ga"
                                />
                            </Field>
                            <Field
                                label={__('ID del píxel de Meta (opcional)')}
                                hint={
                                    pixelBad
                                        ? __('No reconocemos ese ID. Son sólo números (los encuentras en el Administrador de eventos de Meta).')
                                        : isBooking
                                          ? __('Sólo números. En Meta: Administrador de eventos → tu píxel. Registra la visita y «Schedule» al agendar.')
                                          : __('Sólo números. En Meta: Administrador de eventos → tu píxel. Registra la visita y «Lead» al enviar.')
                                }
                            >
                                <Input
                                    value={pixelRaw}
                                    placeholder="1234567890123456"
                                    inputMode="numeric"
                                    onChange={(e) => {
                                        const raw = e.target.value;
                                        setPixelRaw(raw);
                                        const parsed = raw.trim() === '' ? null : parseMetaPixelId(raw);
                                        if (raw.trim() === '' || parsed) setConv({ meta_pixel_id: parsed });
                                    }}
                                    onBlur={() => {
                                        if (pixelParsed) setPixelRaw(pixelParsed);
                                    }}
                                    aria-invalid={pixelBad}
                                    data-testid="direct-tags-pixel"
                                />
                            </Field>
                            {directEmpty && (
                                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-warning" data-testid="direct-tags-empty">
                                    {__('Pon al menos un ID (o la etiqueta de Google Ads de arriba): sin ellos la página no carga nada.')}
                                </p>
                            )}
                            <Check
                                label={__('Mostrar el aviso «Esta página usa cookies para medir las campañas»')}
                                checked={conversion.cookie_notice}
                                onChange={(v) => setConv({ cookie_notice: v })}
                                testId="direct-tags-notice"
                            />
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {__('Por seguridad, las etiquetas sólo pueden hablar con Google y Meta: no leen nada más de la app. A Google y Meta sólo les llega la campaña de la dirección, nunca las respuestas. Menciona estas cookies en tu política de datos.')}
                            </p>
                        </>
                    )}
                </div>

                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="conversion-origin-note">
                    {kind === 'booking'
                        ? __('De dónde llegó cada cita (la página, el sitio anterior y la campaña) se guarda en las columnas de abajo.')
                        : __('De dónde llegó cada registro (la página desde donde se envió, el sitio anterior y la campaña) se guarda en Ajustes → Origen y etiquetas.')}
                </p>
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
