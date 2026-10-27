import { Building2, Mail, Repeat } from 'lucide-react';

import { At, C, Chip, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Repetir por cada registro vinculado»: para un cliente, los pasos de adentro
 * corren una vez por cada factura vinculada que cumple el filtro (las
 * pendientes); la pagada se salta.
 */

const ROWS = [
    { n: 'FAC-1042', amt: '$ 1.250.000', st: 'Pendiente', t: 'amber' as const, hit: 0 },
    { n: 'FAC-1047', amt: '$ 480.000', st: 'Pendiente', t: 'amber' as const, hit: 1 },
    { n: 'FAC-1039', amt: '$ 760.000', st: 'Pagada', t: 'mint' as const, hit: -1 },
    { n: 'FAC-1051', amt: '$ 320.000', st: 'Pendiente', t: 'amber' as const, hit: 2 },
];
const HIT_AT = [24, 44, 64];

function rowCss(k: number): string {
    const s = HIT_AT[k]!;
    return `@keyframes arp-r${k}{0%,${s - 2}%{background:transparent}${s}%,${s + 12}%{background:${primary(0.12)}}${s + 16}%,100%{background:transparent}}
@keyframes arp-m${k}{0%,${s + 6}%{opacity:0;transform:scale(.5)}${s + 10}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes arp-c${k}{0%,${s - 1}%{opacity:0}${s}%,${s + 18}%{opacity:1}${s + 19}%,100%{opacity:0}}`;
}

const CSS = `
@keyframes arp-loop{0%,18%{box-shadow:0 0 0 0 transparent}22%,82%{box-shadow:0 0 0 3px ${primary(0.22)}}88%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes arp-spin{0%,20%{transform:rotate(0)}84%,100%{transform:rotate(720deg)}}
@keyframes arp-skip{0%,52%{opacity:0}56%,92%{opacity:1}97%,100%{opacity:0}}
`;

export default function AutoRepetir(): JSX.Element {
    return (
        <Stage label="El paso Repetir por cada registro vinculado: para un cliente, el correo de cobro se manda una vez por cada factura pendiente vinculada, y la pagada se salta." tint="violet">
            <Keyframes css={CSS + [0, 1, 2].map(rowCss).join('\n')} />
            {/* El cliente que disparó */}
            <At x={14} y={92} w={110} h={86} style={{ borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)' }}>
                <IconSquare t="blue" size={22}>
                    <Building2 size={12} />
                </IconSquare>
                <T size={9.6} weight={700}>
                    Hotel Brisas
                </T>
                <T size={7.4} color={C.mutedFg}>
                    Cliente · 4 facturas
                </T>
            </At>

            {/* El bucle */}
            <At x={136} y={52} w={150} h={176} a="arp-loop" style={{ borderRadius: 12, border: `1.5px dashed ${primary(0.5)}`, background: primary(0.04), padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span data-a="" style={{ display: 'flex', color: primary(), animationName: 'arp-spin' }}>
                        <Repeat size={13} />
                    </span>
                    <T size={8.4} weight={700} color={primary()}>
                        Por cada vinculado
                    </T>
                </span>
                <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    de «Facturas» · sólo las que tengan Estado = Pendiente
                </T>
                <span style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, padding: '7px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <IconSquare t="blue" size={20}>
                        <Mail size={11} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={6.6} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            Cada uno
                        </T>
                        <T size={8} weight={600}>
                            Correo de cobro
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 7, background: C.muted, padding: '5px 7px' }}>
                    <T size={7} color={C.mutedFg}>
                        Asunto
                    </T>
                    <T size={7.6} weight={600}>
                        Factura <span style={{ color: primary(), fontFamily: 'ui-monospace, monospace' }}>{'{{item.numero}}'}</span>
                    </T>
                </span>
                <span style={{ position: 'relative', display: 'block', height: 14 }}>
                    {[0, 1, 2].map((k) => (
                        <span key={k} data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: k === 2 ? 1 : 0, animationName: `arp-c${k}` }}>
                            <T size={8} weight={700} color={primary()}>
                                Vuelta {k + 1} de 3
                            </T>
                        </span>
                    ))}
                </span>
            </At>
            <svg width={480} height={300} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                <path d="M 124 135 L 136 135" stroke={primary(0.5)} strokeWidth="1.6" strokeDasharray="4 3" />
                <path d="M 286 140 L 300 140" stroke={primary(0.5)} strokeWidth="1.6" strokeDasharray="4 3" />
            </svg>

            {/* Las facturas vinculadas */}
            <Win x={300} y={52} w={166} h={176} title="Facturas vinculadas">
                {ROWS.map((r, i) => (
                    <At
                        key={r.n}
                        x={0}
                        y={4 + i * 36}
                        w={166}
                        h={36}
                        a={r.hit >= 0 ? `arp-r${r.hit}` : undefined}
                        style={{ padding: '0 9px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: i < 3 ? `1px solid ${C.border}` : undefined, opacity: r.hit < 0 ? 0.55 : 1 }}
                    >
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                            <T size={8.6} weight={700}>
                                {r.n}
                            </T>
                            <T size={7.4} color={C.mutedFg}>
                                {r.amt}
                            </T>
                        </span>
                        <Chip label={r.st} t={r.t} />
                        <span style={{ width: 16, display: 'flex', justifyContent: 'center' }}>
                            {r.hit >= 0 ? (
                                <span data-a="" style={{ width: 16, height: 16, borderRadius: 99, background: tone('blue', 0.18), color: tone('blue'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animationName: `arp-m${r.hit}` }}>
                                    <Mail size={9} />
                                </span>
                            ) : null}
                        </span>
                    </At>
                ))}
            </Win>
            <At x={300} y={234} w={166} a="arp-skip" style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={7.6} color={C.mutedFg}>
                    La pagada no cumple el filtro: se salta.
                </T>
            </At>
            <At x={136} y={248} w={330} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8} color={C.mutedFg}>
                    Hasta 200 vinculados por corrida.
                </T>
            </At>
        </Stage>
    );
}
