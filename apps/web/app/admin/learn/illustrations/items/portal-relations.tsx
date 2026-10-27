import { Link2, Lock } from 'lucide-react';

import { At, Avatar, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** El portal muestra sólo lo vinculado al cliente: de todas las facturas, Ana ve las tres que tienen su nombre en «Cliente». */

const CSS = `
@keyframes pr-mine{0%,10%{background:transparent}18%,86%{background:${tone('violet', 0.12)}}94%,100%{background:transparent}}
@keyframes pr-other{0%,14%{opacity:1}22%,86%{opacity:.32}94%,100%{opacity:1}}
@keyframes pr-f1{0%,28%{opacity:0;transform:translate(-200px,-30px)}30%{opacity:1;transform:translate(-200px,-30px)}42%,92%{opacity:1;transform:translate(0,0)}97%,100%{opacity:0}}
@keyframes pr-f2{0%,34%{opacity:0;transform:translate(-200px,-6px)}36%{opacity:1;transform:translate(-200px,-6px)}48%,92%{opacity:1;transform:translate(0,0)}97%,100%{opacity:0}}
@keyframes pr-f3{0%,40%{opacity:0;transform:translate(-200px,18px)}42%{opacity:1;transform:translate(-200px,18px)}54%,92%{opacity:1;transform:translate(0,0)}97%,100%{opacity:0}}
@keyframes pr-tag{0%,14%{opacity:0;transform:translateY(6px)}22%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

type R = { n: string; who: string; ini: string; t: 'violet' | 'cyan' | 'amber' | 'blue'; v: string; st: 'Pendiente' | 'Pagada' };
const ROWS: R[] = [
    { n: 'FAC-0051', who: 'Ana Gómez', ini: 'AG', t: 'violet', v: '$ 380.000', st: 'Pendiente' },
    { n: 'FAC-0050', who: 'Hotel Brisas', ini: 'HB', t: 'cyan', v: '$ 1,2 M', st: 'Pagada' },
    { n: 'FAC-0049', who: 'Ana Gómez', ini: 'AG', t: 'violet', v: '$ 410.000', st: 'Pagada' },
    { n: 'FAC-0048', who: 'Óptica Visión', ini: 'ÓV', t: 'amber', v: '$ 650.000', st: 'Pendiente' },
    { n: 'FAC-0047', who: 'Ana Gómez', ini: 'AG', t: 'violet', v: '$ 395.000', st: 'Pagada' },
    { n: 'FAC-0046', who: 'Colegio Andino', ini: 'CA', t: 'blue', v: '$ 2,4 M', st: 'Pagada' },
];

export default function PortalRelations(): JSX.Element {
    const mine = ROWS.filter((r) => r.who === 'Ana Gómez');
    return (
        <Stage label="De la lista de facturas, que tiene las de todos los clientes, el portal de Ana muestra sólo las tres vinculadas a su registro por el campo Cliente." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win x={18} y={26} w={236} h={232} title="Facturas · todas">
                    <div style={{ display: 'flex', padding: '7px 10px 5px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ width: 56 }}>
                            Número
                        </T>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ width: 94 }}>
                            Cliente
                        </T>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Monto
                        </T>
                    </div>
                    {ROWS.map((r, i) => (
                        <div
                            key={r.n}
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 24 + i * 29,
                                width: 234,
                                height: 29,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 10px',
                                borderBottom: `1px solid ${C.border}`,
                                animationName: r.who === 'Ana Gómez' ? 'pr-mine' : 'pr-other',
                                ...(r.who === 'Ana Gómez' ? { background: tone('violet', 0.12) } : { opacity: 0.32 }),
                            }}
                        >
                            <T size={8} weight={700} style={{ width: 56 }}>
                                {r.n}
                            </T>
                            <span style={{ width: 94, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Avatar initials={r.ini} t={r.t} size={14} />
                                <T size={8} weight={r.who === 'Ana Gómez' ? 700 : 500}>
                                    {r.who}
                                </T>
                            </span>
                            <T size={8}>{r.v}</T>
                        </div>
                    ))}
                </Win>
                <At x={36} y={268} a="pr-tag">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}` }}>
                        <Link2 size={9} color={primary()} />
                        <T size={7.5} weight={600}>
                            Se vincula por el campo «Cliente»
                        </T>
                    </span>
                </At>

                {/* El portal de Ana */}
                <At
                    x={278}
                    y={40}
                    w={184}
                    h={212}
                    style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 16px 36px -16px rgba(15,23,42,.5)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <Avatar initials="AG" t="violet" size={20} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={6.5} color={C.mutedFg}>
                                Portal de
                            </T>
                            <T size={9} weight={800}>
                                Ana Gómez
                            </T>
                        </span>
                        <Lock size={10} color={C.mutedFg} style={{ marginLeft: 'auto' }} />
                    </div>
                    <At x={10} y={48}>
                        <T size={8.5} weight={800}>
                            Tus facturas
                        </T>
                    </At>
                    <At x={10} y={176} w={164}>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Sólo ve las suyas: las de los demás clientes nunca salen de la app.
                        </T>
                    </At>
                </At>
                {mine.map((r, i) => (
                        <At
                            key={r.n}
                            x={288}
                            y={106 + i * 34}
                            w={164}
                            h={28}
                            a={`pr-f${i + 1}`}
                            style={{ zIndex: 5, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', boxShadow: '0 4px 10px -6px rgba(15,23,42,.3)' }}
                        >
                            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <T size={8} weight={700}>
                                    {r.n}
                                </T>
                                <T size={7} color={C.mutedFg}>
                                    {r.v}
                                </T>
                            </span>
                            <Chip label={r.st} t={r.st === 'Pagada' ? 'mint' : 'amber'} />
                        </At>
                    ))}
            </At>
        </Stage>
    );
}
