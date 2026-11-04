import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Estadísticas del formulario (v0.1.358): visitas, cuántos empiezan y
 * cuántos envían, la gráfica día por día, hasta dónde llegan y en qué
 * pregunta lo dejan.
 */

const BARS = [34, 52, 41, 66, 58, 80, 72, 48, 62, 90, 76, 84];
const FUNNEL = [
    { label: 'Lo vieron', pct: 100, value: '1.240' },
    { label: 'Empezaron a responder', pct: 49, value: '610' },
    { label: 'Llegaron al paso 2', pct: 38, value: '470' },
    { label: 'Lo enviaron', pct: 32, value: '402' },
];

const CSS = `
@keyframes fst-in{0%,4%{opacity:0;transform:translateY(6px)}12%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes fst-bar{0%,10%{transform:scaleY(0)}30%,94%{transform:scaleY(1)}99%,100%{transform:scaleY(0)}}
${FUNNEL.map(
    (_, i) =>
        `@keyframes fst-f${i}{0%,${30 + i * 6}%{transform:scaleX(0)}${44 + i * 6}%,94%{transform:scaleX(1)}99%,100%{transform:scaleX(0)}}`,
).join('\n')}
@keyframes fst-leave{0%,66%{opacity:0;transform:translateY(8px)}74%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes fst-hl{0%,72%{box-shadow:0 0 0 0 ${tone('rose', 0)}}78%{box-shadow:0 0 0 4px ${tone('rose', 0.25)}}86%,100%{box-shadow:0 0 0 0 ${tone('rose', 0)}}}
`;

const KPIS = [
    { label: 'Visitas', value: '1.240', sub: 'en 30 días' },
    { label: 'Empezaron', value: '610', sub: '49 % de las visitas' },
    { label: 'Enviaron', value: '402', sub: '66 % de los que empezaron' },
    { label: 'Tiempo', value: '2 min', sub: 'en promedio' },
];

export default function FormStats(): JSX.Element {
    return (
        <Stage
            label="Las estadísticas de un formulario: 1.240 visitas, 610 empezaron, 402 lo enviaron; una gráfica por día, el embudo de hasta dónde llegan y la pregunta donde más lo dejan."
            cycle={9}
            tint="cyan"
        >
            <Keyframes css={CSS} />
            <Win x={18} y={14} w={444} h={272} title="Estadísticas · Pide tu cotización">
                {/* KPIs */}
                {KPIS.map((k, i) => (
                    <At
                        key={k.label}
                        x={12 + i * 106}
                        y={10}
                        w={98}
                        h={50}
                        a="fst-in"
                        style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, animationDelay: `${i * 0.12}s` }}
                    >
                        <At x={8} y={7}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                                {k.label.toUpperCase()}
                            </T>
                        </At>
                        <At x={8} y={18}>
                            <T size={14} weight={800}>
                                {k.value}
                            </T>
                        </At>
                        <At x={8} y={37}>
                            <T size={6} color={C.mutedFg}>
                                {k.sub}
                            </T>
                        </At>
                    </At>
                ))}

                {/* Día por día */}
                <At x={12} y={72} w={200} h={160} style={{ borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <At x={8} y={8}>
                        <T size={7.5} weight={700}>
                            Día por día
                        </T>
                    </At>
                    {BARS.map((h, i) => (
                        <At
                            key={i}
                            x={12 + i * 15}
                            y={140 - h}
                            w={9}
                            h={h}
                            a="fst-bar"
                            style={{
                                borderRadius: '3px 3px 0 0',
                                background: i === 9 ? primary() : primary(0.45),
                                transformOrigin: 'bottom',
                                animationDelay: `${i * 0.04}s`,
                            }}
                        />
                    ))}
                    <At x={8} y={140} w={184} h={1} style={{ background: C.border }} />
                    <At x={8} y={145}>
                        <T size={6} color={C.mutedFg}>
                            Visitas · Enviados
                        </T>
                    </At>
                </At>

                {/* Embudo */}
                <At x={222} y={72} w={210} h={104} style={{ borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <At x={8} y={8}>
                        <T size={7.5} weight={700}>
                            Hasta dónde llegan
                        </T>
                    </At>
                    {FUNNEL.map((f, i) => (
                        <At key={f.label} x={8} y={24 + i * 19} w={194} h={16}>
                            <At x={0} y={0} w={194} h={16} style={{ borderRadius: 4, background: C.muted, overflow: 'hidden' }}>
                                <At
                                    x={0}
                                    y={0}
                                    w={(194 * f.pct) / 100}
                                    h={16}
                                    a={`fst-f${i}`}
                                    style={{ background: primary(0.22 + i * 0.12), transformOrigin: 'left' }}
                                />
                            </At>
                            <At x={6} y={3}>
                                <T size={6.8} weight={600}>
                                    {f.label}
                                </T>
                            </At>
                            <At x={150} y={3}>
                                <T size={6.8} weight={700}>
                                    {f.value} · {f.pct} %
                                </T>
                            </At>
                        </At>
                    ))}
                </At>

                {/* Dónde lo dejan */}
                <At
                    x={222}
                    y={184}
                    w={210}
                    h={48}
                    a="fst-leave"
                    style={{ borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}
                >
                    <At x={8} y={7}>
                        <T size={7.5} weight={700}>
                            Dónde lo dejan
                        </T>
                    </At>
                    <At x={8} y={22} w={194} h={18} a="fst-hl" style={{ borderRadius: 4, background: tone('rose', 0.12), display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <T size={7} weight={600}>
                            Tu teléfono
                        </T>
                        <T size={7} weight={800} color={tone('rose')} style={{ marginLeft: 'auto' }}>
                            84
                        </T>
                    </At>
                </At>
            </Win>
        </Stage>
    );
}
