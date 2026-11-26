import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';
import { lazyDialog } from '@/lib/lazyDialog';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { RecordAction } from '@/admin/records/actions/RecordAction';

/**
 * D3 — «Enviar WhatsApp» desde un registro (modal, página y ficha diseñada).
 * Sin una cuenta de WhatsApp Business conectada no se dibuja nada. El botón
 * muestra el estado del último envío; el diálogo deja elegir una plantilla
 * aprobada (con sus variables y la vista previa) o, si el contacto escribió en
 * las últimas 24 h, mandar un texto.
 *
 * v0.1.389 — con Imagina WAS no hay plantillas ni ventana: un mensaje o un
 * archivo por enlace, siempre.
 */
function SendWhatsappButtonInner({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const isGuest = useIsGuest();
    const [open, setOpen] = useState(false);
    const key = ['record-whatsapp', listId, recordId] as const;
    const q = useQuery({
        queryKey: key,
        queryFn: () => api.whatsappRecord(listId, recordId),
        enabled: !isGuest,
        retry: false,
        staleTime: 30_000,
    });
    const info = q.data;
    if (isGuest || !info || info.connections.length === 0) return null;
    const first = info.connections[0]!;
    const status = info.connections.find((c) => c.last_status !== null)?.last_status ?? null;
    const label = __('Enviar WhatsApp');
    return (
        <>
            {compact ? (
                <RecordAction
                    icon={<MessageCircle className="imcrm-h-4 imcrm-w-4" />}
                    label={label}
                    hint={status ? `${__('Un mensaje al teléfono de este registro. Último envío:')} ${status}` : __('Un mensaje al teléfono de este registro')}
                    dot={first.provider === 'whatsapp_cloud' && first.window_open}
                    onClick={() => setOpen(true)}
                    data-testid="record-whatsapp"
                />
            ) : (
                <Button variant="outline" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-whatsapp">
                    <MessageCircle className="imcrm-h-4 imcrm-w-4" />
                    {label}
                </Button>
            )}
            {open && <SendWhatsappDialog open listId={listId} recordId={recordId} info={info} onClose={() => setOpen(false)} />}
        </>
    );
}

/** Al cambiar de número: Imagina WAS no tiene plantillas y la oficial no manda archivos sueltos. */
/** v0.1.470 — el diálogo (plantillas, variables, vista previa) se baja al abrirlo: no viaja con la ficha. */
const SendWhatsappDialog = lazyDialog(() => import('./SendWhatsappDialog').then((m) => ({ default: m.SendWhatsappDialog })));

/** v0.1.338 (ADR-S87) — sin el módulo en el plan, el botón no aparece. */
export function SendWhatsappButton(props: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const off = usePlanModuleOff('integrations');
    return off ? null : <SendWhatsappButtonInner {...props} />;
}
