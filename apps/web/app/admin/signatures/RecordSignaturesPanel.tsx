import { lazy, Suspense, useState } from 'react';
import { SIGNATURE_STATUS_LABELS, SIGNER_STATUS_LABELS, signatureProgress, type SignatureRequestDto, type SignerDto } from '@imagina-base/shared';
import { Ban, CheckCircle2, Circle, Clock, Copy, Download, Eye, FileSignature, Mail, Send, XCircle } from 'lucide-react';

import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { openFilePreview } from '@/components/files/filePreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { formatDateTime } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { useDocumentTemplates } from '../documents/useDocuments';
import { signatureFileUrl, useRecordSignatures, useResendSignature, useVoidSignature } from './useSignatures';

const RequestSignatureDialog = lazy(() => import('./RequestSignatureDialog'));

function when(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : formatDateTime(d);
}

const TONE: Record<SignatureRequestDto['status'], string> = {
    pending: 'imcrm-bg-amber-500/15 imcrm-text-amber-800 dark:imcrm-text-amber-300',
    completed: 'imcrm-bg-emerald-500/15 imcrm-text-emerald-800 dark:imcrm-text-emerald-300',
    declined: 'imcrm-bg-rose-500/15 imcrm-text-rose-800 dark:imcrm-text-rose-300',
    expired: 'imcrm-bg-muted imcrm-text-muted-foreground',
    voided: 'imcrm-bg-muted imcrm-text-muted-foreground',
};

function SignerIcon({ status }: { status: SignerDto['status'] }): JSX.Element {
    if (status === 'signed') return <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />;
    if (status === 'declined') return <XCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-rose-600 dark:imcrm-text-rose-400" />;
    if (status === 'viewed') return <Eye className="imcrm-h-4 imcrm-w-4 imcrm-text-sky-600 dark:imcrm-text-sky-400" />;
    if (status === 'sent') return <Mail className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />;
    return <Circle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground/60" />;
}

function signerWhen(s: SignerDto): string {
    if (s.status === 'signed') return when(s.signed_at);
    if (s.status === 'declined') return when(s.declined_at);
    if (s.status === 'viewed') return when(s.viewed_at);
    if (s.status === 'sent') return when(s.sent_at);
    return '';
}

/**
 * D6 (v0.1.446, ADR-S107) — Firmas del registro: lo que se mandó a firmar, a
 * quién, quién ya firmó, y el PDF firmado con su constancia. Sin solicitudes,
 * en una lista que no tiene nada para firmar no dibuja nada (sería ruido en
 * cada ficha); si hay plantillas o campos Archivo, queda una línea discreta.
 */
function RecordSignaturesPanelInner({
    listId,
    recordId,
    fields,
    record,
}: {
    listId: number;
    recordId: number;
    fields: FieldEntity[];
    record?: RecordEntity;
}): JSX.Element | null {
    const isGuest = useIsGuest();
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const q = useRecordSignatures(listId, recordId, !isGuest);
    const templates = useDocumentTemplates(listId);
    const toast = useToast();
    const [asking, setAsking] = useState(false);

    if (isGuest || q.isLoading || q.isError || !q.data) return null;
    const items = q.data;
    const hasSources = (templates.data ?? []).length > 0 || fields.some((f) => f.type === 'file');

    const dialog = asking ? (
        <Suspense fallback={null}>
            <RequestSignatureDialog
                listId={listId}
                recordId={recordId}
                fields={fields}
                record={record}
                onClose={() => setAsking(false)}
                onCreated={(dto, emailed) => {
                    setAsking(false);
                    if (emailed) {
                        toast.success(__('Enviado para firmar'), sprintf(__('Le llegó el enlace a %s.'), dto.signers.filter((s) => s.status === 'sent').map((s) => s.name).join(', ')));
                    } else {
                        toast.success(__('Enlaces listos'), __('Cópialos desde «Firmas» y mándalos por el medio que prefieras.'));
                    }
                }}
            />
        </Suspense>
    ) : null;

    if (items.length === 0) {
        if (!canEdit || !hasSources) return null;
        return (
            <>
                <button
                    type="button"
                    onClick={() => setAsking(true)}
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
                    data-testid="signature-ask"
                    data-tour="record-signature"
                >
                    <FileSignature className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Pedir firma de un documento')}
                </button>
                {dialog}
            </>
        );
    }

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="record-signatures" data-tour="record-signature">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <FileSignature className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Firmas')}
                </p>
                {canEdit && (
                    <Button variant="ghost" size="sm" className="imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs" onClick={() => setAsking(true)} data-testid="signature-ask">
                        <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Pedir firma')}
                    </Button>
                )}
            </div>
            <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                {items.map((r) => (
                    <SignatureItem key={r.id} r={r} listId={listId} recordId={recordId} canEdit={canEdit} />
                ))}
            </ul>
            {dialog}
        </section>
    );
}

function SignatureItem({ r, listId, recordId, canEdit }: { r: SignatureRequestDto; listId: number; recordId: number; canEdit: boolean }): JSX.Element {
    const toast = useToast();
    const resend = useResendSignature(listId, recordId);
    const voidReq = useVoidSignature(listId, recordId);
    const [voiding, setVoiding] = useState(false);
    const [reason, setReason] = useState('');
    const progress = signatureProgress(r.signers);
    const which = r.status === 'completed' ? 'signed' : 'original';

    const copy = async (s: SignerDto): Promise<void> => {
        if (!s.link) return;
        await navigator.clipboard?.writeText(s.link).catch(() => undefined);
        toast.success(__('Enlace copiado'), sprintf(__('Es personal: mándaselo sólo a %s.'), s.name));
    };

    return (
        <li className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3" data-testid="signature-item" data-status={r.status}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-medium" title={r.title}>
                    {r.title}
                </span>
                <span className={cn('imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold', TONE[r.status])}>{SIGNATURE_STATUS_LABELS[r.status]}</span>
            </div>
            <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('%1$d de %2$d firmaron'), progress.signed, progress.total)}
                {r.created_by_name ? ` · ${sprintf(__('lo pidió %s'), r.created_by_name)}` : ''}
                {` · ${when(r.created_at)}`}
                {r.status === 'pending' && ` · ${sprintf(__('vence el %s'), when(r.expires_at))}`}
                {r.status === 'completed' && r.completed_at && ` · ${sprintf(__('firmado el %s'), when(r.completed_at))}`}
            </p>
            {r.void_reason && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Motivo: %s'), r.void_reason)}</p>}

            <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {r.signers.map((s) => (
                    <li key={s.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-xs" data-testid="signature-signer" data-status={s.status}>
                        <SignerIcon status={s.status} />
                        <span className="imcrm-font-medium imcrm-text-foreground">{s.signed_name ?? s.name}</span>
                        <span className="imcrm-text-muted-foreground">
                            {s.email}
                            {s.role ? ` · ${s.role}` : ''}
                        </span>
                        <span className="imcrm-text-muted-foreground">
                            — {SIGNER_STATUS_LABELS[s.status]}
                            {signerWhen(s) ? ` ${signerWhen(s)}` : ''}
                        </span>
                        {s.decline_reason && <span className="imcrm-w-full imcrm-pl-6 imcrm-text-rose-700 dark:imcrm-text-rose-300">«{s.decline_reason}»</span>}
                        {canEdit && r.status === 'pending' && s.link && (
                            <span className="imcrm-ml-auto imcrm-flex imcrm-gap-1">
                                <button type="button" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-accent" onClick={() => void copy(s)} data-testid="signature-copy-link">
                                    <Copy className="imcrm-h-3 imcrm-w-3" />
                                    {__('Copiar enlace')}
                                </button>
                                {(s.status === 'sent' || s.status === 'viewed') && (
                                    <button
                                        type="button"
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-accent disabled:imcrm-opacity-50"
                                        disabled={resend.isPending}
                                        onClick={() =>
                                            resend.mutate(
                                                { id: r.id, signerId: s.id },
                                                {
                                                    onSuccess: () => toast.success(__('Reenviado'), sprintf(__('Le llegó otra vez el enlace a %s.'), s.email)),
                                                    onError: (err) => toast.error(__('No se pudo reenviar'), err instanceof Error ? err.message : String(err)),
                                                },
                                            )
                                        }
                                        data-testid="signature-resend"
                                    >
                                        <Mail className="imcrm-h-3 imcrm-w-3" />
                                        {__('Reenviar')}
                                    </button>
                                )}
                            </span>
                        )}
                    </li>
                ))}
            </ul>

            <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs"
                    onClick={() => openFilePreview([{ url: signatureFileUrl(listId, recordId, r.id, which), title: r.title, mimeType: 'application/pdf' }])}
                    data-testid="signature-view"
                >
                    <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                    {r.status === 'completed' ? __('Ver el firmado') : __('Ver el documento')}
                </Button>
                {r.status === 'completed' && (
                    <a
                        href={signatureFileUrl(listId, recordId, r.id, 'signed', true)}
                        className="imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2 imcrm-text-xs imcrm-font-medium hover:imcrm-bg-accent"
                        data-testid="signature-download"
                    >
                        <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Descargar el PDF firmado')}
                    </a>
                )}
                {r.status === 'pending' && (
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-px-1 imcrm-text-xs imcrm-text-muted-foreground">
                        <Clock className="imcrm-h-3.5 imcrm-w-3.5" />
                        {r.order === 'sequential' ? __('Firman en orden') : __('Firman todos a la vez')}
                    </span>
                )}
                {canEdit && r.status === 'pending' && !voiding && (
                    <Button variant="ghost" size="sm" className="imcrm-ml-auto imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive" onClick={() => setVoiding(true)} data-testid="signature-void">
                        <Ban className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Anular')}
                    </Button>
                )}
            </div>
            {r.status === 'completed' && (
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {sprintf(__('Código de verificación: %s'), r.code)}
                </p>
            )}
            {voiding && (
                <form
                    className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 sm:imcrm-flex-row"
                    onSubmit={(e) => {
                        e.preventDefault();
                        voidReq.mutate(
                            { id: r.id, reason: reason.trim() },
                            {
                                onSuccess: () => {
                                    setVoiding(false);
                                    toast.success(__('Solicitud anulada'), __('Los enlaces ya no sirven y a quienes la recibieron les llegó un aviso.'));
                                },
                                onError: (err) => toast.error(__('No se pudo anular'), err instanceof Error ? err.message : String(err)),
                            },
                        );
                    }}
                >
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={__('Motivo (opcional, lo ven quienes firman)')} maxLength={500} className="imcrm-h-8 imcrm-flex-1 imcrm-text-xs" data-testid="signature-void-reason" />
                    <div className="imcrm-flex imcrm-gap-1">
                        <Button type="button" variant="ghost" size="sm" className="imcrm-h-8 imcrm-text-xs" onClick={() => setVoiding(false)}>
                            {__('Cancelar')}
                        </Button>
                        <Button type="submit" variant="destructive" size="sm" className="imcrm-h-8 imcrm-text-xs" disabled={voidReq.isPending} data-testid="signature-void-confirm">
                            {__('Anular la solicitud')}
                        </Button>
                    </div>
                </form>
            )}
        </li>
    );
}

/** Sin el módulo de documentos en el plan, el panel no aparece. */
export function RecordSignaturesPanel(props: Parameters<typeof RecordSignaturesPanelInner>[0]): JSX.Element | null {
    const off = usePlanModuleOff('documents');
    return off ? null : <RecordSignaturesPanelInner {...props} />;
}
