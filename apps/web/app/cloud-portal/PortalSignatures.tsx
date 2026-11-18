import { useState } from 'react';
import { CheckCircle2, Download, FileSignature, Loader2 } from 'lucide-react';
import type { PortalSignature } from '@imagina-base/shared';

import { filenameOf } from '@/cloud-portal/PortalDocuments';
import { formatDateTime } from '@/lib/tenantFormat';
import { portalAccountHeaders } from '@/portal/portalAccount';

/**
 * v0.1.447 (D6, ADR-S107) — Los documentos de su registro que el cliente
 * tiene que firmar (o ya firmó). «Firmar» abre su enlace personal (la misma
 * página de firma del correo, con su código); el firmado se baja del portal.
 */
const STATUS_TEXT: Record<PortalSignature['status'], string> = {
    pending: 'Esperando firmas',
    completed: 'Firmado',
    declined: 'No se firmó',
    expired: 'Venció',
    voided: 'Anulado',
};

export function PortalSignatures({ signatures }: { signatures: PortalSignature[] }): JSX.Element | null {
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (signatures.length === 0) return null;

    const download = async (s: PortalSignature): Promise<void> => {
        setBusy(s.id);
        setError(null);
        try {
            const res = await fetch(`/api/v1/portal/me/signatures/${s.id}/signed.pdf`, { credentials: 'include', headers: portalAccountHeaders() });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                throw new Error(body?.message || 'No se pudo bajar el documento firmado.');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filenameOf(res.headers.get('content-disposition')) ?? `${s.title} - firmado.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="portal-signatures">
            <h2 className="imcrm-text-base imcrm-font-semibold imcrm-tracking-tight">Documentos para firmar</h2>
            <ul className="imcrm-divide-y imcrm-divide-border">
                {signatures.map((s) => (
                    <li key={s.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-py-3 first:imcrm-pt-0 last:imcrm-pb-0" data-portal-signature={s.id}>
                        <FileSignature className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-primary" />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{s.title}</p>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {s.my_status === 'signed' && s.status === 'pending'
                                    ? 'Ya firmaste: falta que firmen las demás personas'
                                    : s.status === 'pending' && s.sign_url
                                      ? `Te toca firmar · vence el ${formatDateTime(new Date(s.expires_at))}`
                                      : s.status === 'pending'
                                        ? 'Firmas cuando firme la persona anterior'
                                        : STATUS_TEXT[s.status]}
                            </p>
                        </div>
                        {s.sign_url && (
                            <a
                                href={s.sign_url}
                                className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-primary imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90"
                                data-testid="portal-signature-sign"
                            >
                                <FileSignature className="imcrm-h-4 imcrm-w-4" />
                                Firmar
                            </a>
                        )}
                        {s.signed_available && (
                            <button
                                type="button"
                                onClick={() => void download(s)}
                                disabled={busy !== null}
                                className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5 disabled:imcrm-opacity-60"
                                data-testid="portal-signature-download"
                            >
                                {busy === s.id ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" /> : <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600" />}
                                Bajar el firmado
                                <Download className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {error && (
                <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
