import { EyeOff, Globe, Lock, Search } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Página pública de una lista: se marcan los campos que se muestran y la página sólo enseña esos; el costo no sale de la app. */

const FIELDS: Array<{ l: string; on: boolean }> = [
    { l: 'Marca y modelo', on: true },
    { l: 'Año', on: true },
    { l: 'Kilometraje', on: true },
    { l: 'Precio', on: true },
    { l: 'Costo', on: false },
    { l: 'Proveedor', on: false },
];

const COLS = [
    { l: 'Marca y modelo', w: 80, v: ['Mazda 3 Touring', 'Kia Picanto', 'Renault Duster', 'Chevrolet Onix'] },
    { l: 'Año', w: 30, v: ['2021', '2020', '2019', '2022'] },
    { l: 'Km', w: 40, v: ['38.200', '51.900', '64.000', '22.700'] },
    { l: 'Precio', w: 54, v: ['$ 72.900.000', '$ 41.500.000', '$ 63.000.000', '$ 58.400.000'] },
];

const CSS = `
${FIELDS.map((f, i) => (f.on ? `@keyframes cpl-k${i}{0%,${8 + i * 8}%{background:transparent;border-color:${C.border}}${10 + i * 8}%,100%{background:${primary()};border-color:${primary()}}}\n@keyframes cpl-t${i}{0%,${8 + i * 8}%{opacity:0}${10 + i * 8}%,100%{opacity:1}}` : '')).join('\n')}
${COLS.map((_, i) => `@keyframes cpl-c${i}{0%,${10 + i * 8}%{opacity:0;transform:translateY(-4px)}${14 + i * 8}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`).join('\n')}
@keyframes cpl-lock{0%,46%{opacity:0;transform:scale(.7)}52%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes cpl-hide{0%,46%{opacity:.6}52%,92%{opacity:1}100%{opacity:.6}}
`;

export default function CompPublicList(): JSX.Element {
    return (
        <Stage label="En Qué campos se muestran se marcan marca y modelo, año, kilometraje y precio; costo y proveedor quedan sin marcar. La página pública muestra sólo esas cuatro columnas y el costo nunca sale de la app." tint="blue">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Panel de la lista */}
                <At x={16} y={36} w={150} h={228} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Globe size={11} color={primary()} />
                        <T size={8.5} weight={800}>
                            Página pública
                        </T>
                        <span style={{ marginLeft: 'auto', padding: '1px 5px', borderRadius: 99, background: tone('mint', 0.15) }}>
                            <T size={6} weight={700} color={tone('mint')}>
                                Publicada
                            </T>
                        </span>
                    </span>
                    <T size={7.5} weight={700}>
                        Qué campos se muestran
                    </T>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Lo que no marques aquí nunca sale de la app.
                    </T>
                    {FIELDS.map((f, i) => (
                        <span key={f.l} data-a={f.on ? undefined : ''} style={{ height: 20, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 6, background: f.on ? 'transparent' : C.muted, animationName: f.on ? undefined : 'cpl-hide' }}>
                            <span
                                data-a={f.on ? '' : undefined}
                                style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${f.on ? primary() : C.border}`, background: f.on ? primary() : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: f.on ? `cpl-k${i}` : undefined }}
                            >
                                {f.on ? (
                                    <svg data-a="" width="7" height="7" viewBox="0 0 10 10" style={{ animationName: `cpl-t${i}` }}>
                                        <path d="M2 5.2l2 2L8 3" fill="none" stroke={C.primaryFg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                ) : null}
                            </span>
                            <T size={7.5} color={f.on ? C.fg : C.mutedFg}>
                                {f.l}
                            </T>
                            {f.on ? null : (
                                <span data-a="" style={{ marginLeft: 'auto', display: 'flex', animationName: 'cpl-lock' }}>
                                    <Lock size={8} color={C.mutedFg} />
                                </span>
                            )}
                        </span>
                    ))}
                </At>

                {/* La página pública */}
                <Win x={180} y={24} w={284} h={252} title="Autos del Valle · Inventario">
                    <div style={{ padding: '9px 10px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <T size={10} weight={800}>
                            Carros disponibles
                        </T>
                        <span style={{ marginLeft: 'auto', width: 92, height: 18, borderRadius: 99, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 4, padding: '0 7px' }}>
                            <Search size={8} color={C.mutedFg} />
                            <T size={6.5} color={C.mutedFg}>
                                Buscar…
                            </T>
                        </span>
                    </div>
                    <div style={{ margin: '0 10px', borderRadius: 7, border: `1px solid ${C.border}`, overflow: 'hidden', display: 'flex' }}>
                        {COLS.map((c, i) => (
                            <span key={c.l} data-a="" style={{ display: 'flex', flexDirection: 'column', flex: c.w, minWidth: 0, animationName: `cpl-c${i}` }}>
                                <span style={{ height: 22, display: 'flex', alignItems: 'center', padding: '0 6px', background: C.muted }}>
                                    <T size={6.5} weight={700} color={C.mutedFg}>
                                        {c.l}
                                    </T>
                                </span>
                                {c.v.map((v) => (
                                    <span key={v} style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 6px', borderTop: `1px solid ${C.border}` }}>
                                        <T size={6.8} weight={i === 3 ? 700 : 500}>
                                            {v}
                                        </T>
                                    </span>
                                ))}
                            </span>
                        ))}
                    </div>
                    <At x={10} y={186} w={264} a="cpl-lock" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: 7, background: tone('mint', 0.1) }}>
                        <EyeOff size={9} color={tone('mint')} />
                        <T size={6.8} weight={600} color={tone('mint')}>
                            Costo y proveedor no se ven: no están marcados.
                        </T>
                    </At>
                </Win>
            </At>
        </Stage>
    );
}
