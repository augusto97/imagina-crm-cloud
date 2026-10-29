import { Check, FileText, Folder, Home, Newspaper, Tag } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Sincronizar sitio»: se eligen los tipos de contenido (Propiedades, de un
 * plugin) y sus columnas, con cuáles se editan desde la app; al empezar se
 * crea una carpeta con una lista por tipo.
 */

const CSS = `
@keyframes sc-cur{0%{transform:translate(40px,270px);opacity:0}4%{opacity:1}10%,14%{transform:translate(38px,108px)}30%,34%{transform:translate(326px,108px)}50%,54%{transform:translate(412px,148px)}68%,72%{transform:translate(390px,230px)}90%,100%{transform:translate(440px,280px);opacity:0}}
@keyframes sc-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}16%{opacity:0;transform:scale(1.6)}31%{opacity:0;transform:scale(.4)}32%{opacity:1;transform:scale(1)}36%{opacity:0;transform:scale(1.6)}51%{opacity:0;transform:scale(.4)}52%{opacity:1;transform:scale(1)}56%{opacity:0;transform:scale(1.6)}69%{opacity:0;transform:scale(.4)}70%{opacity:1;transform:scale(1)}74%,100%{opacity:0;transform:scale(1.6)}}
@keyframes sc-type{0%,12%{background:${C.card};box-shadow:none}14%,100%{background:${primary(0.08)};box-shadow:inset 0 0 0 1.5px ${primary()}}}
@keyframes sc-tick{0%,12%{opacity:0}14%,100%{opacity:1}}
@keyframes sc-cols{0%,13%{opacity:.35}16%,100%{opacity:1}}
@keyframes sc-c1{0%,32%{opacity:0}34%,100%{opacity:1}}
@keyframes sc-e1{0%,52%{opacity:0}54%,100%{opacity:1}}
@keyframes sc-btn{0%,69%{transform:scale(1)}71%{transform:scale(.93)}73%,100%{transform:scale(1)}}
@keyframes sc-done{0%,74%{opacity:0;transform:translateY(8px)}80%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
`;

function Box({ on, a }: { on: boolean; a?: string }): JSX.Element {
    return (
        <span style={{ position: 'relative', width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${on || a ? primary() : C.border}`, background: C.card, display: 'inline-flex', flexShrink: 0 }}>
            {(on || a) && (
                <span
                    data-a={a ? '' : undefined}
                    style={{ ...(a ? { animationName: a } : null), position: 'absolute', inset: -1.5, borderRadius: 3, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <Check size={8} strokeWidth={3} />
                </span>
            )}
        </span>
    );
}

const TYPES: Array<[string, typeof FileText, string, boolean]> = [
    ['Entradas', Newspaper, '128', false],
    ['Páginas', FileText, '14', false],
    ['Propiedades', Home, '46', true],
    ['Zonas', Tag, '9', false],
];

const COLUMNS: Array<[string, string, boolean, string | null, string | null]> = [
    ['Título', 'Texto', true, null, null],
    ['Precio', 'Moneda · ACF', false, 'sc-c1', 'sc-e1'],
    ['Habitaciones', 'Número · ACF', true, null, null],
    ['Modificado', 'Fecha', true, null, null],
];

export default function SitioColumnas(): JSX.Element {
    return (
        <Stage
            label="Al sincronizar el sitio se eligen los tipos de contenido, como Propiedades, y qué columnas traer de cada uno, marcando cuáles se editan desde la app. Al empezar se crea una carpeta con una lista por tipo."
            tint="blue"
        >
            <Keyframes css={CSS} />

            <Win
                x={14}
                y={14}
                w={452}
                h={236}
                title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <IntegrationLogo integrationKey="wordpress" size={14} />
                        Sincronizar sitio · inmobiliaria.co
                    </span>
                }
            >
                {/* Tipos de contenido */}
                <div style={{ position: 'absolute', left: 10, top: 10, width: 150, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={8} weight={700} color={C.mutedFg}>
                        Qué traer
                    </T>
                    {TYPES.map(([label, Icon, n, target]) => (
                        <span
                            key={label}
                            data-a={target ? '' : undefined}
                            style={{
                                ...(target ? { animationName: 'sc-type' } : null),
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                height: 26,
                                padding: '0 7px',
                                borderRadius: 7,
                                border: `1px solid ${C.border}`,
                                background: label === 'Entradas' ? primary(0.08) : C.card,
                            }}
                        >
                            <Box on={label === 'Entradas'} a={target ? 'sc-tick' : undefined} />
                            <Icon size={11} color={C.mutedFg} />
                            <T size={8.5} weight={600}>
                                {label}
                            </T>
                            <T size={7.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                                {n}
                            </T>
                        </span>
                    ))}
                </div>

                {/* Columnas del tipo elegido */}
                <div data-a="" style={{ animationName: 'sc-cols', position: 'absolute', left: 172, top: 10, width: 268, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        <T size={8} weight={700} color={C.mutedFg}>
                            Columnas de Propiedades
                        </T>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ marginLeft: 'auto', width: 56, textAlign: 'center' }}>
                            Editable
                        </T>
                    </span>
                    {COLUMNS.map(([label, kind, on, tick, edit]) => (
                        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 7px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                            <Box on={on} a={tick ?? undefined} />
                            <T size={8.5} weight={600}>
                                {label}
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                {kind}
                            </T>
                            <span style={{ marginLeft: 'auto', width: 56, display: 'flex', justifyContent: 'center' }}>
                                {label === 'Modificado' ? (
                                    <T size={7} color={C.mutedFg}>
                                        —
                                    </T>
                                ) : (
                                    <Box on={label === 'Título'} a={edit ?? undefined} />
                                )}
                            </span>
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <T size={7.5} color={C.mutedFg}>
                            Cada 15 minutos · Editar desde la app
                        </T>
                        <span
                            data-a=""
                            style={{
                                animationName: 'sc-btn',
                                marginLeft: 'auto',
                                height: 22,
                                padding: '0 10px',
                                borderRadius: 6,
                                background: primary(),
                                color: C.primaryFg,
                                fontSize: 8.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            Empezar a sincronizar
                        </span>
                    </span>
                </div>
            </Win>

            {/* La carpeta creada */}
            <At
                x={96}
                y={258}
                w={288}
                a="sc-done"
                style={{
                    opacity: 0,
                    background: C.card,
                    border: `1px solid ${tone('mint', 0.5)}`,
                    borderRadius: 10,
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)',
                }}
            >
                <Folder size={14} color={tone('blue')} />
                <T size={8.5} weight={700}>
                    WordPress · inmobiliaria.co
                </T>
                <T size={7.5} color={C.mutedFg}>
                    Entradas · Propiedades
                </T>
            </At>

            <Cursor a="sc-cur" click="sc-ring" />
        </Stage>
    );
}
