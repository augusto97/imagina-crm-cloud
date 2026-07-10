import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, Loader2, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFields } from '@/hooks/useFields';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

interface Props {
    list: ListSummary;
    record: RecordEntity;
}

/**
 * Emisión de acceso al portal desde la ficha del registro (Imagina Base cloud).
 *
 * Cada registro puede tener un portal privado. El admin emite un MAGIC LINK de
 * un solo uso para el email del cliente: el backend crea (si hace falta) un
 * usuario `client` vinculado al record, manda el enlace por email y lo devuelve
 * para copiar. Endpoint: `POST /lists/:slug/portal/magic-link { record_id, email }`.
 *
 * Solo se muestra si la lista tiene el portal habilitado
 * (`settings.portal.enabled`). El email se prefill del primer campo `email` del
 * registro, pero es editable.
 */
export function PortalAccessButton({ list, record }: Props): JSX.Element | null {
    const enabled = readPortalEnabled(list.settings);
    const fields = useFields(list.id);
    const toast = useToast();

    // Prefill del email desde el primer campo de tipo `email` con valor.
    const detectedEmail = useMemo(() => {
        const emailField = (fields.data ?? []).find((f) => f.type === 'email');
        if (!emailField) return '';
        const v = record.fields[emailField.slug];
        return typeof v === 'string' ? v : '';
    }, [fields.data, record.fields]);

    const [email, setEmail] = useState('');
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [lastPath, setLastPath] = useState<string | null>(null);

    const value = email || detectedEmail;

    const issue = useMutation({
        mutationFn: async (to: string): Promise<{ token: string; path: string }> => {
            const res = await api.post<{ token: string; path: string }>(
                `/lists/${encodeURIComponent(list.slug)}/portal/magic-link`,
                { record_id: record.id, email: to },
            );
            return res.data;
        },
        onSuccess: (data, to) => {
            setSentTo(to);
            setLastPath(data.path);
            toast.success(__('Acceso enviado por email a'), to);
        },
        onError: (err: unknown) => {
            const msg = err instanceof ApiError || err instanceof Error
                ? err.message
                : __('No se pudo emitir el acceso.');
            toast.error(msg);
        },
    });

    const copyLink = async (): Promise<void> => {
        if (!lastPath) return;
        const url = `${window.location.origin}${lastPath}`;
        try {
            await navigator.clipboard.writeText(url);
            toast.success(__('Enlace copiado al portapapeles.'));
        } catch {
            toast.info(__('Enlace de acceso'), url);
        }
    };

    if (!enabled) return null;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2.5">
            <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {__('Acceso al portal del cliente')}
            </span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Input
                    type="email"
                    placeholder={__('email del cliente')}
                    value={value}
                    onChange={(e) => setEmail(e.target.value)}
                    className="imcrm-h-8 imcrm-max-w-[240px] imcrm-flex-1"
                />
                <Button
                    size="sm"
                    variant="outline"
                    className="imcrm-gap-1.5"
                    disabled={issue.isPending || !value.includes('@')}
                    onClick={() => issue.mutate(value)}
                >
                    {issue.isPending ? (
                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                    ) : (
                        <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                    )}
                    {__('Enviar acceso')}
                </Button>
                {lastPath && (
                    <Button size="sm" variant="ghost" className="imcrm-gap-1.5" onClick={() => void copyLink()}>
                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Copiar enlace')}
                    </Button>
                )}
            </div>
            {sentTo && (
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-green-600">
                    <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Enlace de un solo uso enviado a')} {sentTo}
                </span>
            )}
        </div>
    );
}

/** Lee `settings.portal.enabled`. */
function readPortalEnabled(settings: Record<string, unknown>): boolean {
    const raw = settings.portal;
    if (raw === null || raw === undefined || typeof raw !== 'object') return false;
    return (raw as Record<string, unknown>).enabled === true;
}
