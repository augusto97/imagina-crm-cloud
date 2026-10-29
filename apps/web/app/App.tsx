import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Loader2 } from 'lucide-react';

import { AdminShell } from '@/admin/layout/AdminShell';
// Records views se cargan eagerly — son la pantalla home del SPA
// y casi cualquier flujo aterriza ahí. Lazy-load las pantallas
// secundarias (dashboards, automations, builder, settings) para que
// el first-paint no descargue su código si el user nunca las visita.
import { ListsIndexPage } from '@/admin/lists/ListsIndexPage';
import { RecordsPage } from '@/admin/records/RecordsPage';
import { PlatformGate } from '@/admin/platform/PlatformGate';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { useTimeZoneAutoSetup } from '@/cloud/useTimeZoneAutoSetup';
import { useRealtime } from '@/cloud/useRealtime';
import { useIsGuest } from '@/lib/guest';
import { disableTeamsApi } from '@/hooks/useTeams';
import { usePwaBridge } from '@/cloud/usePwaBridge';

// Lazy-loaded pages. React.lazy + Vite produce un chunk por cada
// import — esos chunks viven en `dist/assets/*-<hash>.js` y se
// descargan solo cuando el user navega a la ruta. Con esto el bundle
// inicial baja ~40% en sites donde el usuario solo usa records.
//
// Usamos `lazyWithReload` en lugar de `React.lazy`: si el chunk falla
// porque el plugin se actualizó y los content-hashes cambiaron (deploy
// stale), recarga la página automáticamente. Previene la pantalla en
// blanco que pasaba con `Failed to fetch dynamically imported module`.
// v0.1.256 — también la página del registro (trae el motor de la ficha
// diseñada y sus gráficos), carpetas, favoritos y ajustes: el tronco que se
// baja al entrar es el shell + el índice de listas + la tabla de registros.
const RecordPage = lazyWithReload(() => import('@/admin/records/RecordPage').then(m => ({ default: m.RecordPage })));
const FolderPage = lazyWithReload(() => import('@/admin/lists/FolderPage').then(m => ({ default: m.FolderPage })));
const MyWorkPage = lazyWithReload(() => import('@/admin/mywork/MyWorkPage').then(m => ({ default: m.MyWorkPage })));
// C5 — la pantalla a la que llevan los botones Aprobar / Rechazar del correo.
const ApprovalConfirmPage = lazyWithReload(() => import('@/admin/approvals/ApprovalConfirmPage').then(m => ({ default: m.ApprovalConfirmPage })));
// E6 — agentes de IA (índice con plantillas y el editor con sus pestañas).
const AgentsPage = lazyWithReload(() => import('@/admin/agents/AgentsPage').then(m => ({ default: m.AgentsPage })));
const AgentEditorPage = lazyWithReload(() => import('@/admin/agents/AgentEditorPage').then(m => ({ default: m.AgentEditorPage })));
// Fase 7 — historial de novedades.
// v0.1.322 — centro de aprendizaje (manual con animaciones y capturas reales).
const LearnCenter = lazyWithReload(() => import('@/admin/learn/LearnCenter').then(m => ({ default: m.LearnCenter })));
const LearnLab = lazyWithReload(() => import('@/admin/learn/LearnLab').then(m => ({ default: m.LearnLab })));
const IdeasPage = lazyWithReload(() => import('@/admin/ideas/IdeasPage').then(m => ({ default: m.IdeasPage })));
const WhatsNewPage = lazyWithReload(() => import('@/admin/whats-new/WhatsNewPage').then(m => ({ default: m.WhatsNewPage })));
const FavoritesPage = lazyWithReload(() => import('@/admin/favorites/FavoritesPage').then(m => ({ default: m.FavoritesPage })));
const CloudSettingsPage = lazyWithReload(() => import('@/cloud/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ListBuilderPage = lazyWithReload(() => import('@/admin/lists/ListBuilderPage').then(m => ({ default: m.ListBuilderPage })));
const RecordLayoutEditorPage = lazyWithReload(() => import('@/admin/records/layout/editor/RecordLayoutEditorPage').then(m => ({ default: m.RecordLayoutEditorPage })));
const PortalLayoutEditorPage = lazyWithReload(() => import('@/admin/records/layout/editor/PortalLayoutEditorPage').then(m => ({ default: m.PortalLayoutEditorPage })));
const AutomationsPage = lazyWithReload(() => import('@/admin/automations/AutomationsPage').then(m => ({ default: m.AutomationsPage })));
const AutomationEditorPage = lazyWithReload(() => import('@/admin/automations/AutomationEditorPage').then(m => ({ default: m.AutomationEditorPage })));
const DashboardsIndexPage = lazyWithReload(() => import('@/admin/dashboards/DashboardsIndexPage').then(m => ({ default: m.DashboardsIndexPage })));
const DashboardPage = lazyWithReload(() => import('@/admin/dashboards/DashboardPage').then(m => ({ default: m.DashboardPage })));
const PlatformPage = lazyWithReload(() => import('@/admin/platform/PlatformPage').then(m => ({ default: m.PlatformPage })));
const StoreSyncPage = lazyWithReload(() => import('@/cloud/pages/StoreSyncPage').then(m => ({ default: m.StoreSyncPage })));
const SqlSyncPage = lazyWithReload(() => import('@/cloud/pages/SqlSyncPage').then(m => ({ default: m.SqlSyncPage })));
const CollectionsPage = lazyWithReload(() => import('@/cloud/pages/CollectionsPage').then(m => ({ default: m.CollectionsPage })));
const WhatsappPage = lazyWithReload(() => import('@/cloud/pages/WhatsappPage').then(m => ({ default: m.WhatsappPage })));
const SmsPage = lazyWithReload(() => import('@/cloud/pages/SmsPage').then(m => ({ default: m.SmsPage })));
const GuestShell = lazyWithReload(() => import('@/admin/guests/GuestShell').then(m => ({ default: m.GuestShell })));
const SharedWithMePage = lazyWithReload(() => import('@/admin/guests/GuestShell').then(m => ({ default: m.SharedWithMePage })));

/**
 * C3 — Rutas de una persona INVITADA: «Compartido conmigo», las listas y los
 * registros que le compartieron (la misma tabla y la misma ficha, con lo que
 * el servidor le deja ver) y su cuenta. Cualquier otra ruta vuelve a la
 * portada. Los equipos de la empresa no se piden (el servidor daría 403).
 */
function GuestApp(): JSX.Element {
    disableTeamsApi();
    return (
        <Suspense fallback={<RouteFallback />}>
            <Routes>
                <Route element={<GuestShell />}>
                    <Route index element={<Navigate to="/shared" replace />} />
                    <Route path="shared" element={<SharedWithMePage />} />
                    <Route path="lists/:listSlug/records" element={<RecordsPage />} />
                    <Route path="lists/:listSlug/records/:recordId" element={
                        <Suspense fallback={<RouteFallback />}><RecordPage /></Suspense>
                    } />
                    <Route path="settings" element={
                        <Suspense fallback={<RouteFallback />}><CloudSettingsPage /></Suspense>
                    } />
                    <Route path="*" element={<Navigate to="/shared" replace />} />
                </Route>
            </Routes>
        </Suspense>
    );
}

/**
 * Fallback minimal mientras un chunk lazy se descarga. Suficiente:
 * el chunk pesa ~80-200 KB y en una conexión decente se descarga en
 * <500ms, así que un spinner sobrio basta. Si en algún momento se
 * vuelve común, podemos hacer skeleton screens por ruta.
 */
function RouteFallback(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
            <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
        </div>
    );
}

export function App(): JSX.Element {
    // Invalidación push del workspace activo. Vive aquí (y no en el gate de
    // sesión) para que socket.io viaje en el chunk de la app, no en el login.
    useRealtime();
    // v0.1.263 — la primera vez que entra un admin, la empresa toma su zona horaria.
    useTimeZoneAutoSetup();
    // H1 — clics en notificaciones y re-vínculo del push de este dispositivo.
    usePwaBridge();
    // C3 — una persona invitada de afuera tiene su propio shell.
    const isGuest = useIsGuest();
    if (isGuest) return <GuestApp />;
    return (
        <Routes>
            <Route element={<AdminShell />}>
                <Route index element={<Navigate to="/lists" replace />} />
                <Route path="lists" element={<ListsIndexPage />} />
                <Route path="lists/:listSlug/edit" element={
                    <Suspense fallback={<RouteFallback />}><ListBuilderPage /></Suspense>
                } />
                <Route path="lists/:listSlug/template-editor" element={
                    <Suspense fallback={<RouteFallback />}><RecordLayoutEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/portal-editor" element={
                    <Suspense fallback={<RouteFallback />}><PortalLayoutEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/records" element={<RecordsPage />} />
                <Route path="lists/:listSlug/records/:recordId" element={
                    <Suspense fallback={<RouteFallback />}><RecordPage /></Suspense>
                } />
                <Route path="lists/:listSlug/automations" element={
                    <Suspense fallback={<RouteFallback />}><AutomationsPage /></Suspense>
                } />
                <Route path="lists/:listSlug/automations/new" element={
                    <Suspense fallback={<RouteFallback />}><AutomationEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/automations/:automationId" element={
                    <Suspense fallback={<RouteFallback />}><AutomationEditorPage /></Suspense>
                } />
                <Route path="folders/:folderId" element={
                    <Suspense fallback={<RouteFallback />}><FolderPage /></Suspense>
                } />
                <Route path="my-work" element={
                    <Suspense fallback={<RouteFallback />}><MyWorkPage /></Suspense>
                } />
                <Route path="approvals/:approvalId" element={
                    <Suspense fallback={<RouteFallback />}><ApprovalConfirmPage /></Suspense>
                } />
                <Route path="agents" element={
                    <Suspense fallback={<RouteFallback />}><AgentsPage /></Suspense>
                } />
                <Route path="agents/new" element={
                    <Suspense fallback={<RouteFallback />}><AgentEditorPage /></Suspense>
                } />
                <Route path="agents/:agentId" element={
                    <Suspense fallback={<RouteFallback />}><AgentEditorPage /></Suspense>
                } />
                {import.meta.env.DEV && (
                    <Route path="aprende/lab" element={
                        <Suspense fallback={<RouteFallback />}><LearnLab /></Suspense>
                    } />
                )}
                <Route path="aprende" element={
                    <Suspense fallback={<RouteFallback />}><LearnCenter /></Suspense>
                } />
                <Route path="aprende/:moduleId" element={
                    <Suspense fallback={<RouteFallback />}><LearnCenter /></Suspense>
                } />
                <Route path="aprende/:moduleId/:articleId" element={
                    <Suspense fallback={<RouteFallback />}><LearnCenter /></Suspense>
                } />
                <Route path="ideas" element={
                    <Suspense fallback={<RouteFallback />}><IdeasPage /></Suspense>
                } />
                <Route path="ideas/:ideaId" element={
                    <Suspense fallback={<RouteFallback />}><IdeasPage /></Suspense>
                } />
                <Route path="novedades" element={
                    <Suspense fallback={<RouteFallback />}><WhatsNewPage /></Suspense>
                } />
                <Route path="favorites" element={
                    <Suspense fallback={<RouteFallback />}><FavoritesPage /></Suspense>
                } />
                <Route path="dashboards" element={
                    <Suspense fallback={<RouteFallback />}><DashboardsIndexPage /></Suspense>
                } />
                <Route path="dashboards/:dashboardId" element={
                    <Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>
                } />
                <Route path="settings" element={
                    <Suspense fallback={<RouteFallback />}><CloudSettingsPage /></Suspense>
                } />
                <Route path="settings/stores/:connectionId" element={
                    <Suspense fallback={<RouteFallback />}><StoreSyncPage /></Suspense>
                } />
                <Route path="settings/sql/:connectionId" element={
                    <Suspense fallback={<RouteFallback />}><SqlSyncPage /></Suspense>
                } />
                <Route path="settings/collections/:connectionId" element={
                    <Suspense fallback={<RouteFallback />}><CollectionsPage /></Suspense>
                } />
                <Route path="settings/whatsapp/:connectionId" element={
                    <Suspense fallback={<RouteFallback />}><WhatsappPage /></Suspense>
                } />
                <Route path="settings/sms/:connectionId" element={
                    <Suspense fallback={<RouteFallback />}><SmsPage /></Suspense>
                } />
                <Route path="platform" element={
                    <PlatformGate><Suspense fallback={<RouteFallback />}><PlatformPage /></Suspense></PlatformGate>
                } />
                <Route path="*" element={<Navigate to="/lists" replace />} />
            </Route>
        </Routes>
    );
}
