import { useState } from 'react';
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    Key,
    Loader2,
    RefreshCw,
    XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    useActivateLicense,
    useDeactivateLicense,
    useLicense,
    useRefreshLicense,
} from '@/hooks/useLicense';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import type { LicenseState, LicenseStatus } from '@/types/license';

/**
 * Tarjeta de gestión de licencia. Vive en la página de Ajustes.
 *
 * - Si la licencia está inactiva: input de clave + botón Activar.
 * - Si está activa: muestra estado, vencimiento, uso de activaciones,
 *   con acciones Refrescar y Desactivar.
 * - Estados: valid (verde), grace (warning), invalid/expired/site_limit
 *   (destructive).
 *
 * Los datos del usuario nunca se bloquean por estado de licencia
 * (ADR-007). El gate es solo para updates del plugin.
 */
export function LicenseCard(): JSX.Element {
    const license = useLicense();
    const activate = useActivateLicense();
    const deactivate = useDeactivateLicense();
    const refresh = useRefreshLicense();
    const [keyInput, setKeyInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleActivate = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            await activate.mutateAsync(keyInput.trim());
            setKeyInput('');
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const handleDeactivate = async (): Promise<void> => {
        if (!confirm(__('¿Desactivar la licencia? Tus datos NO se afectan; solo dejarás de recibir actualizaciones.'))) {
            return;
        }
        setError(null);
        try {
            await deactivate.mutateAsync();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    if (license.isLoading) {
        return (
            <Card>
                <CardContent className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando licencia…')}
                </CardContent>
            </Card>
        );
    }

    const state = license.data;
    const isInactive = !state || state.status === 'inactive';

    return (
        <Card>
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Key className="imcrm-h-4 imcrm-w-4" />
                    {__('Licencia')}
                </CardTitle>
                <CardDescription>
                    {__('Activa tu licencia para recibir actualizaciones y soporte oficial. Los datos del plugin siempre están disponibles, incluso sin licencia.')}
                </CardDescription>
            </CardHeader>

            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {isInactive ? (
                    <form onSubmit={handleActivate} className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="license-key">{__('Clave de licencia')}</Label>
                            <Input
                                id="license-key"
                                value={keyInput}
                                onChange={(e) => setKeyInput(e.target.value)}
                                placeholder={__('Pega tu clave aquí')}
                                spellCheck={false}
                                autoComplete="off"
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={keyInput.trim() === '' || activate.isPending}
                            className="imcrm-self-start imcrm-gap-2"
                        >
                            {activate.isPending ? (
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            ) : (
                                <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />
                            )}
                            {activate.isPending ? __('Activando…') : __('Activar licencia')}
                        </Button>
                    </form>
                ) : (
                    <ActiveLicenseDetails state={state} />
                )}

                {error !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {error}
                    </div>
                )}

                {!isInactive && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-end imcrm-gap-2 imcrm-pt-2">
                        <Button
                            variant="outline"
                            onClick={() => void refresh.mutateAsync()}
                            disabled={refresh.isPending}
                            className="imcrm-gap-2"
                        >
                            <RefreshCw
                                className={
                                    refresh.isPending
                                        ? 'imcrm-h-4 imcrm-w-4 imcrm-animate-spin'
                                        : 'imcrm-h-4 imcrm-w-4'
                                }
                            />
                            {__('Refrescar')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={handleDeactivate}
                            disabled={deactivate.isPending}
                            className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                        >
                            <XCircle className="imcrm-h-4 imcrm-w-4" />
                            {deactivate.isPending ? __('Desactivando…') : __('Desactivar')}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

interface DetailsProps {
    state: LicenseState;
}

function ActiveLicenseDetails({ state }: DetailsProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <StatusBadge state={state} />
                {state.in_grace && (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-warning">
                        <Clock className="imcrm-h-3 imcrm-w-3" />
                        {state.grace_until
                            ? sprintf(
                                  /* translators: %s: localized date until grace period ends */
                                  __('En período de gracia hasta %s'),
                                  new Date(state.grace_until + 'Z').toLocaleString(),
                              )
                            : __('En período de gracia')}
                    </span>
                )}
            </div>

            <dl className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <Item label={__('Clave')} value={<code className="imcrm-font-mono imcrm-text-xs">{state.key || '—'}</code>} />
                <Item
                    label={__('Vence')}
                    value={
                        state.expires_at
                            ? new Date(state.expires_at + 'Z').toLocaleDateString()
                            : __('Sin vencimiento')
                    }
                />
                <Item
                    label={__('Activaciones')}
                    value={
                        state.site_limit !== null
                            ? sprintf(
                                  /* translators: 1: used activations, 2: total allowed */
                                  __('%1$d de %2$d'),
                                  state.activations_count ?? 0,
                                  state.site_limit,
                              )
                            : '—'
                    }
                />
                <Item
                    label={__('Última verificación')}
                    value={
                        state.last_check_at
                            ? new Date(state.last_check_at + 'Z').toLocaleString()
                            : '—'
                    }
                />
            </dl>

            {state.message && state.status !== 'valid' && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-xs imcrm-text-warning-foreground">
                    <AlertCircle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5" />
                    <span>{state.message}</span>
                </div>
            )}
        </div>
    );
}

function StatusBadge({ state }: DetailsProps): JSX.Element {
    const map: Record<LicenseStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
        inactive: { label: __('Inactiva'), variant: 'secondary' },
        valid: { label: __('Activa'), variant: 'success' },
        expired: { label: __('Expirada'), variant: 'destructive' },
        invalid: { label: __('Inválida'), variant: 'destructive' },
        site_limit_reached: { label: __('Límite alcanzado'), variant: 'destructive' },
    };
    const meta = map[state.status];

    if (state.in_grace && state.status !== 'valid') {
        return <Badge variant="warning">{__('En gracia')}</Badge>;
    }
    return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function Item({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
            <dt className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {label}
            </dt>
            <dd className="imcrm-text-sm">{value}</dd>
        </div>
    );
}
