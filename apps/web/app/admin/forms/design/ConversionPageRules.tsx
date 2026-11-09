import { useState } from 'react';
import { ArrowDown, ArrowUp, Check as CheckIcon, Plus, Trash2 } from 'lucide-react';

import {
    CONVERSION_MAX_PAGE_RULES,
    conversionTargetFor,
    googleAdsIdFromSendTo,
    pageTerms,
    parseGoogleAdsSendTo,
    type ConversionPageRule,
    type ConversionSettings,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';

import { Check, Field } from '../../automations/email/EmailBlockInspector';

/** Un id corto para una regla nueva (sólo identifica la regla dentro del formulario). */
function newRuleId(): string {
    return `r${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * v0.1.388 — «Una etiqueta distinta por página»: el mismo formulario (o la
 * misma agenda) insertado en varias páginas del sitio dispara la acción de
 * Google Ads (y el evento de Meta) de la primera regla cuya página coincide;
 * en las demás páginas, lo de arriba. Las decide el servidor con la misma
 * función que usa el probador de aquí abajo (`conversionTargetFor`).
 */
export function ConversionPageRules({
    kind,
    conversion,
    onChange,
}: {
    kind: 'form' | 'booking';
    conversion: ConversionSettings;
    onChange: (rules: ConversionPageRule[]) => void;
}): JSX.Element {
    const rules = conversion.page_rules;
    const isBooking = kind === 'booking';
    const metaLabel = isBooking ? __('Registrar «Schedule» en el píxel de Meta en estas páginas') : __('Registrar «Lead» en el píxel de Meta en estas páginas');
    const [probe, setProbe] = useState('');

    const setRule = (id: string, patch: Partial<ConversionPageRule>): void => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const move = (index: number, delta: -1 | 1): void => {
        const next = [...rules];
        const [r] = next.splice(index, 1);
        next.splice(index + delta, 0, r!);
        onChange(next);
    };
    const add = (): void =>
        onChange([...rules, { id: newRuleId(), name: '', page_contains: '', google_ads: null, meta_event: conversion.meta_event }]);

    const probeUrl = probe.trim();
    const probeOk = /^https?:\/\/[^\s/?#]+/i.test(probeUrl);
    const target = probeOk ? conversionTargetFor(conversion, probeUrl) : null;
    const defaultAccount = googleAdsIdFromSendTo(conversion.google_ads);

    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3"
            data-testid="conversion-page-rules"
            data-tour={isBooking ? 'booking-conversion-rules' : 'form-conversion-rules'}
        >
            <p className="imcrm-text-xs imcrm-font-medium">{__('Una etiqueta distinta por página')}</p>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {isBooking
                    ? __('Si la agenda está en varias páginas de tu sitio, cada una puede medir con su propia acción de Google Ads. Gana la primera regla cuya página coincide; en las demás páginas (y en el enlace directo) vale lo de arriba.')
                    : __('Si el formulario está en varias páginas de tu sitio, cada una puede medir con su propia acción de Google Ads. Gana la primera regla cuya página coincide; en las demás páginas (y en el enlace directo) vale lo de arriba.')}
            </p>

            {rules.map((r, i) => (
                <PageRuleCard
                    key={r.id}
                    rule={r}
                    index={i}
                    count={rules.length}
                    metaLabel={metaLabel}
                    defaultAccount={defaultAccount}
                    onChange={(patch) => setRule(r.id, patch)}
                    onMove={(d) => move(i, d)}
                    onRemove={() => onChange(rules.filter((x) => x.id !== r.id))}
                />
            ))}

            {rules.length < CONVERSION_MAX_PAGE_RULES && (
                <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={add} data-testid="conversion-rule-add">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar una regla por página')}
                </Button>
            )}

            {rules.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    <Field label={__('Probar con una página')} hint={__('Pega la dirección de una página de tu sitio para ver qué se dispara ahí.')}>
                        <Input
                            value={probe}
                            placeholder="https://misitio.com/landing-navidad"
                            onChange={(e) => setProbe(e.target.value)}
                            data-testid="conversion-rule-probe"
                        />
                    </Field>
                    {probeUrl !== '' && (
                        <p className="imcrm-text-[11px] imcrm-leading-snug" data-testid="conversion-rule-probe-result">
                            {!probeOk || !target
                                ? __('Escribe la dirección completa, con https://')
                                : `${target.rule ? __('Usa la regla «%s»').replace('%s', target.rule) : __('Ninguna regla coincide: vale lo de «en las demás páginas»')} → ${
                                      target.google_ads ? `Google Ads ${target.google_ads}` : __('sin Google Ads')
                                  } · ${target.meta_event ? __('con el píxel de Meta') : __('sin el píxel de Meta')}`}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function PageRuleCard({
    rule,
    index,
    count,
    metaLabel,
    defaultAccount,
    onChange,
    onMove,
    onRemove,
}: {
    rule: ConversionPageRule;
    index: number;
    count: number;
    metaLabel: string;
    defaultAccount: string | null;
    onChange: (patch: Partial<ConversionPageRule>) => void;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
}): JSX.Element {
    const [adsRaw, setAdsRaw] = useState(rule.google_ads ?? '');
    const adsParsed = adsRaw.trim() === '' ? null : parseGoogleAdsSendTo(adsRaw);
    const adsBad = adsRaw.trim() !== '' && adsParsed === null;
    const terms = pageTerms(rule.page_contains);
    const account = googleAdsIdFromSendTo(rule.google_ads);
    const otherAccount = account !== null && defaultAccount !== null && account !== defaultAccount;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2.5" data-testid="conversion-rule" data-rule={rule.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary">
                    {index + 1}
                </span>
                <Input
                    value={rule.name}
                    maxLength={80}
                    placeholder={__('Nombre (opcional): Landing de Navidad')}
                    className="imcrm-h-8 imcrm-flex-1 imcrm-text-xs"
                    onChange={(e) => onChange({ name: e.target.value })}
                    aria-label={__('Nombre de la regla')}
                    data-testid="conversion-rule-name"
                />
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label={__('Subir')} title={__('Subir (se revisa antes)')}>
                    <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={__('Bajar')} title={__('Bajar')}>
                    <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" onClick={onRemove} aria-label={__('Quitar la regla')} title={__('Quitar la regla')} data-testid="conversion-rule-remove">
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>
            <Field
                label={__('Si la página contiene')}
                hint={
                    terms.length === 0
                        ? __('Escribe una parte de la dirección (por ejemplo «landing-navidad»). Varias, separadas por coma, valen como «cualquiera». Sin palabras, la regla no aplica.')
                        : __('Sin mayúsculas ni tildes. No cuentan los parámetros de campaña (utm, gclid…): para separar por campaña, usa la columna de campaña.')
                }
            >
                <Input
                    value={rule.page_contains}
                    maxLength={500}
                    placeholder="landing-navidad, /promo"
                    aria-invalid={terms.length === 0}
                    onChange={(e) => onChange({ page_contains: e.target.value })}
                    data-testid="conversion-rule-contains"
                />
            </Field>
            <Field
                label={__('Etiqueta de conversión de Google Ads')}
                hint={
                    adsBad
                        ? __('No reconocemos ese código. Pega el fragmento del evento que te da Google Ads o el «AW-123456789/AbC…».')
                        : adsRaw.trim() === ''
                          ? __('Vacía = en estas páginas no se dispara Google Ads.')
                          : otherAccount
                            ? __('Es otra cuenta de Google Ads (%s): tu sitio tiene que cargar también la etiqueta de esa cuenta.').replace('%s', account!)
                            : undefined
                }
            >
                <Input
                    value={adsRaw}
                    placeholder="AW-123456789/AbCdEfGhIj"
                    aria-invalid={adsBad}
                    onChange={(e) => {
                        const raw = e.target.value;
                        setAdsRaw(raw);
                        const parsed = raw.trim() === '' ? null : parseGoogleAdsSendTo(raw);
                        if (raw.trim() === '' || parsed) onChange({ google_ads: parsed });
                    }}
                    onBlur={() => {
                        if (adsParsed) setAdsRaw(adsParsed);
                    }}
                    data-testid="conversion-rule-ads"
                />
                {adsParsed && (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-success">
                        <CheckIcon className="imcrm-h-3 imcrm-w-3" />
                        {adsParsed}
                    </p>
                )}
            </Field>
            <Check label={metaLabel} checked={rule.meta_event} onChange={(v) => onChange({ meta_event: v })} testId="conversion-rule-meta" />
        </div>
    );
}
