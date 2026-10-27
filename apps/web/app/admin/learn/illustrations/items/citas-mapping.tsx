import { CalendarCheck, Table2 } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Flow, Keyframes, Stage, T, primary, tone } from '../kit';

/** Lo que el cliente agenda queda como un registro de la lista: cada dato cae en el campo que elegiste en «Campos de la lista». */

const ROWS: Array<{ l: string; v: string; kind?: 'chip' | 'person' | 'status' }> = [
    { l: 'Nombre del cliente', v: 'María Gómez' },
    { l: 'Correo del cliente', v: 'maria.gomez@correo.com' },
    { l: 'Teléfono del cliente', v: '+57 300 123 4567' },
    { l: 'Inicio de la cita', v: '29/10/2026 10:30' },
    { l: 'Duración', v: '45 min' },
    { l: 'Servicio', v: 'Limpieza dental', kind: 'chip' },
    { l: 'Quién atiende', v: 'Paula Ríos', kind: 'person' },
    { l: 'Estado', v: 'Confirmada', kind: 'status' },
];

const CSS = `
@keyframes cm-cursor{0%{transform:translate(120px,290px);opacity:0}5%{opacity:1}13%,18%{transform:translate(104px,250px);opacity:1}26%,100%{transform:translate(104px,250px);opacity:0}}
@keyframes cm-ring{0%,14%{opacity:0;transform:scale(.4)}16%{opacity:1;transform:scale(1)}20%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cm-btn{0%,15%{transform:scale(1)}16%{transform:scale(.95)}18%,100%{transform:scale(1)}}
@keyframes cm-flow{0%,18%{opacity:0}22%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cm-rec{0%,18%{opacity:0;transform:translateX(12px)}24%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(12px)}}
${ROWS.map((_, i) => `@keyframes cm-v${i}{0%,${26 + i * 4}%{opacity:0;transform:translateX(-6px)}${30 + i * 4}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}`).join('\n')}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

export default function CitasMapping(): JSX.Element {
    return (
        <Stage label="El cliente confirma su cita y queda como un registro de la lista Citas: nombre, correo, teléfono, inicio, duración, servicio y quién atiende caen en sus campos, con el estado Confirmada." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Lo que confirma el cliente */}
                <At x={16} y={30} w={172} h={244} style={{ ...card, padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarCheck size={11} color={tone('rose')} />
                        <T size={9} weight={800}>
                            Confirma tu cita
                        </T>
                    </span>
                    <span style={{ borderRadius: 8, background: tone('rose', 0.1), padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8} weight={700}>
                            Limpieza dental · 45 min
                        </T>
                        <T size={7} color={C.mutedFg}>
                            miércoles 29 de octubre · 10:30 a. m.
                        </T>
                        <T size={7} color={C.mutedFg}>
                            Con Paula Ríos
                        </T>
                    </span>
                    {(
                        [
                            ['Nombre', 'María Gómez'],
                            ['Correo', 'maria.gomez@correo.com'],
                            ['Celular', '+57 300 123 4567'],
                        ] as const
                    ).map(([l, v]) => (
                        <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={6.5} weight={700} color={C.mutedFg}>
                                {l}
                            </T>
                            <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                                <T size={7.5}>{v}</T>
                            </span>
                        </span>
                    ))}
                    <span data-a="" style={{ marginTop: 'auto', height: 24, borderRadius: 6, background: tone('rose'), display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'cm-btn' }}>
                        <T size={8.5} weight={700} color="#fff">
                            Confirmar cita
                        </T>
                    </span>
                </At>

                <Flow x1={190} y1={92} x2={214} y2={98} a="cm-flow" />
                <Flow x1={190} y1={150} x2={214} y2={150} a="cm-flow" />
                <Flow x1={190} y1={208} x2={214} y2={204} a="cm-flow" />

                {/* El registro en la lista */}
                <At x={216} y={22} w={248} h={256} a="cm-rec" style={{ ...card, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px', borderBottom: `1px solid ${C.border}`, background: primary(0.06) }}>
                        <Table2 size={10} color={primary()} />
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Citas
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            ›
                        </T>
                        <T size={8.5} weight={800}>
                            María Gómez
                        </T>
                    </div>
                    <div style={{ padding: '4px 11px', display: 'flex', flexDirection: 'column' }}>
                        {ROWS.map((r, i) => (
                            <span key={r.l} style={{ height: 26, display: 'flex', alignItems: 'center', gap: 8, borderBottom: i < ROWS.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                                <T size={7} color={C.mutedFg} style={{ width: 86 }}>
                                    {r.l}
                                </T>
                                <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, animationName: `cm-v${i}` }}>
                                    {r.kind === 'chip' ? (
                                        <Chip label={r.v} t="violet" style={{ height: 15, fontSize: 7, padding: '0 6px' }} />
                                    ) : r.kind === 'status' ? (
                                        <Chip label={r.v} t="mint" style={{ height: 15, fontSize: 7, padding: '0 6px' }} />
                                    ) : r.kind === 'person' ? (
                                        <>
                                            <Avatar initials="PR" t="amber" size={15} />
                                            <T size={7.5} weight={600}>
                                                {r.v}
                                            </T>
                                        </>
                                    ) : (
                                        <T size={7.5} weight={600}>
                                            {r.v}
                                        </T>
                                    )}
                                </span>
                            </span>
                        ))}
                    </div>
                </At>
                <Cursor a="cm-cursor" click="cm-ring" rest={[104, 250]} />
            </At>
        </Stage>
    );
}
