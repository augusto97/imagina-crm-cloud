import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportTenantResult, TenantTransferFile } from '@imagina-base/shared';
import { ArrowRightLeft, Download, PackageOpen, Trash2, Upload } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlatformTenants } from '@/hooks/usePlatform';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTimeStr } from '@/lib/tenantFormat';

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtWhen(iso: string): string {
    return formatDateTimeStr(iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
}

/** Lo que trae el archivo, en una línea. */
function summary(file: TenantTransferFile): string {
    const m = file.manifest;
    if (!m) return 'No se pudo leer el contenido (¿archivo incompleto?)';
    const parts = [
        `${m.counts.lists ?? 0} listas`,
        `${m.counts.records ?? 0} registros`,
        `${m.counts.users ?? 0} personas`,
        `${m.files.count} archivos`,
    ];
    return parts.join(' · ');
}

/**
 * v0.1.197 — Migrar UNA empresa entre instancias (ADR-S23). Sólo superadmin.
 *
 * Exportar arma un archivo portable con TODO lo de esa empresa; importar lo
 * trae a este servidor regenerando los ids. Es lo que hace falta para partir
 * un servidor en dos, vender una empresa a otro operador o sacar a un cliente
 * de la nube compartida a la suya.
 */
export function PlatformTransfersCard(): JSX.Element {
    const qc = useQueryClient();
    const statusQ = useQuery({
        queryKey: ['tenant-transfers'],
        queryFn: () => api.transfersStatus(),
        retry: false,
    });
    const tenantsQ = usePlatformTenants({ limit: 200, includeArchived: true });
    const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: ['tenant-transfers'] });
        void qc.invalidateQueries({ queryKey: ['platform'] });
    };
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const onError = (e: unknown): void =>
        setNotice({
            kind: 'err',
            text: e instanceof CloudApiError ? e.message : 'No se pudo completar la operación.',
        });

    // Exportar
    const [tenantId, setTenantId] = useState('');
    const [includeRuns, setIncludeRuns] = useState(true);
    const [includeFiles, setIncludeFiles] = useState(true);
    const exportM = useMutation({
        mutationFn: () =>
            api.transferExport(Number(tenantId), {
                include_runs: includeRuns,
                include_files: includeFiles,
            }),
        onSuccess: (r) => {
            setNotice({ kind: 'ok', text: `Exportada: ${r.file} (${formatBytes(r.size)})` });
            invalidate();
        },
        onError,
    });

    // Importar
    const [target, setTarget] = useState<string | null>(null);
    const [slug, setSlug] = useState('');
    const [name, setName] = useState('');
    const [result, setResult] = useState<ImportTenantResult | null>(null);
    const importM = useMutation({
        mutationFn: (file: string) =>
            api.transferImport(file, {
                ...(slug.trim() ? { slug: slug.trim() } : {}),
                ...(name.trim() ? { name: name.trim() } : {}),
            }),
        onSuccess: (r) => {
            setResult(r);
            setTarget(null);
            setSlug('');
            setName('');
            setNotice({ kind: 'ok', text: `Importada como «${r.name}» (${r.slug}).` });
            invalidate();
        },
        onError,
    });

    const remove = useMutation({
        mutationFn: (file: string) => api.transferRemove(file),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Archivo eliminado.' });
            invalidate();
        },
        onError,
    });

    const fileInput = useRef<HTMLInputElement>(null);
    const upload = useMutation({
        mutationFn: (file: File) => api.transferUpload(file),
        onSuccess: (r) => {
            setNotice({ kind: 'ok', text: `Archivo subido: ${r.file}` });
            invalidate();
        },
        onError,
    });

    const s = statusQ.data;

    return (
        <div className="imcrm-space-y-4" data-testid="transfers-panel">
            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <ArrowRightLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>Migrar una empresa</CardTitle>
                            <CardDescription>
                                Exportá una empresa entera —datos, archivos y personas— a un archivo portable, e
                                importala en otra instalación. Los ids se regeneran al importar: la empresa de
                                origen queda intacta.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                    {s && !s.available && (
                        <div
                            className="imcrm-rounded-md imcrm-bg-amber-100 imcrm-p-2 imcrm-text-sm imcrm-text-amber-900"
                            data-testid="transfers-unavailable"
                        >
                            {s.reason}
                        </div>
                    )}
                    {notice && (
                        <div
                            data-testid="transfers-notice"
                            className={[
                                'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                                notice.kind === 'ok'
                                    ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                                    : 'imcrm-bg-rose-100 imcrm-text-rose-800',
                            ].join(' ')}
                        >
                            {notice.text}
                        </div>
                    )}

                    {/* Exportar */}
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                        <div className="imcrm-mb-2 imcrm-text-sm imcrm-font-medium">Exportar una empresa</div>
                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                            <div className="sm:imcrm-col-span-2">
                                <Label htmlFor="transfer-tenant">Empresa</Label>
                                <select
                                    id="transfer-tenant"
                                    data-testid="transfer-tenant"
                                    className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                    value={tenantId}
                                    onChange={(e) => setTenantId(e.target.value)}
                                >
                                    <option value="">Elegí una empresa…</option>
                                    {(tenantsQ.data?.data ?? []).map((t) => (
                                        <option key={t.id} value={String(t.id)}>
                                            {t.name} ({t.slug})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="imcrm-flex imcrm-items-end">
                                <Button
                                    size="sm"
                                    data-testid="transfer-export"
                                    disabled={!tenantId || exportM.isPending || s?.available === false}
                                    onClick={() => exportM.mutate()}
                                >
                                    <PackageOpen className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                    {exportM.isPending ? 'Exportando…' : 'Exportar'}
                                </Button>
                            </div>
                        </div>
                        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-gap-4 imcrm-text-sm">
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <input
                                    type="checkbox"
                                    checked={includeFiles}
                                    onChange={(e) => setIncludeFiles(e.target.checked)}
                                />
                                Incluir los archivos subidos
                            </label>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <input
                                    type="checkbox"
                                    checked={includeRuns}
                                    onChange={(e) => setIncludeRuns(e.target.checked)}
                                />
                                Incluir el historial de automatizaciones
                            </label>
                        </div>
                        <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                            No viajan: el dominio propio, el enlace público de cada lista, la URL de los webhooks
                            entrantes ni los tokens de acceso — son credenciales de este servidor y el destino emite
                            unas nuevas.
                        </p>
                    </div>

                    {/* Subir un archivo hecho en otro servidor */}
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                        <div className="imcrm-mb-2 imcrm-text-sm imcrm-font-medium">
                            Traer un archivo de otro servidor
                        </div>
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".tar"
                            className="imcrm-hidden"
                            data-testid="transfer-file-input"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) upload.mutate(f);
                                e.target.value = '';
                            }}
                        />
                        <Button
                            size="sm"
                            variant="outline"
                            data-testid="transfer-upload"
                            disabled={upload.isPending || s?.available === false}
                            onClick={() => fileInput.current?.click()}
                        >
                            <Upload className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                            {upload.isPending ? 'Subiendo…' : 'Subir archivo (.tar)'}
                        </Button>
                    </div>

                    {/* Resultado del último import */}
                    {result && (
                        <div
                            className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-sm"
                            data-testid="transfer-result"
                        >
                            <div className="imcrm-font-medium">
                                Importada: {result.name} ({result.slug})
                            </div>
                            <div className="imcrm-text-muted-foreground">
                                {result.users_created} cuenta(s) creada(s), {result.users_linked} vinculada(s) a
                                personas que ya estaban acá.
                            </div>
                            {result.warnings.length > 0 && (
                                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1 imcrm-pl-5 imcrm-text-amber-800">
                                    {result.warnings.map((w) => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Archivos disponibles */}
                    <div>
                        <div className="imcrm-mb-2 imcrm-text-sm imcrm-font-medium">
                            Archivos en este servidor ({s?.files.length ?? 0})
                        </div>
                        {(s?.files.length ?? 0) === 0 && (
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                Todavía no hay ninguno. Exportá una empresa o subí un archivo.
                            </p>
                        )}
                        <ul className="imcrm-space-y-2" data-testid="transfer-files">
                            {(s?.files ?? []).map((f) => (
                                <li
                                    key={f.name}
                                    className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3"
                                >
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-font-mono imcrm-text-xs">
                                            {f.name}
                                        </span>
                                        {f.manifest && (
                                            <Badge variant="secondary">v{f.manifest.app_version}</Badge>
                                        )}
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {formatBytes(f.size)} · {fmtWhen(f.created_at)}
                                        </span>
                                    </div>
                                    <div className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                        {f.manifest ? `${f.manifest.tenant.name} — ` : ''}
                                        {summary(f)}
                                    </div>
                                    <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                        <a href={api.transferDownloadUrl(f.name)} download>
                                            <Button size="sm" variant="outline">
                                                <Download className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                                Descargar
                                            </Button>
                                        </a>
                                        <Button
                                            size="sm"
                                            data-testid={`transfer-import-${f.name}`}
                                            disabled={!f.manifest}
                                            onClick={() => {
                                                setTarget(f.name);
                                                setSlug(f.manifest?.tenant.slug ?? '');
                                                setName(f.manifest?.tenant.name ?? '');
                                            }}
                                        >
                                            Importar acá
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => remove.mutate(f.name)}
                                            disabled={remove.isPending}
                                        >
                                            <Trash2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                            Eliminar
                                        </Button>
                                    </div>

                                    {target === f.name && (
                                        <div
                                            className="imcrm-mt-3 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3"
                                            data-testid="transfer-import-form"
                                        >
                                            <p className="imcrm-mb-2 imcrm-text-xs imcrm-text-muted-foreground">
                                                Se crea una empresa NUEVA en este servidor. Si el identificador ya
                                                está ocupado se usa el siguiente libre.
                                            </p>
                                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                                <div>
                                                    <Label htmlFor="transfer-name">Nombre</Label>
                                                    <Input
                                                        id="transfer-name"
                                                        data-testid="transfer-name"
                                                        value={name}
                                                        onChange={(e) => setName(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <Label htmlFor="transfer-slug">Identificador</Label>
                                                    <Input
                                                        id="transfer-slug"
                                                        data-testid="transfer-slug"
                                                        value={slug}
                                                        onChange={(e) => setSlug(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="imcrm-mt-2 imcrm-flex imcrm-gap-2">
                                                <Button
                                                    size="sm"
                                                    data-testid="transfer-import-confirm"
                                                    disabled={importM.isPending}
                                                    onClick={() => importM.mutate(f.name)}
                                                >
                                                    {importM.isPending ? 'Importando…' : 'Importar'}
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
                                                    Cancelar
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
