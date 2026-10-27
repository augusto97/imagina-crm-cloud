import { CalendarPlus, Check, ChevronLeft, ChevronRight } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** La agenda de citas: el cliente elige el servicio, el día y la hora; la cita aparece confirmada en el calendario del equipo. */

const CSS = `
@keyframes ch-cursor{0%{transform:translate(200px,290px);opacity:0}5%{opacity:1}12%,16%{transform:translate(100px,99px);opacity:1}28%,32%{transform:translate(110px,138px);opacity:1}40%,44%{transform:translate(212px,162px);opacity:1}62%,66%{transform:translate(143px,239px);opacity:1}76%,100%{transform:translate(143px,239px);opacity:0}}
@keyframes ch-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}34%{opacity:0;transform:scale(1.6)}41%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}46%{opacity:0;transform:scale(1.6)}63%{opacity:0;transform:scale(.4)}65%{opacity:1;transform:scale(1)}68%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ch-s1{0%,18%{opacity:1;transform:translateX(0)}22%,96%{opacity:0;transform:translateX(-12px)}100%{opacity:1;transform:translateX(0)}}
@keyframes ch-s2{0%,18%{opacity:0;transform:translateX(12px)}22%,48%{opacity:1;transform:translateX(0)}52%,100%{opacity:0;transform:translateX(-12px)}}
@keyframes ch-s3{0%,48%{opacity:0;transform:translateX(12px)}52%,67%{opacity:1;transform:translateX(0)}71%,100%{opacity:0;transform:translateX(-12px)}}
@keyframes ch-s4{0%,68%{opacity:0;transform:scale(.94)}73%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ch-opt{0%,14%{box-shadow:0 0 0 1px ${C.border}}16%,100%{box-shadow:0 0 0 1.5px ${primary()}}}
@keyframes ch-day{0%,30%{background:${primary(0.14)};color:${C.fg}}32%,100%{background:${primary()};color:${C.primaryFg}}}
@keyframes ch-slots{0%,31%{opacity:0;transform:translateY(5px)}34%,100%{opacity:1;transform:translateY(0)}}
@keyframes ch-slot{0%,42%{background:${C.card};color:${C.fg};box-shadow:0 0 0 1px ${C.border}}44%,100%{background:${primary()};color:${C.primaryFg};box-shadow:0 0 0 1px ${primary()}}}
@keyframes ch-step{0%,20%{transform:translateY(0)}22%,50%{transform:translateY(-12px)}52%,96%{transform:translateY(-24px)}100%{transform:translateY(0)}}
@keyframes ch-new{0%,72%{opacity:0;transform:scale(.7)}77%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ch-glow{0%,74%{box-shadow:0 0 0 0 transparent}78%,86%{box-shadow:0 0 0 3px ${tone('rose', 0.35)}}92%,100%{box-shadow:0 0 0 0 transparent}}
`;

const DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi'];

export default function CitasHero(): JSX.Element {
    const avail = new Set([26, 27, 28, 29, 30]);
    return (
        <Stage label="En la página de la agenda, el cliente elige Consulta, el miércoles 28 a las 9:30 y confirma; la cita aparece confirmada en el calendario de la lista de citas." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Página pública */}
                <At
                    x={18}
                    y={20}
                    w={250}
                    h={262}
                    style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 16px 38px -16px rgba(15,23,42,.5)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={14} y={14} w={222} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <T size={12} weight={800}>
                            Agenda tu cita
                        </T>
                        <span style={{ position: 'relative', width: 54, height: 11, overflow: 'hidden', display: 'block' }}>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', flexDirection: 'column', transform: 'translateY(-24px)', animationName: 'ch-step' }}>
                                {[1, 2, 3].map((n) => (
                                    <T key={n} size={7.5} color={C.mutedFg} style={{ height: 12, lineHeight: '11px', textAlign: 'right' }}>
                                        Paso {n} de 3
                                    </T>
                                ))}
                            </span>
                        </span>
                    </At>
                    {/* Paso 1 */}
                    <At x={14} y={42} w={222} a="ch-s1" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={9.5} weight={800}>
                            Elige el servicio
                        </T>
                        {(
                            [
                                ['Consulta', '30 minutos'],
                                ['Control', '20 minutos'],
                                ['Tratamiento', '60 minutos'],
                            ] as const
                        ).map(([n, d], i) => (
                            <span
                                key={n}
                                data-a={i === 0 ? '' : undefined}
                                style={{ height: 34, borderRadius: 8, padding: '0 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, boxShadow: `0 0 0 1px ${C.border}`, animationName: i === 0 ? 'ch-opt' : undefined }}
                            >
                                <T size={8.5} weight={700}>
                                    {n}
                                </T>
                                <T size={7} color={C.mutedFg}>
                                    {d}
                                </T>
                            </span>
                        ))}
                    </At>
                    {/* Paso 2: día y hora */}
                    <At x={14} y={42} w={222} a="ch-s2" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={9.5} weight={800}>
                            Elige el día y la hora
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <ChevronLeft size={10} color={C.mutedFg} />
                            <T size={8} weight={700}>
                                Octubre de 2026
                            </T>
                            <ChevronRight size={10} color={C.mutedFg} />
                        </span>
                        <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center' }}>
                            {['LU', 'MA', 'MI', 'JU', 'VI', 'SÁ', 'DO'].map((d) => (
                                <T key={d} size={6.5} weight={700} color={C.mutedFg}>
                                    {d}
                                </T>
                            ))}
                            {Array.from({ length: 14 }, (_, k) => {
                                const day = 19 + k;
                                const ok = avail.has(day);
                                const sel = day === 28;
                                return (
                                    <span
                                        key={k}
                                        data-a={sel ? '' : undefined}
                                        style={{
                                            height: 18,
                                            borderRadius: 5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 7.5,
                                            fontWeight: ok ? 700 : 500,
                                            background: sel ? primary() : ok ? primary(0.14) : 'transparent',
                                            color: sel ? C.primaryFg : ok ? C.fg : C.mutedFg,
                                            opacity: day > 31 ? 0 : 1,
                                            animationName: sel ? 'ch-day' : undefined,
                                        }}
                                    >
                                        {day > 31 ? '' : day}
                                    </span>
                                );
                            })}
                        </span>
                        <span data-a="" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, animationName: 'ch-slots' }}>
                            {['8:00', '8:30', '9:00', '9:30', '10:00', '10:30', '11:00', '11:30'].map((h) => (
                                <span
                                    key={h}
                                    data-a={h === '9:30' ? '' : undefined}
                                    style={{
                                        width: 48,
                                        height: 18,
                                        borderRadius: 5,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 7.5,
                                        fontWeight: 600,
                                        boxShadow: `0 0 0 1px ${h === '9:30' ? primary() : C.border}`,
                                        background: h === '9:30' ? primary() : C.card,
                                        color: h === '9:30' ? C.primaryFg : C.fg,
                                        animationName: h === '9:30' ? 'ch-slot' : undefined,
                                    }}
                                >
                                    {h}
                                </span>
                            ))}
                        </span>
                    </At>
                    {/* Paso 3: datos */}
                    <At x={14} y={42} w={222} a="ch-s3" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={9.5} weight={800}>
                            Tus datos
                        </T>
                        <span style={{ borderRadius: 8, background: C.muted, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={7.5}>
                                <b>Consulta</b> · 30 min
                            </T>
                            <T size={7.5}>
                                <b>Miércoles 28 de octubre</b> · 9:30 a. m.
                            </T>
                        </span>
                        {(
                            [
                                ['Nombre', 'Ana Gómez'],
                                ['Correo', 'ana@gomez.co'],
                                ['Teléfono', '+57 310 455 2201'],
                            ] as const
                        ).map(([l, v]) => (
                            <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <T size={7} weight={700}>
                                    {l}
                                </T>
                                <span style={{ height: 17, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                                    <T size={7.5}>{v}</T>
                                </span>
                            </span>
                        ))}
                        <span style={{ marginTop: 3, height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8.5} weight={700} color={C.primaryFg}>
                                Confirmar cita
                            </T>
                        </span>
                    </At>
                    {/* Listo */}
                    <At x={14} y={58} w={222} a="ch-s4" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 40, height: 40, borderRadius: 99, background: tone('mint', 0.18), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={22} strokeWidth={3} />
                        </span>
                        <T size={11} weight={800}>
                            ¡Tu cita quedó agendada!
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center' }}>
                            Te enviamos la confirmación y los enlaces para cambiar o cancelar.
                        </T>
                        <span style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                            <CalendarPlus size={10} />
                            <T size={8} weight={600}>
                                Agregar a mi calendario
                            </T>
                        </span>
                    </At>
                </At>

                {/* Calendario del equipo */}
                <Win x={284} y={36} w={180} h={228} title="Citas · esta semana">
                    <div style={{ display: 'flex', paddingLeft: 26, borderBottom: `1px solid ${C.border}` }}>
                        {DAYS.map((d, i) => (
                            <T key={d} size={7} weight={700} color={i === 2 ? primary() : C.mutedFg} style={{ flex: 1, textAlign: 'center', padding: '5px 0' }}>
                                {d} {26 + i}
                            </T>
                        ))}
                    </div>
                    {[8, 9, 10, 11, 12].map((h, i) => (
                        <div key={h} style={{ position: 'absolute', left: 0, top: 22 + i * 36, width: 178, height: 36, borderBottom: `1px solid ${C.border}` }}>
                            <T size={6.5} color={C.mutedFg} style={{ position: 'absolute', left: 5, top: 3 }}>
                                {h}:00
                            </T>
                        </div>
                    ))}
                    {(
                        [
                            [0, 8.0, 0.5, 'violet'],
                            [1, 10.0, 1, 'cyan'],
                            [3, 9.0, 0.5, 'amber'],
                            [4, 11.0, 0.5, 'violet'],
                            [1, 8.5, 0.5, 'amber'],
                        ] as const
                    ).map(([d, h, dur, t], k) => (
                        <span
                            key={k}
                            style={{ position: 'absolute', left: 28 + d * 30, top: 22 + (h - 8) * 36 + 1, width: 27, height: dur * 36 - 2, borderRadius: 4, background: tone(t, 0.2), borderLeft: `2px solid ${tone(t)}` }}
                        />
                    ))}
                    <At x={88} y={22 + 1.5 * 36 + 1} w={29} h={16} a="ch-new" style={{ borderRadius: 4, background: tone('rose'), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 4, animationName: 'ch-glow' }} />
                        <T size={6} weight={800} color="#fff">
                            Ana
                        </T>
                    </At>
                    <At x={119} y={78} a="ch-new">
                        <Chip label="Confirmada" t="mint" style={{ height: 14, fontSize: 7.5, padding: '0 5px' }} />
                    </At>
                </Win>
                <Cursor a="ch-cursor" click="ch-ring" rest={[143, 239]} />
            </At>
        </Stage>
    );
}
