import { useState } from 'react';

import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { boldSegments, installGuide, type BrowserName } from '@/lib/pwa/installGuide';
import { browserName, deviceInfo, type DeviceInfo } from '@/lib/pwa/platform';
import { cn } from '@/lib/utils';

/**
 * v0.1.321 — los pasos para instalar la app, para el navegador de ESTE
 * dispositivo y, con el selector, para otro (así quien administra le explica
 * a su equipo cómo hacerlo en el teléfono). Lo usan el diálogo del menú y la
 * tarjeta de Ajustes → Cuenta → Avisos.
 */

type Target = 'this' | 'iphone' | 'android' | 'chrome' | 'edge' | 'safari-mac';

const NO_DEVICE: DeviceInfo = { ios: false, android: false, standalone: false, iosSafari: false, iosVersion: null };

const TARGETS: Record<Exclude<Target, 'this'>, { label: string; info: DeviceInfo; browser: BrowserName }> = {
    iphone: { label: 'iPhone o iPad (Safari)', info: { ...NO_DEVICE, ios: true, iosSafari: true }, browser: 'safari' },
    android: { label: 'Android (Chrome)', info: { ...NO_DEVICE, android: true }, browser: 'chrome' },
    chrome: { label: 'Chrome en el computador', info: NO_DEVICE, browser: 'chrome' },
    edge: { label: 'Edge en el computador', info: NO_DEVICE, browser: 'edge' },
    'safari-mac': { label: 'Safari en el Mac', info: NO_DEVICE, browser: 'safari' },
};

export function InstallSteps({ className }: { className?: string }): JSX.Element {
    const [target, setTarget] = useState<Target>('this');
    const guide = target === 'this' ? installGuide(deviceInfo(), browserName()) : installGuide(TARGETS[target].info, TARGETS[target].browser);

    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3', className)} data-testid="install-steps">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground" data-testid="install-steps-where">
                    {target === 'this' ? `${__('En este dispositivo')}: ${__(guide.where)}` : __(guide.where)}
                </p>
                <Select
                    value={target}
                    onChange={(e) => setTarget(e.target.value as Target)}
                    className="imcrm-h-7 imcrm-w-auto imcrm-text-xs"
                    aria-label={__('Ver los pasos para')}
                    data-testid="install-steps-target"
                >
                    <option value="this">{__('Este dispositivo')}</option>
                    {(Object.keys(TARGETS) as Array<keyof typeof TARGETS>).map((k) => (
                        <option key={k} value={k}>
                            {__(TARGETS[k].label)}
                        </option>
                    ))}
                </Select>
            </div>
            {guide.steps.length > 0 && (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-text-sm">
                    {guide.steps.map((step, i) => (
                        <li key={i} className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-xs imcrm-font-semibold">
                                {i + 1}
                            </span>
                            <span className="imcrm-pt-0.5">
                                <Bold text={__(step)} />
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {guide.note && (
                <p
                    className={cn(
                        'imcrm-text-xs',
                        guide.unsupported ? 'imcrm-rounded-md imcrm-bg-warning/15 imcrm-px-3 imcrm-py-2 imcrm-text-foreground' : 'imcrm-text-muted-foreground',
                    )}
                    data-testid={guide.unsupported ? 'install-unsupported' : undefined}
                >
                    <Bold text={__(guide.note)} />
                </p>
            )}
        </div>
    );
}

function Bold({ text }: { text: string }): JSX.Element {
    return (
        <>
            {boldSegments(text).map((s, i) =>
                s.bold ? (
                    <strong key={i} className="imcrm-font-semibold">
                        {s.text}
                    </strong>
                ) : (
                    <span key={i}>{s.text}</span>
                ),
            )}
        </>
    );
}
