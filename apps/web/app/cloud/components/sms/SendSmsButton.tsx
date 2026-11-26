import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';
import { lazyDialog } from '@/lib/lazyDialog';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';

/**
 * SMS (ADR-S82) — «Enviar SMS» desde un registro (modal, página y ficha
 * diseñada). Sin una conexión de SMS no se dibuja nada. El diálogo muestra el
 * texto REAL (las variables resueltas por el servidor con este registro) y el
 * contador de SMS con la misma función que usa el envío.
 */
function SendSmsButtonInner({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    const q = useQuery({
        queryKey: ['record-sms', listId, recordId] as const,
        queryFn: () => api.smsRecord(listId, recordId),
        enabled: !isGuest,
        retry: false,
        staleTime: 30_000,
    });
    const info = q.data;
    if (isGuest || !info || info.connections.length === 0) return null;
    const label = __('Enviar SMS');
    return (
        <>
            {compact ? (
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    title={info.last ? `${label} · ${__('último SMS:')} ${info.last.status}` : label}
                    onClick={() => setOpen(true)}
                    data-testid="record-sms"
                    data-tour="record-sms"
                >
                    <MessageSquareText className="imcrm-h-4 imcrm-w-4" />
                </Button>
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-sms" data-tour="record-sms">
                    <MessageSquareText className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <SendSmsDialog open listId={listId} recordId={recordId} info={info} onClose={() => setOpen(false)} />}
        </>
    );
}

/** v0.1.470 — el diálogo (texto real, contador, envío) se baja al abrirlo: no viaja con la ficha. */
const SendSmsDialog = lazyDialog(() => import('./SendSmsDialog').then((m) => ({ default: m.SendSmsDialog })));

/** v0.1.338 (ADR-S87) — sin el módulo en el plan, el botón no aparece. */
export function SendSmsButton(props: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const off = usePlanModuleOff('integrations');
    return off ? null : <SendSmsButtonInner {...props} />;
}
