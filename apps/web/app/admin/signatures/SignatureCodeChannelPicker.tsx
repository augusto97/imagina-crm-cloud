import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import type { SignatureCodeChannel, SignatureVerifyTemplate } from '@imagina-base/shared';
import { Loader2 } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';

import { useSignatureCodeChannels } from './useSignatures';

/** Valor del select de plantilla: `nombre|idioma`. */
function templateKey(t: { name: string; language: string }): string {
    return `${t.name}|${t.language}`;
}

/**
 * v0.1.448 — Por dónde sale el código de firma cuando va al celular: la
 * conexión de SMS o de WhatsApp del equipo y, con WhatsApp de Meta, la
 * plantilla aprobada (todas sus variables llevan el código). Lo comparten el
 * diálogo «Pedir firma» y la acción de las automatizaciones.
 */
export function SignatureCodeChannelPicker({
    channel,
    connectionId,
    template,
    onChange,
    idPrefix = 'sig-code',
}: {
    channel: 'sms' | 'whatsapp';
    connectionId: number | null;
    template: SignatureVerifyTemplate | null;
    onChange: (next: { connectionId: number | null; template: SignatureVerifyTemplate | null }) => void;
    idPrefix?: string;
}): JSX.Element {
    const q = useSignatureCodeChannels(true);
    const options = useMemo<SignatureCodeChannel[]>(() => (q.data ?? []).filter((c) => c.channel === channel), [q.data, channel]);
    const current = options.find((c) => c.id === connectionId) ?? null;
    const usableTemplates = current?.needs_template ? current.templates.filter((t) => t.usable) : [];

    // Sin elección (o con una conexión del otro canal), la primera que sirve.
    useEffect(() => {
        if (q.isLoading) return;
        if (current) return;
        const first = options[0];
        if (!first) {
            if (connectionId !== null || template !== null) onChange({ connectionId: null, template: null });
            return;
        }
        const t = first.needs_template ? first.templates.find((x) => x.usable) ?? null : null;
        onChange({ connectionId: first.id, template: t ? { name: t.name, language: t.language } : null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q.isLoading, options, current]);

    // Con WhatsApp de Meta, si la plantilla elegida ya no sirve, la primera que sí.
    useEffect(() => {
        if (!current) return;
        if (!current.needs_template) {
            if (template !== null) onChange({ connectionId: current.id, template: null });
            return;
        }
        const ok = template && current.templates.some((t) => t.usable && t.name === template.name && t.language === template.language);
        if (ok) return;
        const t = usableTemplates[0] ?? null;
        if ((t?.name ?? null) !== (template?.name ?? null) || (t?.language ?? null) !== (template?.language ?? null)) {
            onChange({ connectionId: current.id, template: t ? { name: t.name, language: t.language } : null });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current, template?.name, template?.language]);

    const channelName = channel === 'sms' ? __('SMS') : __('WhatsApp');

    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Buscando tus conexiones…')}
            </p>
        );
    }
    if (q.isError) {
        return <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{__('No se pudieron leer tus conexiones. Vuelve a intentarlo.')}</p>;
    }
    if (options.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-amber-800 dark:imcrm-text-amber-200" data-testid="signature-code-no-channel">
                {channel === 'sms'
                    ? __('Todavía no hay una conexión de SMS del equipo. Conecta Twilio u Onurix en ')
                    : __('Todavía no hay una conexión de WhatsApp del equipo. Conecta WhatsApp (Whats) o WhatsApp Business en ')}
                <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-underline">
                    {__('Integraciones')}
                </Link>
                {__(' y vuelve aquí.')}
            </p>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="signature-code-channel">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <Label htmlFor={`${idPrefix}-conn`}>
                    {__('Conexión de')} {channelName}
                </Label>
                <Select
                    id={`${idPrefix}-conn`}
                    value={current ? String(current.id) : ''}
                    onChange={(e) => {
                        const next = options.find((c) => String(c.id) === e.target.value) ?? null;
                        const t = next?.needs_template ? next.templates.find((x) => x.usable) ?? null : null;
                        onChange({ connectionId: next?.id ?? null, template: t ? { name: t.name, language: t.language } : null });
                    }}
                    data-testid="signature-code-connection"
                >
                    {options.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </Select>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {channel === 'sms'
                        ? __('Cada código es un SMS que cobra tu proveedor.')
                        : current?.needs_template
                          ? __('WhatsApp Business sólo deja escribir primero con una plantilla aprobada por Meta.')
                          : __('Sale desde tu número de WhatsApp conectado.')}
                </p>
            </div>

            {current?.needs_template && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor={`${idPrefix}-tpl`}>{__('Plantilla aprobada')}</Label>
                    {current.templates.length === 0 ? (
                        <p className="imcrm-rounded-md imcrm-bg-amber-500/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-amber-800 dark:imcrm-text-amber-200">
                            {__('Esta cuenta no tiene plantillas aprobadas. Crea en Meta una de categoría «Autenticación» con una variable para el código, y sincronízalas en la página de la conexión.')}
                        </p>
                    ) : (
                        <>
                            <Select
                                id={`${idPrefix}-tpl`}
                                value={template ? templateKey(template) : ''}
                                onChange={(e) => {
                                    const t = current.templates.find((x) => templateKey(x) === e.target.value && x.usable) ?? null;
                                    onChange({ connectionId: current.id, template: t ? { name: t.name, language: t.language } : null });
                                }}
                                data-testid="signature-code-template"
                            >
                                {usableTemplates.length === 0 && <option value="">{__('Ninguna sirve para el código')}</option>}
                                {current.templates.map((t) => (
                                    <option key={templateKey(t)} value={templateKey(t)} disabled={!t.usable}>
                                        {t.name} ({t.language}){t.usable ? '' : ` — ${t.reason ?? __('no sirve')}`}
                                    </option>
                                ))}
                            </Select>
                            {(() => {
                                const sel = current.templates.find((t) => template && t.name === template.name && t.language === template.language);
                                if (!sel) return null;
                                return (
                                    <p className="imcrm-whitespace-pre-line imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-testid="signature-code-template-preview">
                                        {sel.preview}
                                    </p>
                                );
                            })()}
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todas las variables de la plantilla llevan el código. Conviene una de categoría «Autenticación».')}</p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
