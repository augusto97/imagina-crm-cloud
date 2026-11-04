import { CalendarDays, Palette } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.354 — Diseño de la página de la agenda: se elige la plantilla
 * «Tarjetas» (los servicios pasan de lista a tarjetas, con el color de la
 * plantilla) y después se apaga «El precio de cada servicio».
 */

const CSS = `
@keyframes ad-p1{0%,30%{opacity:1}34%,96%{opacity:0}100%{opacity:1}}
@keyframes ad-p2{0%,30%{opacity:0}34%,63%{opacity:1}67%,100%{opacity:0}}
@keyframes ad-p3{0%,63%{opacity:0}67%,96%{opacity:1}100%{opacity:0}}
@keyframes ad-s1{0%,30%{box-shadow:0 0 0 2px ${primary()}}34%,96%{box-shadow:0 0 0 1px ${C.border}}100%{box-shadow:0 0 0 2px ${primary()}}}
@keyframes ad-s2{0%,30%{box-shadow:0 0 0 1px ${C.border}}34%,96%{box-shadow:0 0 0 2px ${tone('violet')}}100%{box-shadow:0 0 0 1px ${C.border}}}
@keyframes ad-on{0%,63%{background:${primary()}}67%,96%{background:${C.border}}100%{background:${primary()}}}
@keyframes ad-knob{0%,63%{transform:translateX(9px)}67%,96%{transform:translateX(0)}100%{transform:translateX(9px)}}
@keyframes ad-cur{0%,30%{transform:translate(118px,62px)}34%,63%{transform:translate(118px,112px)}67%,100%{transform:translate(152px,191px)}}
@keyframes ad-ring{0%,1%{opacity:0;transform:scale(.4)}3%{opacity:1;transform:scale(1)}8%,33%{opacity:0;transform:scale(1.6)}35%{opacity:1;transform:scale(1)}40%,66%{opacity:0;transform:scale(1.6)}68%{opacity:1;transform:scale(1)}73%,100%{opacity:0;transform:scale(1.6)}}
`;

const SERVICES = [
    { name: 'Consulta', meta: '30 min', price: '$80.000' },
    { name: 'Limpieza', meta: '45 min', price: '$120.000' },
    { name: 'Control', meta: '20 min', price: '$50.000' },
];

function Page({ a, cards, prices }: { a: string; cards: boolean; prices: boolean }): JSX.Element {
    const accent = cards ? tone('violet') : primary();
    return (
        <At x={0} y={0} w={262} h={252} a={a} style={{ opacity: 0, background: cards ? tone('violet', 0.1) : '#f4f5f7', borderRadius: 12, padding: 14 }}>
            <div style={{ background: '#ffffff', borderRadius: cards ? 16 : 10, overflow: 'hidden', boxShadow: '0 12px 28px -14px rgba(15,23,42,.45)', height: 224 }}>
                <div style={{ height: 4, background: accent }} />
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={6.5} color="#6b7280">
                        Sonríe · Odontología
                    </T>
                    <T size={12} weight={800} color="#1f2933">
                        Agenda tu cita
                    </T>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <T size={8} weight={700} color="#1f2933">
                            Elige el servicio
                        </T>
                        <T size={6.5} color="#6b7280">
                            Paso 1 de 3
                        </T>
                    </span>
                    {cards ? (
                        <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                            {SERVICES.map((s) => (
                                <span key={s.name} style={{ border: '1px solid #e2e5ea', borderRadius: 10, padding: '9px 7px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 74 }}>
                                    {prices ? (
                                        <T size={7} weight={800} color={accent}>
                                            {s.price}
                                        </T>
                                    ) : null}
                                    <T size={8} weight={800} color="#1f2933">
                                        {s.name}
                                    </T>
                                    <T size={6.5} color="#6b7280">
                                        {s.meta}
                                    </T>
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {SERVICES.map((s) => (
                                <span key={s.name} style={{ border: '1px solid #e2e5ea', borderRadius: 7, padding: '6px 9px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <T size={8} weight={800} color="#1f2933">
                                            {s.name}
                                        </T>
                                        <T size={6.5} color="#6b7280">
                                            {s.meta}
                                        </T>
                                    </span>
                                    <T size={7} color="#6b7280">
                                        {s.price}
                                    </T>
                                </span>
                            ))}
                        </span>
                    )}
                </div>
            </div>
        </At>
    );
}

function Swatch({ y, a, name, color, cards }: { y: number; a: string; name: string; color: string; cards: boolean }): JSX.Element {
    return (
        <At x={14} y={y} w={150} h={40} a={a} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 8, background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}>
            <span style={{ width: 34, height: 26, borderRadius: 5, background: '#f4f5f7', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {cards ? (
                    [0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 12, borderRadius: 2, background: '#fff', boxShadow: `0 0 0 1px ${color}` }} />)
                ) : (
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{ width: 22, height: 4, borderRadius: 1, background: '#fff', boxShadow: `0 0 0 1px ${color}` }} />
                        ))}
                    </span>
                )}
            </span>
            <T size={8.5} weight={700}>
                {name}
            </T>
        </At>
    );
}

export default function AgendaDiseno(): JSX.Element {
    return (
        <Stage
            label="El diseño de la página de la agenda: al elegir la plantilla Tarjetas los servicios pasan de una lista a tarjetas con el color de la plantilla, y al apagar «El precio de cada servicio» los precios dejan de verse."
            cycle={10}
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Panel de diseño */}
                <At x={20} y={24} w={178} h={252} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}>
                    <At x={14} y={14} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Palette size={10} color={primary()} />
                        <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            PLANTILLAS
                        </T>
                    </At>
                    <Swatch y={38} a="ad-s1" name="Clásico" color={primary()} cards={false} />
                    <Swatch y={88} a="ad-s2" name="Tarjetas" color={tone('violet')} cards />
                    <At x={14} y={146} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarDays size={10} color={C.mutedFg} />
                        <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            MOSTRAR U OCULTAR
                        </T>
                    </At>
                    {[
                        { y: 166, label: 'Las fotos de quienes atienden', anim: false },
                        { y: 184, label: 'El precio de cada servicio', anim: true },
                        { y: 202, label: 'Dónde es la cita', anim: false },
                    ].map((r) => (
                        <At key={r.label} x={14} y={r.y} w={150} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <T size={6.8} color={C.fg}>
                                {r.label}
                            </T>
                            <span data-a={r.anim ? '' : undefined} style={{ width: 20, height: 11, borderRadius: 99, background: primary(), position: 'relative', flex: 'none', animationName: r.anim ? 'ad-on' : undefined }}>
                                <span
                                    data-a={r.anim ? '' : undefined}
                                    style={{ position: 'absolute', left: 1.5, top: 1.5, width: 8, height: 8, borderRadius: 99, background: '#fff', transform: 'translateX(9px)', animationName: r.anim ? 'ad-knob' : undefined }}
                                />
                            </span>
                        </At>
                    ))}
                    <Cursor a="ad-cur" click="ad-ring" rest={[152, 191]} />
                </At>

                {/* Vista previa */}
                <At x={204} y={24} w={262} h={252}>
                    <Page a="ad-p1" cards={false} prices />
                    <Page a="ad-p2" cards prices />
                    <Page a="ad-p3" cards prices={false} />
                </At>
            </At>
        </Stage>
    );
}
