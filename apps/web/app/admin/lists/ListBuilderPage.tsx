import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { readMirrorListMarker } from '@imagina-base/shared';
import { ArrowLeft, Loader2, Table2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BackToIndex, SectionIndex } from '@/components/nav/SectionIndex';
import { useFields } from '@/hooks/useFields';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { useList } from '@/hooks/useLists';
import { usePublicList } from '@/hooks/usePublicList';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CAP, useCan } from '@/lib/permissions';

import { DocumentTemplatesPanel } from '../documents/DocumentTemplatesPanel';
import { BookingPanel } from '../booking/BookingPanel';
import { FormsPanel } from '../forms/FormsPanel';
import { ShopsPanel } from '../shop/ShopsPanel';
import { ApprovalFlowsPanel } from '../approvals/ApprovalFlowsPanel';
import { HelpdeskMailboxPanel } from '../helpdesk/HelpdeskMailboxPanel';
import { HelpdeskSettingsPanel } from '../helpdesk/HelpdeskSettingsPanel';
import { SlaPolicyPanel } from '../helpdesk/SlaPolicyPanel';
import { HowItWorksLink } from '../help/HowItWorksLink';
import { RecordTemplatesPanel } from '../records/templates/RecordTemplatesPanel';
import { AppearancePanel } from './AppearancePanel';
import { DuplicateTemplatePanel } from './DuplicateTemplatePanel';
import { DangerZonePanel, GeneralPanel } from './GeneralPanel';
import { FieldBuilder } from './FieldBuilder';
import { PermissionsPanel } from './PermissionsPanel';
import { PortalConfigPanel } from './PortalConfigPanel';
import { PublicVisibilityPanel } from './PublicVisibilityPanel';
import { PlanModuleGate } from '@/components/PlanModuleNotice';
import { SettingsNav, type SettingsNavItem } from '../builder/BuilderShell';
import { IconSquare } from './FolderBadge';
import {
    groupedListSettingsSections,
    listSettingsSection,
    resolveListSettingsSection,
    type ListSettingsSectionId,
} from './listSettingsSections';

/** Fase 7 — la guía de Ayuda que explica cada sección («¿Cómo funciona?»). */
const SECTION_GUIDES: Partial<Record<ListSettingsSectionId, string>> = {
    permisos: 'list-permissions',
    compartir: 'portal',
    formularios: 'forms',
    documentos: 'documents',
    agenda: 'booking',
    tienda: 'shop',
    aprobaciones: 'approvals',
    correo: 'helpdesk',
};

/**
 * Configuración de una lista (v0.1.126, menú nuevo en v0.1.406).
 *
 * Una sección por vez, con su título y una línea que explica en lenguaje
 * claro qué se hace ahí; la sección activa viaja en `?s=` para poder
 * linkearla.
 *
 * Con doce secciones la tira de pestañas de antes ya no entraba: se
 * deslizaba de costado y escondía la mitad. Ahora:
 *  - computador: un menú vertical por grupos a la izquierda (fijo al
 *    scrollear) y la sección a la derecha;
 *  - celular: un índice con las secciones agrupadas (como Ajustes) y, dentro
 *    de una sección, «‹ Configuración» para volver.
 */
export function ListBuilderPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const list = useList(listSlug);
    // El cajón del shell cambia a celular en el mismo corte.
    const desktop = useMediaQuery('(min-width: 1024px)');

    // C2 — Formularios y Documentos tienen su propia capacidad (rol propio).
    const canForms = useCan(CAP.MANAGE_FORMS);
    const canDocs = useCan(CAP.MANAGE_DOCUMENTS);
    // v0.1.412 — la tienda crea listas y publica datos hacia afuera.
    const canManageLists = useCan(CAP.MANAGE_LISTS);
    // D2 — una lista que mantiene una tienda no tiene mesa de ayuda (sus registros los crea la tienda).
    const storeManaged = readMirrorListMarker(list.data?.settings) !== null;
    const allowed = (id: string): boolean =>
        (id !== 'formularios' || canForms) &&
        (id !== 'documentos' || canDocs) &&
        ((id !== 'correo' && id !== 'sla' && id !== 'tienda') || !storeManaged) &&
        (id !== 'tienda' || canManageLists);
    const rawSection = params.get('s');
    const requested = resolveListSettingsSection(rawSection);
    const active = allowed(requested) ? requested : 'campos';
    const activeSection = listSettingsSection(active);
    /** En el celular, sin `?s=` se muestra el índice. */
    const showIndex = !desktop && (rawSection === null || rawSection === '');

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
    const groups = groupedListSettingsSections(allowed);
    const base = `/lists/${data.slug}/edit`;

    const breadcrumb = (
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
    );

    // ── Celular: el índice de secciones ────────────────────────────────
    if (showIndex) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {breadcrumb}
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <ListIconBadge list={data} />
                    <div className="imcrm-min-w-0">
                        <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{__('Configuración de la lista')}</h2>
                        <p className="imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">{data.name}</p>
                    </div>
                </div>
                <FieldsCountProvider listId={data.id}>
                    {(fieldsCount) => (
                        <SectionIndex
                            testId="list-settings-index"
                            groups={groups.map((g) => ({
                                label: g.label,
                                items: g.sections.map((section) => ({
                                    id: section.id,
                                    label: section.label,
                                    icon: section.icon,
                                    hint: section.short,
                                    to: `${base}?s=${section.id}`,
                                    count: section.id === 'campos' && fieldsCount > 0 ? String(fieldsCount) : null,
                                })),
                            }))}
                        />
                    )}
                </FieldsCountProvider>
            </div>
        );
    }

    const SectionIcon = activeSection.icon;
    const sectionHeader = (
        <div className="imcrm-flex imcrm-items-start imcrm-gap-3.5" data-testid="list-settings-header">
            <span
                className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-primary/10 imcrm-text-primary"
                aria-hidden
            >
                <SectionIcon className="imcrm-h-5 imcrm-w-5" />
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2.5 imcrm-gap-y-0.5">
                    <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{activeSection.title}</h2>
                    {SECTION_GUIDES[active] && <HowItWorksLink guideId={SECTION_GUIDES[active]} />}
                </div>
                <p className="imcrm-mt-0.5 imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {activeSection.description}
                </p>
            </div>
        </div>
    );

    const content = (
        <>
            {active === 'campos' && <FieldBuilder listId={data.id} />}

            {active === 'general' && (
                <>
                    <Card>
                        <CardContent className="imcrm-pt-5">
                            <GeneralPanel list={data} />
                        </CardContent>
                    </Card>
                    <DuplicateTemplatePanel list={data} />
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
                    {/* v0.1.338 (ADR-S87) — cada parte, si el plan la incluye. */}
                    <PlanModuleGate module="portal" compact>
                        <PortalConfigPanel list={data} />
                    </PlanModuleGate>
                    <PlanModuleGate module="public_sharing" compact>
                        <PublicVisibilityPanel listId={data.id} />
                    </PlanModuleGate>
                </>
            )}

            {active === 'documentos' && (
                <PlanModuleGate module="documents">
                    <DocumentTemplatesPanel listId={data.id} />
                </PlanModuleGate>
            )}
            {active === 'aprobaciones' && <ApprovalFlowsPanel listId={data.id} />}

            {active === 'formularios' && (
                <PlanModuleGate module="forms">
                    <FormsPanel listId={data.id} listName={data.name} listSettings={data.settings} />
                </PlanModuleGate>
            )}

            {active === 'agenda' && (
                <PlanModuleGate module="booking">
                    <BookingPanel listId={data.id} listName={data.name} listSettings={data.settings} />
                </PlanModuleGate>
            )}

            {active === 'tienda' && (
                <PlanModuleGate module="shop">
                    <ShopsPanel listId={data.id} listName={data.name} listSettings={data.settings} />
                </PlanModuleGate>
            )}

            {active === 'plantillas' && <RecordTemplatesPanel listId={data.id} />}

            {active === 'correo' && (
                <PlanModuleGate module="helpdesk">
                    <HelpdeskMailboxPanel listId={data.id} />
                    <HelpdeskSettingsPanel listId={data.id} />
                </PlanModuleGate>
            )}
            {active === 'sla' && (
                <PlanModuleGate module="helpdesk">
                    <SlaPolicyPanel listId={data.id} onGoToMail={() => select('correo')} />
                </PlanModuleGate>
            )}
        </>
    );

    // ── Celular: una sección, con «‹ Configuración» ───────────────────
    if (!desktop) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="list-settings-section" data-section={active}>
                <BackToIndex to={base} label={__('Configuración')} className="-imcrm-mb-1" />
                {sectionHeader}
                {content}
            </div>
        );
    }

    // ── Computador: menú por grupos + la sección ───────────────────────
    const navItems: SettingsNavItem<ListSettingsSectionId>[] = groups.flatMap((g) =>
        g.sections.map((section) => ({
            id: section.id,
            label: section.label,
            icon: section.icon,
            group: g.label,
            badge:
                section.id === 'campos' ? (
                    <FieldsCountHint listId={data.id} />
                ) : section.id === 'compartir' ? (
                    <SharedDotHint listId={data.id} />
                ) : undefined,
        })),
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {breadcrumb}
            <div className="imcrm-grid imcrm-grid-cols-[224px_minmax(0,1fr)] imcrm-items-start imcrm-gap-6 xl:imcrm-grid-cols-[240px_minmax(0,1fr)]">
                <aside className="imcrm-sticky imcrm-top-2 imcrm-flex imcrm-max-h-[calc(100dvh-6rem)] imcrm-flex-col imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-border-b imcrm-border-border imcrm-px-3.5 imcrm-py-3">
                        <ListIconBadge list={data} />
                        <div className="imcrm-min-w-0">
                            <p className="imcrm-truncate imcrm-text-[13px] imcrm-font-semibold">{data.name}</p>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Configuración de la lista')}</p>
                        </div>
                    </div>
                    <SettingsNav
                        items={navItems}
                        active={active}
                        onPick={select}
                        label={__('Secciones de configuración')}
                        testId="list-settings-nav"
                        tour="list-settings-nav"
                        dense
                    />
                </aside>

                {/* La sección. Ancho contenido: son formularios, no una tabla;
                    a 1400px de ancho serían ilegibles. La excepción es
                    "Campos" (v0.1.163), que es un administrador de campos con
                    su panel de ajustes al costado y necesita el ancho. */}
                <section
                    className={cn(
                        'imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-5 imcrm-pb-8',
                        active === 'campos' ? 'imcrm-max-w-none' : 'imcrm-max-w-4xl',
                    )}
                    data-testid="list-settings-section"
                    data-section={active}
                >
                    {sectionHeader}
                    {content}
                </section>
            </div>
        </div>
    );
}

/** El ícono de la lista (con su color), como en las tarjetas de Listas. */
function ListIconBadge({ list }: { list: { icon?: string | null; color?: string | null } }): JSX.Element {
    return <IconSquare icon={listIcon(list.icon) ?? DEFAULT_LIST_ICON} color={listColor(list.color)} size="lg" />;
}

/** Pasa la cantidad de campos a un hijo (el índice del celular). */
function FieldsCountProvider({ listId, children }: { listId: number; children: (n: number) => JSX.Element }): JSX.Element {
    const fields = useFields(listId);
    return children(fields.data?.length ?? 0);
}

/** Cuántos campos tiene la lista, junto a «Campos» en el menú. */
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
