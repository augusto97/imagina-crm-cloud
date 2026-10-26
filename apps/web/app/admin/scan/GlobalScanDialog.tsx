import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { CodeSearchHit, CodeSearchResult } from '@imagina-base/shared';
import { Loader2, ScanLine, Search } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { CodeScanner } from '@/components/scan/CodeScanner';
import { ScanDialog } from '@/components/scan/ScanDialog';
import { Button } from '@/components/ui/button';
import { __, sprintf } from '@/lib/i18n';
import { pushRecent } from '@/lib/recents';
import { parseRecordLinkCode, searchCode } from '@/lib/scan/codeSearch';

import { ScanHitList } from './ScanHitList';

type Phase =
    | { kind: 'scan' }
    | { kind: 'searching'; code: string }
    | { kind: 'result'; result: CodeSearchResult }
    | { kind: 'error'; code: string; message: string };

/**
 * H3 — «Escanear» de la búsqueda global: el código se busca en los campos de
 * texto, número e ID automático de TODAS las listas que la persona ve (el
 * servidor aplica el ACL de cada una). Uno → abre la ficha; varios → la
 * lista; ninguno → buscarlo como texto o escanear otro. Un QR con el enlace
 * de un registro de esta app lo abre directo.
 */
export default function GlobalScanDialog({
    open,
    onOpenChange,
    onSearchAsText,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSearchAsText: (code: string) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const tenantId = useSession((s) => s.activeTenantId);
    const [phase, setPhase] = useState<Phase>({ kind: 'scan' });
    const [round, setRound] = useState(0);

    const close = (): void => onOpenChange(false);
    const openHit = (hit: CodeSearchHit): void => {
        const href = `/lists/${hit.list_slug}/records?record=${hit.record_id}`;
        pushRecent(tenantId, {
            kind: 'record',
            id: hit.record_id,
            label: hit.title || sprintf(__('Registro #%d'), hit.record_id),
            context: hit.list_name,
            href,
            icon: hit.list_icon,
            color: hit.list_color,
        });
        close();
        navigate(href);
    };

    const onCode = async (code: string): Promise<void> => {
        const link = parseRecordLinkCode(code, window.location.origin);
        if (link) {
            close();
            navigate(`/lists/${link.listSlug}/records?record=${link.recordId}`);
            return;
        }
        setPhase({ kind: 'searching', code });
        try {
            const result = await searchCode(code);
            if (result.hits.length === 1) {
                openHit(result.hits[0]!);
                return;
            }
            setPhase({ kind: 'result', result });
        } catch (err) {
            setPhase({ kind: 'error', code, message: err instanceof Error ? err.message : String(err) });
        }
    };

    const again = (): void => {
        setPhase({ kind: 'scan' });
        setRound((r) => r + 1);
    };

    return (
        <ScanDialog
            open={open}
            onOpenChange={(o) => {
                if (!o) again();
                onOpenChange(o);
            }}
            title={__('Escanear un código')}
            description={__('Busca el código en los campos de texto y número de todas tus listas.')}
            testId="global-scan-dialog"
        >
            {phase.kind === 'scan' ? (
                <CodeScanner key={round} onCode={(c) => void onCode(c)} />
            ) : phase.kind === 'searching' ? (
                <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {sprintf(__('Buscando «%s»…'), phase.code)}
                </p>
            ) : phase.kind === 'error' ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="scan-error">
                    <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{phase.message}</p>
                    <Button type="button" variant="outline" size="sm" className="imcrm-self-start" onClick={again}>
                        <ScanLine className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Escanear otro')}
                    </Button>
                </div>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="scan-result">
                    <p className="imcrm-text-sm">
                        {phase.result.hits.length === 0
                            ? sprintf(__('No encontramos ningún registro con el código «%s».'), phase.result.code)
                            : sprintf(__('El código «%s» aparece en %d registros:'), phase.result.code, phase.result.hits.length)}
                    </p>
                    {phase.result.hits.length > 0 && <ScanHitList hits={phase.result.hits} showList onPick={openHit} />}
                    {phase.result.truncated && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Hay más coincidencias: se muestran las más recientes.')}</p>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button type="button" size="sm" onClick={again} data-testid="scan-again">
                            <ScanLine className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Escanear otro')}
                        </Button>
                        {phase.result.hits.length === 0 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const code = phase.result.code;
                                    again();
                                    onSearchAsText(code);
                                }}
                            >
                                <Search className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Buscarlo como texto')}
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </ScanDialog>
    );
}
