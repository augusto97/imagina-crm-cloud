import { FileText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';

import { useReports } from './useReports';

/**
 * v0.1.464 (J1) — Los informes en el panel de Tableros. Se baja a pedido (no
 * pesa en la carga inicial): recibe las piezas del panel para verse igual.
 */
export default function ReportsPanelSection({
    pathname,
    NavItem,
    Section,
}: {
    pathname: string;
    NavItem: (p: { to: string; icon: LucideIcon; label: string; active: boolean }) => JSX.Element;
    Section: (p: { label: string; children: React.ReactNode }) => JSX.Element;
}): JSX.Element | null {
    const reports = useReports();
    const items = reports.data ?? [];
    return (
        <Section label={__('Informes')}>
            <div data-testid="reports-panel" className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                {items.map((r) => (
                    <NavItem key={r.id} to={`/reports/${r.id}`} icon={FileText} label={r.name} active={pathname.startsWith(`/reports/${r.id}`)} />
                ))}
                <NavItem to="/dashboards?tab=informes" icon={FileText} label={items.length > 0 ? __('Todos los informes') : __('Crear un informe')} active={false} />
            </div>
        </Section>
    );
}
