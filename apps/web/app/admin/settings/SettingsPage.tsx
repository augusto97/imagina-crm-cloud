import { getBootData } from '@/lib/boot';
import { __ } from '@/lib/i18n';

import { CustomRolesCard } from './CustomRolesCard';
import { EmailSignatureCard } from './EmailSignatureCard';
import { LicenseCard } from './LicenseCard';
import { WebhooksCard } from './WebhooksCard';

export function SettingsPage(): JSX.Element {
    const boot = getBootData();

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header>
                <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">
                    {__('Ajustes')}
                </h1>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Licencia, firma de email, entorno e información del plugin.')}
                </p>
            </header>

            <LicenseCard />

            <EmailSignatureCard />

            <CustomRolesCard />

            <WebhooksCard />

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Entorno')}</h2>
                <dl className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 sm:imcrm-grid-cols-2">
                    <Item label={__('Versión del plugin')} value={boot.version} />
                    <Item label={__('REST root')} value={boot.restRoot} />
                    <Item label={__('Locale')} value={boot.locale} />
                    <Item label={__('Timezone')} value={boot.timezone} />
                </dl>
            </section>
        </div>
    );
}

function Item({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <dt className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {label}
            </dt>
            <dd className="imcrm-font-mono imcrm-text-sm">{value || '—'}</dd>
        </div>
    );
}
