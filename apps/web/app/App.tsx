import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { AdminShell } from '@/admin/layout/AdminShell';
import { SettingsPage as CloudSettingsPage } from '@/cloud/pages/SettingsPage';
// Records views se cargan eagerly — son la pantalla home del SPA
// y casi cualquier flujo aterriza ahí. Lazy-load las pantallas
// secundarias (dashboards, automations, builder, settings) para que
// el first-paint no descargue su código si el user nunca las visita.
import { ListsIndexPage } from '@/admin/lists/ListsIndexPage';
import { RecordPage } from '@/admin/records/RecordPage';
import { RecordsPage } from '@/admin/records/RecordsPage';
import { lazyWithReload } from '@/lib/lazyWithReload';

// Lazy-loaded pages. React.lazy + Vite produce un chunk por cada
// import — esos chunks viven en `dist/assets/*-<hash>.js` y se
// descargan solo cuando el user navega a la ruta. Con esto el bundle
// inicial baja ~40% en sites donde el usuario solo usa records.
//
// Usamos `lazyWithReload` en lugar de `React.lazy`: si el chunk falla
// porque el plugin se actualizó y los content-hashes cambiaron (deploy
// stale), recarga la página automáticamente. Previene la pantalla en
// blanco que pasaba con `Failed to fetch dynamically imported module`.
const ListBuilderPage = lazyWithReload(() => import('@/admin/lists/ListBuilderPage').then(m => ({ default: m.ListBuilderPage })));
const TemplateEditorPage = lazyWithReload(() => import('@/admin/lists/template-editor/TemplateEditorPage').then(m => ({ default: m.TemplateEditorPage })));
const PortalTemplateEditorPage = lazyWithReload(() => import('@/admin/lists/portal-template-editor/PortalTemplateEditorPage').then(m => ({ default: m.PortalTemplateEditorPage })));
const AutomationsPage = lazyWithReload(() => import('@/admin/automations/AutomationsPage').then(m => ({ default: m.AutomationsPage })));
const AutomationEditorPage = lazyWithReload(() => import('@/admin/automations/AutomationEditorPage').then(m => ({ default: m.AutomationEditorPage })));
const DashboardsIndexPage = lazyWithReload(() => import('@/admin/dashboards/DashboardsIndexPage').then(m => ({ default: m.DashboardsIndexPage })));
const DashboardPage = lazyWithReload(() => import('@/admin/dashboards/DashboardPage').then(m => ({ default: m.DashboardPage })));
const PlatformPage = lazyWithReload(() => import('@/admin/platform/PlatformPage').then(m => ({ default: m.PlatformPage })));

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
    return (
        <Routes>
            <Route element={<AdminShell />}>
                <Route index element={<Navigate to="/lists" replace />} />
                <Route path="lists" element={<ListsIndexPage />} />
                <Route path="lists/:listSlug/edit" element={
                    <Suspense fallback={<RouteFallback />}><ListBuilderPage /></Suspense>
                } />
                <Route path="lists/:listSlug/template-editor" element={
                    <Suspense fallback={<RouteFallback />}><TemplateEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/portal-editor" element={
                    <Suspense fallback={<RouteFallback />}><PortalTemplateEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/records" element={<RecordsPage />} />
                <Route path="lists/:listSlug/records/:recordId" element={<RecordPage />} />
                <Route path="lists/:listSlug/automations" element={
                    <Suspense fallback={<RouteFallback />}><AutomationsPage /></Suspense>
                } />
                <Route path="lists/:listSlug/automations/new" element={
                    <Suspense fallback={<RouteFallback />}><AutomationEditorPage /></Suspense>
                } />
                <Route path="lists/:listSlug/automations/:automationId" element={
                    <Suspense fallback={<RouteFallback />}><AutomationEditorPage /></Suspense>
                } />
                <Route path="dashboards" element={
                    <Suspense fallback={<RouteFallback />}><DashboardsIndexPage /></Suspense>
                } />
                <Route path="dashboards/:dashboardId" element={
                    <Suspense fallback={<RouteFallback />}><DashboardPage /></Suspense>
                } />
                <Route path="settings" element={<CloudSettingsPage />} />
                <Route path="platform" element={
                    <Suspense fallback={<RouteFallback />}><PlatformPage /></Suspense>
                } />
                <Route path="*" element={<Navigate to="/lists" replace />} />
            </Route>
        </Routes>
    );
}
