import { CalendarCheck, Link2, Scissors } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/** Dónde vive la agenda: insertada en la página web de la empresa y como enlace en la biografía de Instagram. */

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const HOURS = ['9:00', '9:40', '10:20', '11:00', '11:40', '12:20'];

const CSS = `
@keyframes cb-widget{0%,4%{opacity:0;transform:translateY(10px)}12%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cb-cursor{0%,12%{transform:translate(250px,290px);opacity:0}16%{opacity:1}24%,28%{transform:translate(270px,186px);opacity:1}38%{transform:translate(372px,140px);opacity:1}44%,48%{transform:translate(378px,134px);opacity:1}56%,100%{transform:translate(378px,134px);opacity:0}}
@keyframes cb-ring{0%,24%{opacity:0;transform:scale(.4)}26%{opacity:1;transform:scale(1)}30%{opacity:0;transform:scale(1.6)}44%{opacity:0;transform:scale(.4)}46%{opacity:1;transform:scale(1)}50%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cb-hour{0%,25%{background:transparent;box-shadow:0 0 0 1px ${C.border}}27%,92%{background:${tone('amber')};box-shadow:0 0 0 1px ${tone('amber')}}97%,100%{background:transparent;box-shadow:0 0 0 1px ${C.border}}}
@keyframes cb-hourt{0%,25%{color:${C.fg}}27%,92%{color:#fff}97%,100%{color:${C.fg}}}
@keyframes cb-bio{0%,46%{opacity:1}50%,94%{opacity:0}100%{opacity:1}}
@keyframes cb-open{0%,47%{opacity:0;transform:translateY(16px)}53%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(16px)}}
@keyframes cb-pulse{0%,30%{box-shadow:0 0 0 0 ${tone('rose', 0.5)}}36%{box-shadow:0 0 0 5px ${tone('rose', 0)}}40%,100%{box-shadow:0 0 0 0 transparent}}
`;

function MiniAgenda({ w }: { w: number }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5, width: w }}>
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {DAYS.map((d, i) => (
                    <T key={i} size={6} color={C.mutedFg} style={{ textAlign: 'center' }}>
                        {d}
                    </T>
                ))}
                {Array.from({ length: 14 }, (_, i) => {
                    const n = 20 + i;
                    const sel = n === 29;
                    const off = i % 7 >= 6 || n > 31;
                    return (
                        <span
                            key={i}
                            style={{ height: 14, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? tone('amber') : 'transparent', fontWeight: off ? 400 : 700, opacity: off ? 0.35 : 1 }}
                        >
                            <T size={6.5} weight={off ? 400 : 700} color={sel ? '#fff' : C.fg}>
                                {n > 31 ? n - 31 : n}
                            </T>
                        </span>
                    );
                })}
            </span>
        </span>
    );
}

export default function CitasEmbed(): JSX.Element {
    return (
        <Stage label="La agenda insertada en la página web de la barbería, donde el cliente elige día y hora, y el enlace en la biografía de Instagram que abre la misma agenda en el teléfono." tint="amber">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* La página web */}
                <Win x={16} y={22} w={296} h={256} title="barberiaelclasico.mx">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Scissors size={9} />
                        </span>
                        <T size={8.5} weight={800}>
                            El Clásico
                        </T>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                            {['Servicios', 'Barberos', 'Agenda'].map((l) => (
                                <T key={l} size={7} color={C.mutedFg}>
                                    {l}
                                </T>
                            ))}
                        </span>
                    </div>
                    <At x={12} y={44} w={96} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={12} weight={800} style={{ whiteSpace: 'normal', lineHeight: 1.15 }}>
                            Reserva tu turno
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Elige servicio, barbero y hora. Sin llamar.
                        </T>
                        <Bar w={84} h={5} />
                        <Bar w={70} h={5} />
                    </At>
                    {/* La agenda insertada */}
                    <At
                        x={118}
                        y={40}
                        w={168}
                        h={152}
                        a="cb-widget"
                        style={{ borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden', boxShadow: '0 8px 20px -12px rgba(15,23,42,.4)' }}
                    >
                        <div style={{ height: 3, background: tone('amber') }} />
                        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CalendarCheck size={9} color={tone('amber')} />
                                <T size={8} weight={800}>
                                    Corte · 40 min
                                </T>
                            </span>
                            <MiniAgenda w={150} />
                            <T size={6.5} weight={700} color={C.mutedFg}>
                                miércoles 29 de octubre
                            </T>
                            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                                {HOURS.map((h) => (
                                    <span
                                        key={h}
                                        data-a={h === '10:20' ? '' : undefined}
                                        style={{
                                            height: 17,
                                            borderRadius: 5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxShadow: h === '10:20' ? `0 0 0 1px ${tone('amber')}` : `0 0 0 1px ${C.border}`,
                                            background: h === '10:20' ? tone('amber') : 'transparent',
                                            animationName: h === '10:20' ? 'cb-hour' : undefined,
                                        }}
                                    >
                                        <span data-a={h === '10:20' ? '' : undefined} style={{ fontSize: 7, fontWeight: 700, color: h === '10:20' ? '#fff' : C.fg, animationName: h === '10:20' ? 'cb-hourt' : undefined }}>
                                            {h}
                                        </span>
                                    </span>
                                ))}
                            </span>
                        </div>
                    </At>
                </Win>

                {/* Instagram */}
                <At x={330} y={18} w={136} h={266} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}>
                    <div style={{ position: 'absolute', left: 46, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={0} y={18} w={126} h={238} a="cb-bio" style={{ opacity: 0 }}>
                        <At x={10} y={10} w={106} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 34, height: 34, borderRadius: 99, padding: 2, background: `linear-gradient(135deg, ${tone('amber')}, ${tone('rose')}, ${tone('violet')})` }}>
                                <span style={{ width: 30, height: 30, borderRadius: 99, background: C.card, color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Scissors size={14} />
                                </span>
                            </span>
                            <span style={{ display: 'flex', gap: 8 }}>
                                {(
                                    [
                                        ['248', 'posts'],
                                        ['5,1 mil', 'seguidores'],
                                    ] as const
                                ).map(([n, l]) => (
                                    <span key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <T size={7.5} weight={800}>
                                            {n}
                                        </T>
                                        <T size={5.5} color={C.mutedFg}>
                                            {l}
                                        </T>
                                    </span>
                                ))}
                            </span>
                        </At>
                        <At x={10} y={52} w={106} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={7.5} weight={800}>
                                Barbería El Clásico
                            </T>
                            <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                Cortes clásicos y barba en Monterrey. Agenda en línea:
                            </T>
                            <span data-a="" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 6px', borderRadius: 99, background: tone('rose', 0.12), animationName: 'cb-pulse' }}>
                                <Link2 size={8} color={tone('rose')} />
                                <T size={6.5} weight={700} color={tone('rose')}>
                                    Agenda tu cita
                                </T>
                            </span>
                        </At>
                        <At x={6} y={112} w={114} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                            {Array.from({ length: 9 }, (_, i) => (
                                <span key={i} style={{ height: 36, background: i % 2 ? tone('amber', 0.25) : C.muted }} />
                            ))}
                        </At>
                    </At>
                    {/* La agenda abierta en el teléfono */}
                    <At x={0} y={18} w={126} h={238} a="cb-open" style={{ background: C.card }}>
                        <div style={{ height: 3, background: tone('amber') }} />
                        <At x={8} y={10} w={110} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <T size={8} weight={800}>
                                Barbería El Clásico
                            </T>
                            {['Corte · 40 min', 'Barba · 20 min', 'Corte y barba · 1 h'].map((s, i) => (
                                <span key={s} style={{ height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 6px', boxShadow: i === 0 ? `0 0 0 1.5px ${tone('amber')}` : `0 0 0 1px ${C.border}` }}>
                                    <T size={7} weight={600}>
                                        {s}
                                    </T>
                                </span>
                            ))}
                            <MiniAgenda w={110} />
                        </At>
                    </At>
                </At>
                <Cursor a="cb-cursor" click="cb-ring" rest={[378, 134]} />
            </At>
        </Stage>
    );
}
