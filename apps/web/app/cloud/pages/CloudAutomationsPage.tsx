import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, useSession } from '@/cloud/session';
import { AutomationsPanel } from '@/cloud/components/AutomationsPanel';

/**
 * Ruta `/lists/:listSlug/automations` en la nube. Monta el AutomationsPanel del
 * shell (que habla nativo el shape del backend NestJS) en vez del builder
 * visual del fork WordPress —que asume un modelo de condiciones/acciones más
 * amplio del que expone el backend—. Alta con trigger/condición/acción, toggle
 * activa/pausa, visor de runs y borrado.
 */
export function CloudAutomationsPage(): JSX.Element {
    const { listSlug } = useParams<{ listSlug: string }>();
    const tenantId = useSession((s) => s.activeTenantId);
    const fields = useQuery({
        queryKey: ['fields', tenantId, listSlug],
        queryFn: () => api.listFields(listSlug as string),
        enabled: Boolean(listSlug),
    });

    return (
        <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-space-y-6 imcrm-p-6">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                    Automatizaciones
                </h1>
                <Link
                    to={`/lists/${listSlug}/records`}
                    className="imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    ← Volver a la lista
                </Link>
            </div>
            {fields.data && <AutomationsPanel listSlug={listSlug as string} fields={fields.data} />}
        </div>
    );
}
