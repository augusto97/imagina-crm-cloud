import {
    SMS_MAX_SEGMENTS,
    SMS_STATUS_OPTIONS,
    finalSmsText,
    smsCounterLabel,
    smsSegments,
    type SmsSendResult,
    type SmsStatus,
} from '@imagina-base/shared';
import { AlertTriangle, CalendarClock, CheckCircle2, MessageSquareText } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * Piezas chicas de SMS (ADR-S82): el chip del estado (el MISMO color que la
 * opción de la columna «Estado del último SMS»), el contador de SMS con la
 * misma función que usa el envío, la burbuja de vista previa y el reporte de
 * un envío o una prueba.
 */

export function SmsStatusChip({ status, className }: { status: SmsStatus; className?: string }): JSX.Element {
    const shown = status === 'enviando' ? 'en_cola' : status;
    const opt = SMS_STATUS_OPTIONS[shown];
    return (
        <span
            data-testid="imcrm-sms-status"
            data-status={status}
            className={cn('imcrm-inline-flex imcrm-items-center imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-white', className)}
            style={{ backgroundColor: opt.color }}
        >
            {opt.label}
        </span>
    );
}

/**
 * «2 SMS · 145 caracteres», lo que queda en el último y, si el texto lleva
 * caracteres fuera del alfabeto GSM, cuáles son y la opción de quitarlos.
 * Cuenta el texto FINAL (con «Quitar tildes» aplicado), igual que el envío.
 */
export function SmsCounter({
    text,
    stripAccents,
    onStripAccents,
    hasVariables = false,
    className,
}: {
    text: string;
    stripAccents: boolean;
    onStripAccents?: (next: boolean) => void;
    /** El texto tiene variables: el largo real depende de cada registro. */
    hasVariables?: boolean;
    className?: string;
}): JSX.Element {
    const finalText = finalSmsText(text, stripAccents);
    const info = smsSegments(finalText);
    const raw = smsSegments(finalSmsText(text, false));
    const tooLong = info.segments > SMS_MAX_SEGMENTS;
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px]', className)} data-testid="imcrm-sms-counter" data-segments={info.segments} data-encoding={info.encoding}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-0.5 imcrm-text-muted-foreground">
                <span className={cn('imcrm-font-medium', info.segments > 1 ? 'imcrm-text-amber-700 dark:imcrm-text-amber-400' : 'imcrm-text-foreground', tooLong && 'imcrm-text-destructive')} data-testid="imcrm-sms-counter-label">
                    {smsCounterLabel(info)}
                </span>
                {info.segments > 0 && !tooLong && (
                    <span>
                        {sprintf(/* translators: %d: caracteres */ __('quedan %d en este SMS'), info.remaining)}
                    </span>
                )}
                {hasVariables && <span>{__('(sin contar las variables)')}</span>}
            </div>
            {tooLong && (
                <p className="imcrm-text-destructive">
                    {sprintf(/* translators: %d: máximo */ __('Demasiado largo: el máximo es %d SMS. Acórtalo.'), SMS_MAX_SEGMENTS)}
                </p>
            )}
            {raw.encoding !== 'ucs2' && hasVariables && onStripAccents && (
                // El texto no tiene tildes, pero los datos de cada registro sí
                // pueden traerlas («Gómez»): la opción tiene que verse igual.
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                    <span className="imcrm-text-muted-foreground">{__('Los datos de las variables pueden traer tildes (como «Gómez»).')}</span>
                    <StripAccentsToggle checked={stripAccents} onChange={onStripAccents} />
                </div>
            )}
            {raw.encoding === 'ucs2' && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                    {info.encoding === 'ucs2' ? (
                        <span className="imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="imcrm-sms-counter-ucs2">
                            {sprintf(
                                /* translators: %s: caracteres */
                                __('Con %s cada SMS lleva 70 caracteres en vez de 160.'),
                                info.non_gsm.slice(0, 8).map((c) => `«${c}»`).join(' '),
                            )}
                        </span>
                    ) : (
                        <span className="imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                            {sprintf(
                                /* translators: 1: SMS sin quitar, 2: SMS ahora */
                                __('Sin tildes: %2$d SMS en vez de %1$d.'),
                                raw.segments,
                                info.segments,
                            )}
                        </span>
                    )}
                    {onStripAccents && <StripAccentsToggle checked={stripAccents} onChange={onStripAccents} />}
                </div>
            )}
        </div>
    );
}

function StripAccentsToggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }): JSX.Element {
    return (
        <label className="imcrm-inline-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-foreground">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="imcrm-h-3.5 imcrm-w-3.5"
                data-testid="imcrm-sms-strip-accents"
            />
            {__('Quitar tildes para que entre en menos SMS')}
        </label>
    );
}

/** El texto como lo verá el teléfono. */
export function SmsBubble({ text, to }: { text: string; to?: string | null }): JSX.Element {
    return (
        <div className="imcrm-rounded-xl imcrm-bg-muted/60 imcrm-p-3" data-testid="imcrm-sms-bubble">
            {to && <p className="imcrm-mb-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">{sprintf(/* translators: %s: teléfono */ __('Para %s'), to)}</p>}
            <div className="imcrm-max-w-[85%] imcrm-whitespace-pre-wrap imcrm-break-words imcrm-rounded-2xl imcrm-rounded-bl-sm imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-foreground imcrm-shadow-sm">
                {text || <span className="imcrm-text-muted-foreground">{__('(sin texto)')}</span>}
            </div>
        </div>
    );
}

export function SmsSendReport({ result }: { result: SmsSendResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2 imcrm-text-xs" data-testid="imcrm-sms-send-report" data-ok={result.ok ? '1' : '0'}>
            {!result.ok ? (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-font-medium imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {result.error ?? __('No se pudo enviar.')}
                </p>
            ) : result.simulated ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-foreground">
                    <MessageSquareText className="imcrm-h-3.5 imcrm-w-3.5" />
                    {result.scheduled_for
                        ? sprintf(
                              /* translators: 1: teléfono, 2: fecha */
                              __('Así saldría a %1$s. Por el horario de la Ley 2300 quedaría programado para %2$s. No se envió nada.'),
                              result.to,
                              formatDateTimeStr(result.scheduled_for),
                          )
                        : sprintf(/* translators: %s: teléfono */ __('Así saldría a %s. No se envió nada.'), result.to)}
                </p>
            ) : result.status === 'programado' ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-violet-700 dark:imcrm-text-violet-300">
                    <CalendarClock className="imcrm-h-3.5 imcrm-w-3.5" />
                    {sprintf(
                        /* translators: %s: fecha */
                        __('Programado para %s: fuera del horario permitido para mensajes comerciales (Ley 2300).'),
                        result.scheduled_for ? formatDateTimeStr(result.scheduled_for) : '',
                    )}
                </p>
            ) : (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                    <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {sprintf(
                        /* translators: 1: teléfono, 2: SMS */
                        __('Enviado a %1$s (%2$s). El estado de entrega llega solo.'),
                        result.to,
                        result.segments === 1 ? __('1 SMS') : sprintf(__('%d SMS'), result.segments),
                    )}
                </p>
            )}
            {result.text !== '' && <p className="imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-muted-foreground" data-testid="imcrm-sms-report-text">{result.text}</p>}
            {(result.request || result.response) && (
                <details>
                    <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{__('Ver lo que se envió al proveedor y su respuesta')}</summary>
                    {result.request && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`${result.request.method} ${result.request.url}\n\n${result.request.body}`}
                        </pre>
                    )}
                    {result.response && (
                        <pre className="imcrm-mt-1 imcrm-max-h-48 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-break-all imcrm-rounded imcrm-bg-background imcrm-p-2 imcrm-text-[11px]">
                            {`HTTP ${result.response.status}\n\n${result.response.body}`}
                        </pre>
                    )}
                </details>
            )}
        </div>
    );
}

/** ¿El texto usa variables (`{{campo}}`)? */
export function hasMergeTags(text: string): boolean {
    return /\{\{\s*[^}]+\}\}/.test(text);
}
