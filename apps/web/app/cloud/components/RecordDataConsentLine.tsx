import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Scale, ShieldAlert } from 'lucide-react';

import { activeMembership, api } from '@/cloud/session';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { consentSentence, recordDataConsentsKey } from './dataConsentText';


const SHOWN = 3;

/**
 * Ley 1581 — en la ficha: si quien dio los datos de este registro autorizó su
 * tratamiento (desde un formulario o el portal), con qué versión del texto y
 * cuándo; y, si la retiró, dicho bien claro. Sin autorizaciones no dibuja nada.
 */
export function RecordDataConsentLine({ listId, recordId, className }: { listId: number; recordId: number; className?: string }): JSX.Element | null {
    const q = useQuery({
        queryKey: recordDataConsentsKey(listId, recordId),
        queryFn: () => api.recordDataConsents(listId, recordId),
        retry: false,
        staleTime: 30_000,
    });
    const items = q.data ?? [];
    if (items.length === 0) return null;
    const isAdmin = activeMembership()?.role === 'admin';
    const withdrawn = items.some((c) => c.withdrawn_at !== null);
    const names = new Set(items.map((c) => (c.subject_name || c.subject_email || '').toLowerCase()));
    const showWho = names.size > 1;

    return (
        <div
            className={cn(
                'imcrm-space-y-1 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-xs',
                withdrawn ? 'imcrm-border-destructive/30 imcrm-bg-destructive/5' : 'imcrm-border-border imcrm-bg-muted/20',
                className,
            )}
            data-testid="record-data-consent"
        >
            {items.slice(0, SHOWN).map((c) => {
                const off = c.withdrawn_at !== null;
                const Icon = off ? ShieldAlert : Scale;
                return (
                    <p
                        key={c.id}
                        className={cn('imcrm-flex imcrm-items-start imcrm-gap-1.5', off ? 'imcrm-text-[hsl(var(--imcrm-destructive-ink))]' : 'imcrm-text-muted-foreground')}
                        data-testid={off ? 'record-data-consent-withdrawn' : 'record-data-consent-active'}
                    >
                        <Icon className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                        <span>
                            <span className="imcrm-font-medium imcrm-text-foreground">{__('Autorización de datos:')}</span> {consentSentence(c)}
                            {showWho && (c.subject_name || c.subject_email) ? ` — ${c.subject_name || c.subject_email}` : ''}
                        </span>
                    </p>
                );
            })}
            {withdrawn && (
                <p className="imcrm-pl-5 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Los datos del registro no se borraron solos: decide qué hacer con ellos (suprimirlos o conservarlos si la ley te obliga) y respóndele al titular.')}
                </p>
            )}
            {(items.length > SHOWN || isAdmin) && (
                <p className="imcrm-pl-5 imcrm-text-[11px]">
                    {items.length > SHOWN && (
                        <span className="imcrm-text-muted-foreground">
                            {__('y %d más.').replace('%d', String(items.length - SHOWN))}{' '}
                        </span>
                    )}
                    {isAdmin && (
                        <Link to="/settings?s=privacidad" className="imcrm-text-primary hover:imcrm-underline">
                            {__('Ver la evidencia completa')}
                        </Link>
                    )}
                </p>
            )}
        </div>
    );
}
