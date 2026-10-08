import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StorageCandidate, TenantStorageStatus } from '@imagina-base/shared';
import { AlertTriangle, ArrowRightLeft, Check, HardDrive, Loader2, Server } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBytes } from '@/lib/formatBytes';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

type Mode = TenantStorageStatus['mode'];

export const STORAGE_STATUS_KEY = (tenantId: number | null): readonly unknown[] => ['tenant-storage', tenantId];

/**
 * Ajustes → Almacenamiento (v0.1.268, ADR-S36). Dónde se guardan los archivos
 * de la empresa (adjuntos, logos, PDF guardados): en el servidor de la
 * plataforma (cuenta para el límite del plan) o en su propio bucket
 * S3-compatible (sin límite del plan; se descarga directo de ahí).
 *
 * Cada archivo recuerda dónde quedó, así que cambiar de elección no rompe
 * nada: lo viejo sigue sirviéndose desde donde está hasta que se mueva.
 */
export function TenantStoragePanel(): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    // Siempre fresco al entrar: la conexión se crea en otra pantalla
    // (Integraciones) y un estado cacheado diría que no hay ninguna.
    const q = useQuery({
        queryKey: STORAGE_STATUS_KEY(tenantId),
        queryFn: () => api.tenantStorageGet(),
        retry: false,
        refetchOnMount: 'always',
    });
    const [view, setView] = useState<Mode | null>(null);

    useEffect(() => {
        if (q.data && view === null) setView(q.data.mode);
    }, [q.data, view]);

    if (q.isError) return null;
    if (!q.data || view === null) {
        return <div className="imcrm-h-40 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />;
    }
    const status = q.data;
    const externalFiles = (status.connection?.files ?? 0) + status.elsewhere.files;
    const externalBytes = (status.connection?.bytes ?? 0) + status.elsewhere.bytes;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="tenant-storage">
            <Card>
                <CardHeader>
                    <CardTitle>Dónde se guardan los archivos de tu empresa</CardTitle>
                    <CardDescription>
                        Adjuntos de los registros, logos, imágenes y los PDF que se guardan. Lo que se sube desde ahora va al lugar elegido;
                        lo que ya está guardado sigue donde está hasta que lo muevas.
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="tablist" aria-label="Dónde guardar">
                        <ModeTile
                            mode="platform"
                            active={status.mode}
                            view={view}
                            onSelect={setView}
                            icon={<Server className="imcrm-h-4 imcrm-w-4" />}
                            title="Servidor de la plataforma"
                            text="Listo sin configurar nada. Cuenta para el espacio de tu plan."
                        />
                        <ModeTile
                            mode="connection"
                            active={status.mode}
                            view={view}
                            onSelect={setView}
                            icon={<IntegrationLogo integrationKey="s3" size={16} />}
                            title="Tu propio almacenamiento"
                            text="Amazon S3, Backblaze, Cloudflare R2, Wasabi… Sin límite del plan."
                            recommended
                        />
                    </div>
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" data-testid="storage-usage">
                        <UsageTile
                            label="En el servidor"
                            files={status.platform.files}
                            bytes={status.platform.bytes}
                            limitMb={status.platform.limit_mb}
                        />
                        <UsageTile label="En tu almacenamiento" files={externalFiles} bytes={externalBytes} limitMb={null} external />
                    </div>
                </CardContent>
            </Card>

            {view === 'platform' && <PlatformSection status={status} externalFiles={externalFiles} />}
            {view === 'connection' && <ConnectionSection status={status} />}
        </div>
    );
}

function ModeTile({
    mode,
    active,
    view,
    onSelect,
    icon,
    title,
    text,
    recommended,
}: {
    mode: Mode;
    active: Mode;
    view: Mode;
    onSelect: (m: Mode) => void;
    icon: React.ReactNode;
    title: string;
    text: string;
    recommended?: boolean;
}): JSX.Element {
    const selected = view === mode;
    return (
        <button
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`storage-mode-${mode}`}
            data-active={active === mode || undefined}
            onClick={() => onSelect(mode)}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                selected
                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-2 imcrm-ring-primary/15'
                    : 'imcrm-border-border hover:imcrm-border-foreground/25 hover:imcrm-bg-muted/40',
            )}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-7 imcrm-min-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-px-1 imcrm-text-foreground/70 imcrm-ring-1 imcrm-ring-border">
                    {icon}
                </span>
                {active === mode ? (
                    <Badge variant="success" dot>
                        En uso
                    </Badge>
                ) : recommended ? (
                    <Badge variant="outline">Para mucho volumen</Badge>
                ) : null}
            </span>
            <span className="imcrm-text-sm imcrm-font-medium imcrm-leading-snug">{title}</span>
            <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{text}</span>
        </button>
    );
}

function UsageTile({
    label,
    files,
    bytes,
    limitMb,
    external,
}: {
    label: string;
    files: number;
    bytes: number;
    limitMb: number | null;
    external?: boolean;
}): JSX.Element {
    const limitBytes = limitMb === null ? null : limitMb * 1024 * 1024;
    const pct = limitBytes ? Math.min(100, Math.round((bytes / limitBytes) * 100)) : null;
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                {external ? <HardDrive className="imcrm-h-3.5 imcrm-w-3.5" /> : <Server className="imcrm-h-3.5 imcrm-w-3.5" />}
                {label}
            </div>
            <div className="imcrm-mt-1 imcrm-text-sm">
                <span className="imcrm-font-semibold">{formatBytes(bytes)}</span>
                {limitBytes !== null && <span className="imcrm-text-muted-foreground"> de {formatBytes(limitBytes)}</span>}
                <span className="imcrm-text-muted-foreground">
                    {' '}
                    · {formatNumber(files)} {files === 1 ? 'archivo' : 'archivos'}
                </span>
            </div>
            {pct !== null && (
                <div className="imcrm-mt-2 imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                    <div
                        className={cn('imcrm-h-full imcrm-rounded-full', pct >= 90 ? 'imcrm-bg-destructive' : 'imcrm-bg-primary')}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
            {external && (
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">Sin límite del plan: lo cobra tu proveedor.</p>
            )}
        </div>
    );
}

function useStorageRefresh(): (data?: TenantStorageStatus) => void {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    return (data) => {
        if (data) qc.setQueryData(STORAGE_STATUS_KEY(tenantId), data);
        else void qc.invalidateQueries({ queryKey: STORAGE_STATUS_KEY(tenantId) });
        void qc.invalidateQueries({ queryKey: ['billing'] });
    };
}

// ── Mudanza por tandas ───────────────────────────────────────────────────

interface MoveState {
    running: boolean;
    moved: number;
    total: number;
    failed: Array<{ id: number; name: string; error: string }>;
    done: boolean;
}

/**
 * Mueve los archivos tanda por tanda (20 por pedido) hasta que no quede nada
 * o una tanda no avance (los que fallan se quedan donde estaban y se listan).
 */
function MoveFiles({
    to,
    pending,
    label,
    description,
}: {
    to: 'connection' | 'platform';
    pending: number;
    label: string;
    description: string;
}): JSX.Element | null {
    const refresh = useStorageRefresh();
    const confirm = useConfirm();
    const [state, setState] = useState<MoveState | null>(null);

    if (pending === 0 && !state) return null;

    const run = async (): Promise<void> => {
        const ok = await confirm({
            title: label,
            description,
            confirmLabel: 'Mover los archivos',
        });
        if (!ok) return;
        let moved = 0;
        let failed: MoveState['failed'] = [];
        setState({
            running: true,
            moved: 0,
            total: pending,
            failed: [],
            done: false,
        });
        try {
            for (;;) {
                const r = await api.tenantStorageMove(to);
                moved += r.moved;
                failed = r.failed;
                setState({
                    running: true,
                    moved,
                    total: moved + r.remaining,
                    failed,
                    done: false,
                });
                if (r.remaining === 0 || r.moved === 0) break;
            }
        } catch (e) {
            failed = [
                {
                    id: 0,
                    name: '',
                    error: e instanceof Error ? e.message : 'No se pudieron mover los archivos.',
                },
            ];
        }
        // Al terminar, el total es lo que se intentó: lo movido + lo que falló.
        setState({
            running: false,
            moved,
            total: moved + failed.length,
            failed,
            done: true,
        });
        refresh();
    };

    return (
        <div className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid={`storage-move-${to}`}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-text-sm imcrm-font-medium">{label}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{description}</p>
                </div>
                {(pending > 0 || state?.running) && (
                    <Button size="sm" variant="outline" disabled={state?.running} onClick={() => void run()} data-testid="storage-move-run">
                        {state?.running ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <ArrowRightLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {state?.running ? 'Moviendo…' : `Mover ${formatNumber(pending)} ${pending === 1 ? 'archivo' : 'archivos'}`}
                    </Button>
                )}
            </div>
            {state && (
                <div className="imcrm-space-y-1.5">
                    <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <div
                            className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all"
                            style={{
                                width: `${state.total ? Math.round((state.moved / state.total) * 100) : 100}%`,
                            }}
                        />
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="storage-move-progress">
                        {state.done
                            ? state.moved === 1
                                ? 'Listo: se movió 1 archivo.'
                                : `Listo: se movieron ${formatNumber(state.moved)} archivos.`
                            : `${formatNumber(state.moved)} de ${formatNumber(state.total)}…`}
                    </p>
                    {state.failed.length > 0 && (
                        <div
                            className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive"
                            data-testid="storage-move-failed"
                        >
                            <p className="imcrm-font-medium">
                                No se pudieron mover {state.failed.length === 1 ? 'este archivo' : 'estos archivos'} (quedaron donde
                                estaban):
                            </p>
                            <ul className="imcrm-mt-1 imcrm-list-disc imcrm-pl-4">
                                {state.failed.slice(0, 5).map((f, i) => (
                                    <li key={`${f.id}-${i}`}>
                                        {f.name ? `${f.name}: ` : ''}
                                        {f.error}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Servidor de la plataforma ────────────────────────────────────────────

function PlatformSection({ status, externalFiles }: { status: TenantStorageStatus; externalFiles: number }): JSX.Element {
    const refresh = useStorageRefresh();
    const confirm = useConfirm();
    const [error, setError] = useState<string | null>(null);
    const clear = useMutation({
        mutationFn: () => api.tenantStorageClear(),
        onSuccess: (d) => refresh(d),
        onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo cambiar.'),
    });

    return (
        <Card data-testid="storage-section-platform">
            <CardContent className="imcrm-space-y-3 imcrm-pt-5">
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    Los archivos quedan en el servidor de la plataforma. No hay que configurar nada, pero ocupan el{' '}
                    <span className="imcrm-font-medium imcrm-text-foreground">espacio de tu plan</span>
                    {status.platform.limit_mb !== null ? ` (${formatNumber(status.platform.limit_mb)} MB)` : ''}. Un PDF guardado pesa entre
                    30 y 150 KB; si no hace falta guardarlo, «Copiar enlace» no ocupa nada.
                </p>
                {status.mode !== 'platform' && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={clear.isPending}
                            onClick={async () => {
                                setError(null);
                                const ok = await confirm({
                                    title: '¿Volver a guardar en el servidor?',
                                    description:
                                        'Lo que se suba desde ahora va al servidor y cuenta para el plan. Lo que ya está en tu almacenamiento sigue ahí (y se sigue viendo) hasta que lo traigas.',
                                    confirmLabel: 'Guardar en el servidor',
                                });
                                if (ok) clear.mutate();
                            }}
                            data-testid="storage-use-platform"
                        >
                            Guardar en el servidor de la plataforma
                        </Button>
                        {error && <span className="imcrm-text-sm imcrm-text-destructive">{error}</span>}
                    </div>
                )}
                {status.mode === 'platform' && (
                    <MoveFiles
                        to="platform"
                        pending={externalFiles}
                        label="Traer los archivos que quedaron en tu almacenamiento"
                        description="Se copian al servidor y se borran del bucket. Sólo entran mientras haya espacio en tu plan; es lo que hay que hacer antes de desconectar el almacenamiento."
                    />
                )}
            </CardContent>
        </Card>
    );
}

// ── Almacenamiento propio ────────────────────────────────────────────────

function ConnectionSection({ status }: { status: TenantStorageStatus }): JSX.Element {
    const refresh = useStorageRefresh();
    const confirm = useConfirm();
    const current = status.mode === 'connection' ? status.connection : null;
    const [changing, setChanging] = useState(false);
    const usable = status.candidates.filter((c) => c.problem === null);
    const [picked, setPicked] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (picked === null && usable.length > 0) {
            setPicked((usable.find((c) => c.id !== current?.id) ?? usable[0]!).id);
        }
    }, [usable, picked, current?.id]);

    const set = useMutation({
        mutationFn: (id: number) => api.tenantStorageSet(id),
        onSuccess: (d) => {
            refresh(d);
            setChanging(false);
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo elegir.'),
    });

    const showPicker = current === null || changing;
    const toMove = status.platform.files + status.elsewhere.files;

    return (
        <Card data-testid="storage-section-connection">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <HardDrive className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    Tu propio almacenamiento
                </CardTitle>
                <CardDescription>
                    Un bucket compatible con S3 de tu empresa (Amazon S3, Backblaze B2, Cloudflare R2, Wasabi, DigitalOcean Spaces…). Los
                    archivos no ocupan el espacio del plan y se descargan directo desde tu bucket con enlaces temporales: no hace falta que
                    sea público.
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                {current && !changing && (
                    <div className="imcrm-space-y-3" data-testid="storage-current">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                            <IntegrationLogo integrationKey="s3" size={32} />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{current.name}</p>
                                <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                    {current.detail ?? '—'} · {formatNumber(current.files)} {current.files === 1 ? 'archivo' : 'archivos'} ·{' '}
                                    {formatBytes(current.bytes)}
                                </p>
                            </div>
                            <Badge variant="success" dot>
                                En uso
                            </Badge>
                        </div>
                        {current.problem && (
                            <p
                                className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive"
                                data-testid="storage-problem"
                            >
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                                {current.problem}
                            </p>
                        )}
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            {usable.length > 1 && (
                                <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
                                    Cambiar de almacenamiento
                                </Button>
                            )}
                        </div>
                        <MoveFiles
                            to="connection"
                            pending={toMove}
                            label="Mover acá los archivos que ya tenés"
                            description="Se copian a tu bucket y se borran del servidor (o del almacenamiento anterior): liberás el espacio del plan. Los enlaces que ya compartiste siguen funcionando."
                        />
                    </div>
                )}

                {showPicker && (
                    <div className="imcrm-space-y-3" data-testid="storage-picker">
                        {status.candidates.length === 0 ? (
                            <NoConnections />
                        ) : (
                            <>
                                <p className="imcrm-text-sm imcrm-font-medium">Elegí dónde guardar los archivos</p>
                                <div className="imcrm-space-y-2" role="radiogroup">
                                    {status.candidates.map((c) => (
                                        <CandidateRow
                                            key={c.id}
                                            c={c}
                                            selected={picked === c.id}
                                            onSelect={() => setPicked(c.id)}
                                            current={c.id === current?.id}
                                        />
                                    ))}
                                </div>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                    <Button
                                        size="sm"
                                        disabled={picked === null || set.isPending || !usable.some((c) => c.id === picked)}
                                        onClick={async () => {
                                            setError(null);
                                            if (picked === null) return;
                                            const ok = await confirm({
                                                title: '¿Guardar los archivos en este almacenamiento?',
                                                description:
                                                    'Lo que se suba desde ahora va a tu bucket. Lo que ya está guardado sigue donde está; después podés moverlo con un botón.',
                                                confirmLabel: 'Usar este almacenamiento',
                                            });
                                            if (ok) set.mutate(picked);
                                        }}
                                        data-testid="storage-use-connection"
                                    >
                                        {set.isPending ? (
                                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                        ) : (
                                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                        )}
                                        Usar este almacenamiento
                                    </Button>
                                    {changing && (
                                        <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
                                            Cancelar
                                        </Button>
                                    )}
                                    <Button size="sm" variant="ghost" asChild>
                                        <Link to="/settings?s=conectores">Conectar otro</Link>
                                    </Button>
                                    {error && <span className="imcrm-text-sm imcrm-text-destructive">{error}</span>}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function CandidateRow({
    c,
    selected,
    onSelect,
    current,
}: {
    c: StorageCandidate;
    selected: boolean;
    onSelect: () => void;
    current: boolean;
}): JSX.Element {
    const disabled = c.problem !== null;
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={onSelect}
            data-storage-candidate={c.id}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left',
                selected && !disabled ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border',
                disabled ? 'imcrm-cursor-not-allowed imcrm-opacity-70' : 'hover:imcrm-bg-muted/40',
            )}
        >
            <IntegrationLogo integrationKey={c.integration} size={28} />
            <span className="imcrm-min-w-0 imcrm-flex-1">
                <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{c.name}</span>
                <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                    {c.problem ?? `${c.detail ?? ''}${c.files ? ` · ${formatNumber(c.files)} archivos` : ''}`}
                </span>
            </span>
            {current && <Badge variant="outline">Actual</Badge>}
        </button>
    );
}

function NoConnections(): JSX.Element {
    return (
        <div
            className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm"
            data-testid="storage-empty"
        >
            <p>
                Todavía no hay un almacenamiento conectado. Conectalo una vez en Integraciones (como conexión del{' '}
                <span className="imcrm-font-medium">equipo</span>) y volvé acá para elegirlo. Al conectarlo probamos subir, leer y borrar un
                archivo chiquito.
            </p>
            <Button size="sm" variant="outline" asChild>
                <Link to="/settings?s=conectores">
                    <IntegrationLogo integrationKey="s3" size={16} className="imcrm-mr-1.5" />
                    Conectar un almacenamiento S3
                </Link>
            </Button>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                Backblaze B2 y Cloudflare R2 son los más económicos para esto; R2 no cobra la descarga.
            </p>
        </div>
    );
}
