import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2, Table2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { usePublicList } from '@/hooks/usePublicList';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AppearancePanel } from './AppearancePanel';
import { DangerZonePanel, GeneralPanel } from './GeneralPanel';
import { FieldBuilder } from './FieldBuilder';
import { PermissionsPanel } from './PermissionsPanel';
import { PortalConfigPanel } from './PortalConfigPanel';
import { PublicVisibilityPanel } from './PublicVisibilityPanel';
import {
    LIST_SETTINGS_SECTIONS,
    listSettingsSection,
    resolveListSettingsSection,
    type ListSettingsSectionId,
} from './listSettingsSections';

/**
 * Configuración de una lista (v0.1.126).
 *
 * Antes esta página era UN scroll con seis tarjetas abiertas a la vez:
 * datos generales, campos, apariencia, portal, permisos y lista pública,
 * cada una con su propio botón de guardar y su propia jerga. Encontrar
 * algo era imposible y el botón de ELIMINAR la lista vivía arriba a la
 * derecha, junto a "Ver registros".
 *
 * Ahora hay una tira de pestañas (el mismo patrón que las vistas
 * guardadas de la página de registros) y se muestra UNA sección por vez,
 * con su título y una línea que explica en criollo qué se hace ahí. La
 * sección activa viaja en `?s=` para poder linkearla.
 */
export function ListBuilderPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const list = useList(listSlug);

    const active = resolveListSettingsSection(params.get('s'));
    const activeSection = listSettingsSection(active);

    const select = (id: ListSettingsSectionId): void => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('s', id);
                return next;
            },
            { replace: true },
        );
    };

    if (list.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando lista…')}
            </div>
        );
    }

    if (list.isError || !list.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button variant="ghost" size="sm" onClick={() => navigate('/lists')} className="imcrm-gap-2">
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    {__('Volver a listas')}
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">
                    {listSlug
                        ? sprintf(
                              /* translators: %s: list slug */
                              __('No se pudo cargar la lista "%s".'),
                              listSlug,
                          )
                        : __('No se pudo cargar la lista.')}
                </p>
            </div>
        );
    }

    const data = list.data;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-[0.3rem]">
            {/* Fila 1 — breadcrumb compacto, igual que la página de registros. */}
            <header className="imcrm-flex imcrm-min-h-7 imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <nav
                    aria-label={__('Ruta de navegación')}
                    className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-[13px]"
                >
                    <Link
                        to="/lists"
                        className="imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                    >
                        {__('Listas')}
                    </Link>
                    <span aria-hidden className="imcrm-shrink-0 imcrm-text-muted-foreground/60">
                        /
                    </span>
                    <Link
                        to={`/lists/${data.slug}/records`}
                        className="imcrm-truncate imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                    >
                        {data.name}
                    </Link>
                    <span aria-hidden className="imcrm-shrink-0 imcrm-text-muted-foreground/60">
                        /
                    </span>
                    <h1 className="imcrm-shrink-0 imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight">
                        {__('Configuración')}
                    </h1>
                </nav>

                <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="imcrm-h-7 imcrm-shrink-0 imcrm-gap-1 imcrm-px-2 imcrm-text-xs imcrm-text-muted-foreground"
                >
                    <Link to={`/lists/${data.slug}/records`}>
                        <Table2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Ver registros')}
                    </Link>
                </Button>
            </header>

            {/* Fila 2 — pestañas de sección. Sólo scrollea en horizontal
                (ver v0.1.124: `overflow-x-auto` a secas convierte el eje Y
                a `auto` y dibuja una barra vertical fantasma). */}
            <div
                role="tablist"
                aria-label={__('Secciones de configuración')}
                className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-border-b imcrm-border-border"
            >
                {LIST_SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const isActive = section.id === active;
                    return (
                        <button
                            key={section.id}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => select(section.id)}
                            className={cn(
                                'imcrm--mb-px imcrm-flex imcrm-h-8 imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-2.5 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors',
                                isActive
                                    ? 'imcrm-border-primary imcrm-text-foreground'
                                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground',
                            )}
                        >
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {section.label}
                            {section.id === 'campos' && <FieldsCountHint listId={data.id} />}
                            {section.id === 'compartir' && <SharedDotHint listId={data.id} />}
                        </button>
                    );
                })}
            </div>

            {/* Fila 3 — la sección activa. Ancho contenido: son formularios,
                no una tabla; a 1400px de ancho serían ilegibles. La excepción
                es "Campos" (v0.1.163), que es un administrador de TRES
                columnas y necesita el ancho de la pantalla. */}
            <div
                className={cn(
                    'imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-4 imcrm-pt-2',
                    active === 'campos' ? 'imcrm-max-w-none' : 'imcrm-max-w-4xl',
                )}
            >
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <h2 className="imcrm-text-base imcrm-font-semibold imcrm-tracking-tight">
                        {activeSection.title}
                    </h2>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {activeSection.description}
                    </p>
                </div>

                {active === 'campos' && (
                    <Card>
                        <CardContent className="imcrm-pt-5">
                            <FieldBuilder listId={data.id} />
                        </CardContent>
                    </Card>
                )}

                {active === 'general' && (
                    <>
                        <Card>
                            <CardContent className="imcrm-pt-5">
                                <GeneralPanel list={data} />
                            </CardContent>
                        </Card>
                        <DangerZonePanel list={data} />
                    </>
                )}

                {active === 'apariencia' && (
                    <Card>
                        <CardContent className="imcrm-pt-5">
                            <AppearancePanel list={data} />
                        </CardContent>
                    </Card>
                )}

                {active === 'permisos' && (
                    <Card>
                        <CardContent className="imcrm-pt-5">
                            <PermissionsPanel listId={data.id} />
                        </CardContent>
                    </Card>
                )}

                {active === 'compartir' && (
                    <>
                        <PortalConfigPanel list={data} />
                        <PublicVisibilityPanel listId={data.id} />
                    </>
                )}
            </div>
        </div>
    );
}

/** Cuántos campos tiene la lista, junto a la pestaña "Campos". */
function FieldsCountHint({ listId }: { listId: number }): JSX.Element | null {
    const fields = useFields(listId);
    const n = fields.data?.length ?? 0;
    if (n === 0) return null;
    return (
        <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">
            {n}
        </span>
    );
}

/**
 * Punto verde cuando la lista tiene página pública: responde "¿esto está
 * publicado?" sin tener que entrar a la sección.
 */
function SharedDotHint({ listId }: { listId: number }): JSX.Element | null {
    const publicList = usePublicList(listId);
    if (publicList.data?.enabled !== true) return null;
    return (
        <span
            aria-label={__('Compartida hacia afuera')}
            title={__('Esta lista tiene una página pública')}
            className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-success"
        />
    );
}
