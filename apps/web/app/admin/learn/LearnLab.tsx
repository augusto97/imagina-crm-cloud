import { useEffect, useState } from 'react';

import { DemoPlayer } from './demos/DemoPlayer';
import { loadDemoManifest } from './demos/demoManifest';
import { ILLUSTRATION_KEYS, Illustration } from './illustrations/registry';

/**
 * Banco de pruebas de las ilustraciones (sólo en desarrollo, `/aprende/lab`):
 * todas las escenas en grilla, para revisarlas en claro, oscuro y celular.
 * `?only=clave` muestra una sola, grande.
 */
export function LearnLab(): JSX.Element {
    const only = new URLSearchParams(window.location.search).get('only');
    const demo = new URLSearchParams(window.location.search).get('demo');
    const keys = only ? ILLUSTRATION_KEYS.filter((k) => k === only) : demo ? [] : ILLUSTRATION_KEYS;
    const [demoKeys, setDemoKeys] = useState<string[]>([]);
    useEffect(() => {
        void loadDemoManifest().then((m) => setDemoKeys(m ? Object.keys(m.demos) : []));
    }, []);
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-6xl imcrm-flex-col imcrm-gap-4 imcrm-p-4">
            <h1 className="imcrm-text-lg imcrm-font-semibold">Ilustraciones ({ILLUSTRATION_KEYS.length})</h1>
            <div className={only ? 'imcrm-max-w-3xl' : 'imcrm-grid imcrm-gap-5 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3'}>
                {keys.map((k) => (
                    <figure key={k} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={`lab-${k}`}>
                        <Illustration name={k} />
                        <figcaption className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{k}</figcaption>
                    </figure>
                ))}
            </div>
            {!only && (
                <>
                    <h2 className="imcrm-pt-4 imcrm-text-lg imcrm-font-semibold">Capturas ({demoKeys.length})</h2>
                    <div className={demo ? 'imcrm-max-w-3xl' : 'imcrm-grid imcrm-gap-5 lg:imcrm-grid-cols-2'}>
                        {demoKeys
                            .filter((k) => !demo || k === demo)
                            .map((k) => (
                                <div key={k} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid={`lab-demo-${k}`}>
                                    <DemoPlayer demoKey={k} />
                                    <span className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{k}</span>
                                </div>
                            ))}
                    </div>
                </>
            )}
        </div>
    );
}
