import { Workflow } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de «Conectar otras apps»: las apps de la empresa (WhatsApp, Gmail,
 * Slack, Calendar, Sheets, la tienda, los cobros, la base SQL) se enchufan a la
 * app una por una y quedan «Conectadas»; los pulsos muestran que los datos van
 * y vienen.
 */

const HUB = { x: 240, y: 150 };
const APPS: Array<{ key: string; name: string; x: number; y: number }> = [
    { key: 'whatsapp', name: 'WhatsApp', x: 96, y: 58 },
    { key: 'gmail', name: 'Gmail', x: 240, y: 30 },
    { key: 'slack', name: 'Slack', x: 384, y: 58 },
    { key: 'google_calendar', name: 'Calendar', x: 430, y: 150 },
    { key: 'google_sheets', name: 'Sheets', x: 384, y: 242 },
    { key: 'woocommerce', name: 'Tienda', x: 240, y: 270 },
    { key: 'mercadopago', name: 'Cobros', x: 96, y: 242 },
    { key: 'sqlserver', name: 'SQL Server', x: 50, y: 150 },
];

// Cada app «se conecta» en su turno: la línea aparece, el logo se enciende y
// sale el visto. Ventanas de 8% del ciclo, a partir del 4%.
const at = (i: number): number => 4 + i * 8;

const CSS = [
    ...APPS.map((_, i) => {
        const s = at(i);
        return `
@keyframes ih-line${i}{0%,${s}%{stroke-dashoffset:200;opacity:.2}${s + 6}%,92%{stroke-dashoffset:0;opacity:1}97%,100%{stroke-dashoffset:200;opacity:.2}}
@keyframes ih-logo${i}{0%,${s}%{filter:grayscale(1);opacity:.45;transform:scale(.9)}${s + 5}%{filter:grayscale(0);opacity:1;transform:scale(1.08)}${s + 8}%,92%{filter:grayscale(0);opacity:1;transform:scale(1)}97%,100%{filter:grayscale(1);opacity:.45;transform:scale(.9)}}
@keyframes ih-ok${i}{0%,${s + 4}%{opacity:0;transform:scale(.3)}${s + 7}%,92%{opacity:1;transform:scale(1)}96%,100%{opacity:0;transform:scale(.3)}}
@keyframes ih-dot${i}{0%,${s + 8}%{opacity:0;transform:translate(0,0)}${s + 10}%{opacity:1}${s + 20}%{opacity:1;transform:translate(var(--dx),var(--dy))}${s + 22}%,100%{opacity:0;transform:translate(var(--dx),var(--dy))}}`;
    }),
    `@keyframes ih-hub{0%,68%{box-shadow:0 0 0 0 ${primary(0.0)}}74%{box-shadow:0 0 0 10px ${primary(0.18)}}80%,100%{box-shadow:0 0 0 0 ${primary(0.0)}}}`,
    `@keyframes ih-count{0%,68%{opacity:0;transform:translateY(4px)}74%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`,
].join('\n');

export default function IntegHero(): JSX.Element {
    return (
        <Stage label="Las apps que usa tu empresa —WhatsApp, Gmail, Slack, Google Calendar, Google Sheets, tu tienda, los cobros y tu base de datos— se conectan una vez a la app y quedan listas para usar." tint="cyan">
            <Keyframes css={CSS} />
            <svg width={480} height={300} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                {APPS.map((a, i) => (
                    <line
                        key={a.key}
                        x1={HUB.x}
                        y1={HUB.y}
                        x2={a.x}
                        y2={a.y}
                        stroke={primary(0.55)}
                        strokeWidth={1.6}
                        strokeDasharray="200"
                        data-a=""
                        style={{ animationName: `ih-line${i}` }}
                    />
                ))}
            </svg>

            {/* Los pulsos: datos que van de la app a la integración. */}
            {APPS.map((a, i) => (
                <At
                    key={`d${a.key}`}
                    x={HUB.x - 4}
                    y={HUB.y - 4}
                    a={`ih-dot${i}`}
                    style={{ opacity: 0, ['--dx' as string]: `${a.x - HUB.x}px`, ['--dy' as string]: `${a.y - HUB.y}px` }}
                >
                    <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 3px ${primary(0.22)}` }} />
                </At>
            ))}

            {/* El centro: tu espacio de trabajo. */}
            <At
                x={HUB.x - 46}
                y={HUB.y - 38}
                w={92}
                h={76}
                a="ih-hub"
                style={{
                    borderRadius: 16,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    boxShadow: '0 12px 30px -14px rgba(15,23,42,.5)',
                }}
            >
                <span
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: primary(),
                        color: C.primaryFg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Workflow size={18} />
                </span>
                <T size={9.5} weight={700}>
                    Tu espacio
                </T>
            </At>
            <At x={HUB.x - 50} y={HUB.y + 42} w={100} a="ih-count" style={{ textAlign: 'center' }}>
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 17,
                        padding: '0 8px',
                        borderRadius: 99,
                        background: C.card,
                        border: `1px solid ${tone('mint', 0.5)}`,
                        color: tone('mint'),
                        fontSize: 9,
                        fontWeight: 700,
                    }}
                >
                    8 apps conectadas
                </span>
            </At>

            {APPS.map((a, i) => (
                <At key={a.key} x={a.x - 21} y={a.y - 21} w={42} h={42}>
                    <span data-a="" style={{ display: 'block', animationName: `ih-logo${i}` }}>
                        <IntegrationLogo integrationKey={a.key} size={42} />
                    </span>
                    <At
                        x={30}
                        y={-6}
                        a={`ih-ok${i}`}
                        style={{
                            width: 17,
                            height: 17,
                            borderRadius: 99,
                            background: C.success,
                            border: `2px solid ${C.card}`,
                            color: '#fff',
                            fontSize: 9,
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        ✓
                    </At>
                </At>
            ))}
        </Stage>
    );
}
