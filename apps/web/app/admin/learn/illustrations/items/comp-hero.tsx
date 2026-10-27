import { AppWindow, Globe, LayoutDashboard, Mail, MessageSquare, Table2, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';

import { At, Avatar, C, Flow, Keyframes, Stage, T, primary, tone } from '../kit';

/** Portada de «Compartir»: una misma lista llega a cada persona por el camino que le corresponde. */

type Tone = 'blue' | 'cyan' | 'amber' | 'mint';

const DEST: Array<{ x: number; y: number; from: [number, number]; to: [number, number]; t: Tone }> = [
    { x: 16, y: 22, from: [184, 118], to: [148, 76], t: 'blue' },
    { x: 340, y: 22, from: [296, 118], to: [332, 76], t: 'amber' },
    { x: 16, y: 178, from: [184, 182], to: [148, 226], t: 'cyan' },
    { x: 340, y: 178, from: [296, 182], to: [332, 226], t: 'mint' },
];

const CSS = `
${DEST.map((d, i) => {
    const s = 8 + i * 18;
    const dx = d.to[0] - d.from[0];
    const dy = d.to[1] - d.from[1];
    return `@keyframes ch-p${i}{0%,${s}%{opacity:0;transform:translate(0,0)}${s + 1}%{opacity:1}${s + 8}%{opacity:1;transform:translate(${dx}px,${dy}px)}${s + 10}%,100%{opacity:0;transform:translate(${dx}px,${dy}px)}}
@keyframes ch-d${i}{0%,${s + 7}%{box-shadow:0 12px 30px -14px rgba(15,23,42,.4)}${s + 9}%,${s + 16}%{box-shadow:0 0 0 2.5px ${tone(d.t, 0.55)},0 12px 30px -14px rgba(15,23,42,.4)}${s + 22}%,100%{box-shadow:0 12px 30px -14px rgba(15,23,42,.4)}}`;
}).join('\n')}
@keyframes ch-core{0%,4%{transform:scale(.96)}8%,100%{transform:scale(1)}}
`;

function Dest({ i, title, icon, children }: { i: number; title: string; icon: ReactNode; children: ReactNode }): JSX.Element {
    const d = DEST[i]!;
    return (
        <At
            x={d.x}
            y={d.y}
            w={124}
            h={100}
            a={`ch-d${i}`}
            style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 9, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 18, height: 18, borderRadius: 6, background: tone(d.t, 0.16), color: tone(d.t), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                <T size={8} weight={800}>
                    {title}
                </T>
            </span>
            {children}
        </At>
    );
}

export default function CompHero(): JSX.Element {
    return (
        <Stage label="Una lista en el centro y cuatro caminos: una página pública que ve cualquiera, un tablero que llega por correo a los socios, el portal donde cada cliente ve lo suyo y un invitado que entra a comentar." tint="blue">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {DEST.map((d, i) => (
                    <Flow key={i} x1={d.from[0]} y1={d.from[1]} x2={d.to[0]} y2={d.to[1]} />
                ))}

                {/* La lista */}
                <At x={180} y={100} w={120} h={100} a="ch-core" style={{ background: C.card, borderRadius: 12, border: `1px solid ${primary(0.4)}`, overflow: 'hidden', boxShadow: `0 16px 34px -14px ${primary(0.45)}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 9px', background: primary(0.1), borderBottom: `1px solid ${C.border}` }}>
                        <Table2 size={10} color={primary()} />
                        <T size={8.5} weight={800}>
                            Inventario
                        </T>
                    </div>
                    <div style={{ padding: '4px 9px', display: 'flex', flexDirection: 'column' }}>
                        {(
                            [
                                ['Mazda 3 · 2021', '$ 72 M'],
                                ['Kia Picanto · 2020', '$ 41 M'],
                                ['Renault Duster', '$ 63 M'],
                            ] as const
                        ).map(([a, b], i) => (
                            <span key={a} style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: i < 2 ? `1px solid ${C.border}` : 'none' }}>
                                <T size={7}>{a}</T>
                                <T size={7} weight={700}>
                                    {b}
                                </T>
                            </span>
                        ))}
                    </div>
                </At>

                {DEST.map((d, i) => (
                    <At key={i} x={d.from[0] - 4} y={d.from[1] - 4} w={8} h={8} a={`ch-p${i}`} style={{ opacity: 0, borderRadius: 99, background: tone(d.t), boxShadow: `0 0 0 3px ${tone(d.t, 0.25)}`, zIndex: 5 }} />
                ))}

                <Dest i={0} title="Página pública" icon={<Globe size={10} />}>
                    <span style={{ borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        {['Mazda 3 · 2021', 'Kia Picanto · 2020', 'Renault Duster'].map((r, j) => (
                            <span key={r} style={{ height: 15, display: 'flex', alignItems: 'center', padding: '0 5px', borderBottom: j < 2 ? `1px solid ${C.border}` : 'none' }}>
                                <T size={6.5}>{r}</T>
                            </span>
                        ))}
                    </span>
                    <T size={6} color={C.mutedFg}>
                        Cualquiera con el enlace · sólo ver
                    </T>
                </Dest>

                <Dest i={1} title="Tablero por correo" icon={<LayoutDashboard size={10} />}>
                    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 34, padding: '0 2px' }}>
                        {[14, 22, 18, 30, 26, 34].map((h, j) => (
                            <span key={j} style={{ flex: 1, height: h, borderRadius: 3, background: tone('amber', 0.25 + j * 0.12) }} />
                        ))}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Mail size={8} color={C.mutedFg} />
                        <T size={6} color={C.mutedFg}>
                            A los socios, cada lunes 7:00
                        </T>
                    </span>
                </Dest>

                <Dest i={2} title="Portal de clientes" icon={<AppWindow size={10} />}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Avatar initials="LM" t="cyan" size={18} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={7} weight={700}>
                                Hola, Laura
                            </T>
                            <T size={6} color={C.mutedFg}>
                                Tu carro: Kia Picanto
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 6, background: tone('cyan', 0.1), padding: '4px 6px' }}>
                        <T size={6.5} color={C.mutedFg}>
                            Saldo pendiente
                        </T>
                        <T size={7.5} weight={800} color={tone('cyan')}>
                            $ 850.000
                        </T>
                    </span>
                    <T size={6} color={C.mutedFg}>
                        Cada cliente ve sólo lo suyo
                    </T>
                </Dest>

                <Dest i={3} title="Invitado" icon={<UserPlus size={10} />}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Avatar initials="TA" t="mint" size={18} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={7} weight={700}>
                                Taller Aliado
                            </T>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                <MessageSquare size={7} color={tone('mint')} />
                                <T size={6} color={tone('mint')} weight={700}>
                                    Puede comentar
                                </T>
                            </span>
                        </span>
                    </span>
                    <span style={{ alignSelf: 'flex-start', borderRadius: 8, borderTopLeftRadius: 2, background: tone('mint', 0.14), padding: '4px 6px' }}>
                        <T size={6.5} style={{ whiteSpace: 'normal' }}>Revisión del Mazda lista.</T>
                    </span>
                    <T size={6} color={C.mutedFg}>
                        Entra sólo a lo compartido
                    </T>
                </Dest>
            </At>
        </Stage>
    );
}
