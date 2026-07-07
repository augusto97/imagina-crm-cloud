import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BarChart3, Plus, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { useDashboards } from '@/hooks/useDashboards';
import { __, sprintf } from '@/lib/i18n';

import { DashboardCreateDialog } from './DashboardCreateDialog';

export function DashboardsIndexPage(): JSX.Element {
    const dashboards = useDashboards();
    const [createOpen, setCreateOpen] = useState(false);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-4">
                <div>
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                        {__('Dashboards')}
                    </h1>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Indicadores y gráficos sobre tus listas. Comparte un dashboard con tu equipo o créalo solo para ti.')}
                    </p>
                </div>
                <Button className="imcrm-gap-2" onClick={() => setCreateOpen(true)}>
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nuevo dashboard')}
                </Button>
            </header>

            {dashboards.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-h-4 imcrm-w-4 imcrm-mt-0.5" />
                    <span>{(dashboards.error as Error).message}</span>
                </div>
            )}

            {dashboards.isLoading ? (
                <SkeletonGrid />
            ) : dashboards.data && dashboards.data.length > 0 ? (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                    {dashboards.data.map((d) => (
                        <Link
                            key={d.id}
                            to={`/dashboards/${d.id}`}
                            className="imcrm-block imcrm-rounded-lg imcrm-transition-colors hover:imcrm-bg-accent/30"
                        >
                            <Card>
                                <CardHeader>
                                    <CardTitle className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                            <BarChart3 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                            {d.name}
                                        </span>
                                        {d.user_id === null && (
                                            <Badge variant="outline" className="imcrm-gap-1">
                                                <Users className="imcrm-h-3 imcrm-w-3" />
                                                {__('Compartido')}
                                            </Badge>
                                        )}
                                    </CardTitle>
                                    {d.description && <CardDescription>{d.description}</CardDescription>}
                                </CardHeader>
                                <CardContent className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-xs imcrm-text-muted-foreground">
                                    <span>
                                        {sprintf(
                                            /* translators: %d: number of widgets */
                                            __('%d widgets'),
                                            d.widgets.length,
                                        )}
                                    </span>
                                    <span>
                                        {sprintf(
                                            /* translators: %s: date */
                                            __('Editado %s'),
                                            new Date(d.updated_at + 'Z').toLocaleDateString(),
                                        )}
                                    </span>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            ) : (
                <DashboardsEmpty onCreate={() => setCreateOpen(true)} />
            )}

            <DashboardCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
        </div>
    );
}

function SkeletonGrid(): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="imcrm-h-32 imcrm-animate-pulse imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40"
                />
            ))}
        </div>
    );
}

function DashboardsEmpty({ onCreate }: { onCreate: () => void }): JSX.Element {
    return (
        <EmptyState
            icon={BarChart3}
            title={__('Aún no hay dashboards')}
            description={__('Crea un dashboard con KPIs y gráficos sobre cualquiera de tus listas.')}
            action={
                <Button onClick={onCreate} className="imcrm-gap-2">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Crear dashboard')}
                </Button>
            }
        />
    );
}
