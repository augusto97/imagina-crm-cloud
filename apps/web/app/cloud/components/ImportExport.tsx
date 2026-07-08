import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Field, ImportResult } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';

/** Botones de export (descarga JSON) e import (pega CSV) para una lista. */
export function ImportExport({
    listSlug,
    listName,
    fields,
}: {
    listSlug: string;
    listName: string;
    fields: Field[];
}): JSX.Element {
    const [importing, setImporting] = useState(false);

    async function exportJson(): Promise<void> {
        const bundle = await api.exportList(listSlug);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${listSlug}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <>
            <Button variant="ghost" size="sm" onClick={exportJson}>
                Exportar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setImporting(true)}>
                Importar CSV
            </Button>
            {importing && (
                <ImportModal
                    listSlug={listSlug}
                    listName={listName}
                    fields={fields}
                    onClose={() => setImporting(false)}
                />
            )}
        </>
    );
}

function ImportModal({
    listSlug,
    listName,
    fields,
    onClose,
}: {
    listSlug: string;
    listName: string;
    fields: Field[];
    onClose: () => void;
}): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const [csv, setCsv] = useState('');
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = useMutation({
        mutationFn: () => {
            const { headers, rows } = parseCsv(csv);
            const mapping: Record<string, number> = {};
            for (const h of headers) {
                const field = fields.find(
                    (f) => f.label.toLowerCase() === h.toLowerCase() || f.slug === h.toLowerCase(),
                );
                if (field) mapping[h] = field.id;
            }
            if (Object.keys(mapping).length === 0) {
                throw new CloudApiError('Ninguna columna coincide con un campo', 400, 'no_mapping');
            }
            return api.importRows(listSlug, { mapping, rows });
        },
        onSuccess: (res) => {
            setResult(res);
            setError(null);
            void qc.invalidateQueries({ queryKey: ['records', tenantId] });
        },
        onError: (e) => setError(e instanceof CloudApiError ? e.message : 'Error'),
    });

    return (
        <div className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-bg-black/40 imcrm-p-4">
            <div className="imcrm-w-full imcrm-max-w-lg imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-xl">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <h2 className="imcrm-text-sm imcrm-font-semibold">Importar CSV a “{listName}”</h2>
                    <button onClick={onClose} aria-label="Cerrar" className="imcrm-text-muted-foreground">
                        ✕
                    </button>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    Primera fila = encabezados. Las columnas se mapean por nombre de campo.
                </p>
                <textarea
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    placeholder={'Nombre,Monto\nACME,1000\nGlobex,500'}
                    className="imcrm-h-40 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-2 imcrm-font-mono imcrm-text-sm"
                />
                {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                {result && (
                    <div className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2 imcrm-text-sm">
                        Importados: <b>{result.imported}</b> · Omitidos: {result.skipped}
                        {result.errors.length > 0 && (
                            <ul className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">
                                {result.errors.slice(0, 5).map((e, i) => (
                                    <li key={i}>
                                        fila {e.row}: {e.field} — {e.message}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
                <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Cerrar
                    </Button>
                    <Button size="sm" onClick={() => run.mutate()} disabled={!csv.trim() || run.isPending}>
                        Importar
                    </Button>
                </div>
            </div>
        </div>
    );
}

/** Parser CSV mínimo: soporta comillas dobles y comas dentro de comillas. */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };
    const parseLine = (line: string): string[] => {
        const out: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    cur += ch;
                }
            } else if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                out.push(cur);
                cur = '';
            } else {
                cur += ch;
            }
        }
        out.push(cur);
        return out.map((s) => s.trim());
    };
    const headers = parseLine(lines[0]!);
    const rows = lines.slice(1).map((line) => {
        const cells = parseLine(line);
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
            row[h] = cells[i] ?? '';
        });
        return row;
    });
    return { headers, rows };
}
