import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Loader2 } from 'lucide-react';
import type { PortalDocument } from '@imagina-base/shared';

import { portalAccountHeaders } from '@/portal/portalAccount';

/**
 * v0.1.267 (ADR-S35 fase 2) — Los documentos PDF que la empresa publicó en el
 * portal (cuenta de cobro, estado de cuenta…). Cada botón baja el PDF armado
 * con los datos del registro del cliente — el servidor nunca toma un id de
 * registro del navegador, sólo el de la plantilla.
 */
export function PortalDocuments({ documents }: { documents: PortalDocument[] }): JSX.Element | null {
    const qc = useQueryClient();
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (documents.length === 0) return null;

    const download = async (doc: PortalDocument): Promise<void> => {
        setBusy(doc.id);
        setError(null);
        try {
            const res = await fetch(`/api/v1/portal/me/documents/${doc.id}`, {
                credentials: 'include',
                headers: portalAccountHeaders(),
            });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                throw new Error(body?.message || 'No se pudo generar el documento.');
            }
            const blob = await res.blob();
            const filename = filenameOf(res.headers.get('content-disposition')) ?? `${doc.name}.pdf`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
            // Si la plantilla numera, el número quedó asignado (y quizá en un
            // campo de su registro): se refresca lo que ve.
            void qc.invalidateQueries({ queryKey: ['portal-me'] });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5" data-testid="portal-documents">
            <h2 className="imcrm-text-base imcrm-font-semibold imcrm-tracking-tight">Tus documentos</h2>
            <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                {documents.map((d) => (
                    <li key={d.id}>
                        <button
                            type="button"
                            onClick={() => void download(d)}
                            disabled={busy !== null}
                            data-portal-doc={d.id}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5 disabled:imcrm-opacity-60"
                        >
                            {busy === d.id ? (
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" />
                            ) : (
                                <FileText className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                            )}
                            <span>{d.name}</span>
                            <Download className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        </button>
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

/** El nombre del archivo de `Content-Disposition` (prefiere `filename*`). */
export function filenameOf(header: string | null): string | null {
    if (!header) return null;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (star?.[1]) {
        try {
            return decodeURIComponent(star[1]);
        } catch {
            /* cae al ascii */
        }
    }
    const plain = /filename="([^"]*)"/i.exec(header);
    return plain?.[1] || null;
}
