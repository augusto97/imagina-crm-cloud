import { Check, SeparatorHorizontal } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Formulario por pasos: tres páginas con barra de progreso, Anterior y Siguiente; a la izquierda, los saltos de página. */

const CSS = `
@keyframes fp-cursor{0%{transform:translate(330px,290px);opacity:0}6%{opacity:1}22%,27%{transform:translate(404px,238px)}52%,57%{transform:translate(404px,238px)}74%,79%{transform:translate(404px,238px);opacity:1}86%,100%{transform:translate(404px,238px);opacity:0}}
@keyframes fp-ring{0%,24%{opacity:0;transform:scale(.4)}26%{opacity:1;transform:scale(1)}29%{opacity:0;transform:scale(1.6)}54%{opacity:0;transform:scale(.4)}56%{opacity:1;transform:scale(1)}59%{opacity:0;transform:scale(1.6)}76%{opacity:0;transform:scale(.4)}78%{opacity:1;transform:scale(1)}81%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fp-p1{0%,27%{opacity:1;transform:translateX(0)}31%,96%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:translateX(0)}}
@keyframes fp-p2{0%,28%{opacity:0;transform:translateX(14px)}32%,57%{opacity:1;transform:translateX(0)}61%,100%{opacity:0;transform:translateX(-14px)}}
@keyframes fp-p3{0%,58%{opacity:0;transform:translateX(14px)}62%,79%{opacity:1;transform:translateX(0)}83%,100%{opacity:0;transform:translateX(-14px)}}
@keyframes fp-done{0%,80%{opacity:0;transform:scale(.9)}85%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fp-chrome{0%,80%{opacity:1}83%,96%{opacity:0}100%{opacity:1}}
@keyframes fp-bar{0%,28%{width:33%}32%,58%{width:66%}62%,96%{width:100%}100%{width:33%}}
@keyframes fp-step{0%,28%{transform:translateY(0)}32%,58%{transform:translateY(-12px)}62%,96%{transform:translateY(-24px)}100%{transform:translateY(0)}}
@keyframes fp-prev{0%,28%{opacity:0}32%,80%{opacity:1}83%,96%{opacity:0}100%{opacity:0}}
@keyframes fp-next{0%,58%{opacity:1}62%,96%{opacity:0}100%{opacity:1}}
@keyframes fp-send{0%,58%{opacity:0}62%,80%{opacity:1}83%,100%{opacity:0}}
@keyframes fp-g1{0%,28%{opacity:1}32%,96%{opacity:0}100%{opacity:1}}
@keyframes fp-g2{0%,28%{opacity:0}32%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes fp-g3{0%,58%{opacity:0}62%,92%{opacity:1}97%,100%{opacity:0}}
`;

function Field({ label, value }: { label: string; value?: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={8} weight={700}>
                {label}
            </T>
            <span style={{ height: 19, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                {value && <T size={8}>{value}</T>}
            </span>
        </div>
    );
}

function Page({ a, title, children, base = 0 }: { a: string; title: string; children: React.ReactNode; base?: number }): JSX.Element {
    return (
        <At x={14} y={58} w={234} h={124} a={a} style={{ opacity: base, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <T size={10} weight={800}>
                {title}
            </T>
            {children}
        </At>
    );
}

const STRUCT: Array<{ label: string; page?: number }> = [
    { label: 'Nombre' },
    { label: 'Correo' },
    { label: 'Tu evento', page: 2 },
    { label: 'Fecha del evento' },
    { label: 'Personas' },
    { label: 'Menú', page: 3 },
    { label: 'Tipo de menú' },
    { label: 'Comentarios' },
];

export default function FormPages(): JSX.Element {
    return (
        <Stage label="Un formulario por pasos: la persona completa la página 1, toca Siguiente, completa la 2 y la 3 y envía; la barra de progreso avanza en cada paso." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* La estructura en el constructor */}
                <At
                    x={22}
                    y={45}
                    w={154}
                    h={206}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)', overflow: 'hidden' }}
                >
                    <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700}>
                            Preguntas (8)
                        </T>
                    </div>
                    {/* Resaltado de la página actual */}
                    <At x={4} y={31} w={146} h={46} a="fp-g1" style={{ borderRadius: 6, background: primary(0.1), opacity: 0 }} />
                    <At x={4} y={87} w={146} h={51} a="fp-g2" style={{ borderRadius: 6, background: primary(0.1), opacity: 0 }} />
                    <At x={4} y={144} w={146} h={53} a="fp-g3" style={{ borderRadius: 6, background: primary(0.1) }} />
                    <At x={6} y={32} w={142} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em', padding: '0 4px' }}>
                            PÁGINA 1
                        </T>
                        {STRUCT.map((s) =>
                            s.page ? (
                                <span
                                    key={s.label}
                                    style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, padding: '3px 4px', borderRadius: 5, border: `1px dashed ${C.border}`, background: C.muted }}
                                >
                                    <SeparatorHorizontal size={8} color={C.mutedFg} />
                                    <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.04em' }}>
                                        PÁGINA {s.page}
                                    </T>
                                    <T size={7.5} color={C.mutedFg}>
                                        · {s.label}
                                    </T>
                                </span>
                            ) : (
                                <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '1px 4px' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, border: `1px solid ${C.mutedFg}`, opacity: 0.6 }} />
                                    <T size={8}>{s.label}</T>
                                </span>
                            ),
                        )}
                    </At>
                </At>

                {/* La página pública */}
                <At
                    x={196}
                    y={37}
                    w={262}
                    h={226}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -14px rgba(15,23,42,.4)', overflow: 'hidden' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={14} y={14} w={234} a="fp-chrome">
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <T size={11.5} weight={800}>
                                Cotiza tu evento
                            </T>
                            <span style={{ position: 'relative', height: 10, width: 60, overflow: 'hidden', display: 'block' }}>
                                <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', flexDirection: 'column', animationName: 'fp-step', transform: 'translateY(-24px)' }}>
                                    {[1, 2, 3].map((n) => (
                                        <T key={n} size={7.5} color={C.mutedFg} style={{ height: 12, lineHeight: '10px', textAlign: 'right' }}>
                                            Paso {n} de 3
                                        </T>
                                    ))}
                                </span>
                            </span>
                        </span>
                        <span style={{ display: 'block', marginTop: 9, height: 5, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'block', height: '100%', width: '100%', borderRadius: 99, background: primary(), animationName: 'fp-bar' }} />
                        </span>
                    </At>
                    <Page a="fp-p1" title="Tus datos">
                        <Field label="Nombre" value="Mariana Ríos" />
                        <Field label="Correo" value="mariana@correo.com" />
                    </Page>
                    <Page a="fp-p2" title="Tu evento">
                        <Field label="Fecha del evento" value="14/12/2026" />
                        <Field label="Número de personas" value="80" />
                    </Page>
                    <Page a="fp-p3" title="Menú" base={1}>
                        <T size={8} weight={700}>
                            Tipo de menú
                        </T>
                        {['Buffet', 'Plato servido'].map((o, i) => (
                            <span
                                key={o}
                                style={{
                                    height: 20,
                                    borderRadius: 5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '0 7px',
                                    boxShadow: i === 0 ? `0 0 0 1.5px ${primary()}` : `0 0 0 1px ${C.border}`,
                                    background: i === 0 ? primary(0.08) : C.card,
                                }}
                            >
                                <span style={{ width: 8, height: 8, borderRadius: 99, border: `1.5px solid ${i === 0 ? primary() : C.mutedFg}`, background: i === 0 ? primary() : 'transparent', boxShadow: `inset 0 0 0 1.5px ${C.card}` }} />
                                <T size={8}>{o}</T>
                            </span>
                        ))}
                    </Page>
                    {/* Botones */}
                    <At x={14} y={190} w={234} h={22} a="fp-chrome" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span data-a="" style={{ opacity: 1, height: 22, padding: '0 12px', borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', animationName: 'fp-prev' }}>
                            <T size={8.5} weight={600}>
                                Anterior
                            </T>
                        </span>
                        <span style={{ position: 'relative', width: 80, height: 22 }}>
                            <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, animationName: 'fp-next' }}>
                                <T size={8.5} weight={700} color={C.primaryFg}>
                                    Siguiente
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 1, animationName: 'fp-send' }}>
                                <T size={8.5} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </span>
                    </At>
                    {/* Gracias */}
                    <At x={0} y={62} w={262} a="fp-done" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 99, background: tone('mint', 0.18), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={19} strokeWidth={3} />
                        </span>
                        <T size={12} weight={800}>
                            ¡Gracias!
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Te enviamos la cotización en 24 horas.
                        </T>
                    </At>
                </At>
                <Cursor a="fp-cursor" click="fp-ring" rest={[404, 238]} />
            </At>
        </Stage>
    );
}
