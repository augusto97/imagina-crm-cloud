import { Clock, Users } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.349 — Un servicio grupal con varias duraciones: el cliente elige 30 min
 * o 1 h, elige con quién (foto y cargo) y los cupos del horario bajan con cada
 * reserva hasta que el horario se llena y desaparece.
 */

const CSS = `
@keyframes cc-dur{0%,14%{background:transparent;color:${C.fg}}20%,92%{background:${primary()};color:${C.primaryFg}}97%,100%{background:transparent;color:${C.fg}}}
@keyframes cc-dur-off{0%,14%{background:${primary()};color:${C.primaryFg}}20%,92%{background:transparent;color:${C.fg}}97%,100%{background:${primary()};color:${C.primaryFg}}}
@keyframes cc-pick{0%,30%{box-shadow:0 0 0 1px ${C.border}}36%,92%{box-shadow:0 0 0 2px ${primary()}}97%,100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes cc-n3{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes cc-n2{0%,44%{opacity:0}48%,60%{opacity:1}64%,100%{opacity:0}}
@keyframes cc-n1{0%,60%{opacity:0}64%,76%{opacity:1}80%,100%{opacity:0}}
@keyframes cc-full{0%,76%{opacity:1;max-height:24px}82%,94%{opacity:0;max-height:0}100%{opacity:1;max-height:24px}}
@keyframes cc-person{0%,40%{opacity:0;transform:translateX(-8px)}46%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

const PEOPLE = [
    { n: 'Ana', c: 'mint' as const, d: 0 },
    { n: 'Luis', c: 'blue' as const, d: 0.12 },
    { n: 'Sofía', c: 'amber' as const, d: 0.24 },
];

export default function CitasCupos(): JSX.Element {
    return (
        <Stage
            label="Un taller grupal: el cliente elige la duración y con quién, y en cada horario se ve cuántos cupos quedan. Con cada reserva bajan los cupos y, al llenarse, el horario deja de ofrecerse."
            tint="rose"
            cycle={8}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El servicio */}
                <At x={16} y={36} w={150} h={228} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <T size={8.5} weight={800}>
                        Taller de cerámica
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Users size={10} color={tone('rose')} />
                        <T size={7} color={C.mutedFg}>
                            Grupal · hasta 3 personas
                        </T>
                    </span>
                    <T size={7} weight={700}>
                        Duración
                    </T>
                    <span style={{ display: 'flex', gap: 5 }}>
                        <span data-a="" style={{ borderRadius: 99, border: `1px solid ${C.border}`, padding: '4px 9px', animationName: 'cc-dur-off' }}>
                            <T size={7.5} weight={700} color="inherit">
                                30 min
                            </T>
                        </span>
                        <span data-a="" style={{ borderRadius: 99, border: `1px solid ${C.border}`, padding: '4px 9px', animationName: 'cc-dur' }}>
                            <T size={7.5} weight={700} color="inherit">
                                1 h
                            </T>
                        </span>
                    </span>
                    <T size={7} weight={700} style={{ marginTop: 4 }}>
                        ¿Con quién?
                    </T>
                    {[
                        { n: 'Mariana Ruiz', r: 'Ceramista', c: 'violet' as const, i: 'MR' },
                        { n: 'Taller 2', r: 'Sala con horno', c: 'blue' as const, i: 'T2' },
                    ].map((p, idx) => (
                        <span
                            key={p.n}
                            data-a=""
                            style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: 4, boxShadow: `0 0 0 1px ${C.border}`, animationName: idx === 0 ? 'cc-pick' : undefined }}
                        >
                            <span
                                style={{ width: 22, height: 22, borderRadius: 99, background: tone(p.c, 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                            >
                                <T size={7} weight={800} color={tone(p.c)}>
                                    {p.i}
                                </T>
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <T size={7.5} weight={700}>
                                    {p.n}
                                </T>
                                <T size={6.5} color={C.mutedFg}>
                                    {p.r}
                                </T>
                            </span>
                        </span>
                    ))}
                </At>

                {/* Los horarios con sus cupos */}
                <At x={178} y={36} w={140} h={228} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={11} color={primary()} />
                        <T size={8.5} weight={800}>
                            Sábado 14
                        </T>
                    </span>
                    <span data-a="" style={{ overflow: 'hidden', animationName: 'cc-full' }}>
                        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 24, borderRadius: 6, boxShadow: `0 0 0 1.5px ${tone('mint')}`, padding: '0 8px' }}>
                            <T size={8} weight={700}>
                                9:00
                            </T>
                            <span style={{ position: 'relative', width: 40, height: 10 }}>
                                {[
                                    ['3 cupos', 'cc-n3'],
                                    ['2 cupos', 'cc-n2'],
                                    ['1 cupo', 'cc-n1'],
                                ].map(([t, a]) => (
                                    <span key={t} data-a="" style={{ position: 'absolute', right: 0, top: 0, animationName: a }}>
                                        <T size={7} weight={700} color={tone('rose')}>
                                            {t}
                                        </T>
                                    </span>
                                ))}
                            </span>
                        </span>
                    </span>
                    {['10:00', '11:00', '15:00', '16:00'].map((t) => (
                        <span key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 24, borderRadius: 6, boxShadow: `0 0 0 1.5px ${tone('mint')}`, padding: '0 8px' }}>
                            <T size={8} weight={700}>
                                {t}
                            </T>
                            <T size={7} weight={700} color={tone('rose')}>
                                3 cupos
                            </T>
                        </span>
                    ))}
                </At>

                {/* Quienes reservaron */}
                <At x={330} y={36} w={134} h={228} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={8.5} weight={800}>
                        Sábado 14 · 9:00
                    </T>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Cada reserva es un registro de la lista.
                    </T>
                    {PEOPLE.map((p, i) => (
                        <span
                            key={p.n}
                            data-a=""
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                borderRadius: 8,
                                background: tone(p.c, 0.1),
                                padding: '5px 6px',
                                animationName: 'cc-person',
                                animationDelay: `${0.65 * i}s`,
                            }}
                        >
                            <span style={{ width: 16, height: 16, borderRadius: 99, background: tone(p.c, 0.3) }} />
                            <T size={7.5} weight={700}>
                                {p.n}
                            </T>
                            <T size={6.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                                Confirmada
                            </T>
                        </span>
                    ))}
                    <span style={{ marginTop: 'auto', borderRadius: 99, background: tone('rose', 0.12), padding: '5px 8px', textAlign: 'center' }}>
                        <T size={7} weight={700} color={tone('rose')}>
                            Lleno: ya no se ofrece
                        </T>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
