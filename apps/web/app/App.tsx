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
import { lazyWithReload } from '@/lib/lazyWithReload';
import { useTimeZoneAutoSetup } from '@/cloud/useTimeZoneAutoSetup';
import { useRealtime } from '@/cloud/useRealtime';

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
    // Invalidación push del workspace activo. Vive acá (y no en el gate de
    // sesión) para que socket.io viaje en el chunk de la app, no en el login.
    useRealtime();
    // v0.1.263 — la primera vez que entra un admin, la empresa toma su zona horaria.
    useTimeZoneAutoSetup();
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
                <Route path="platform" element={
                    <Suspense fallback={<RouteFallback />}><PlatformPage /></Suspense>
                } />
                <Route path="*" element={<Navigate to="/lists" replace />} />
            </Route>
        </Routes>
    );
}
