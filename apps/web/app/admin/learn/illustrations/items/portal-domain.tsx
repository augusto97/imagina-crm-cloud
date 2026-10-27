import { CheckCircle2, Globe, Lock, Sparkles } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, tone } from '../kit';

/** Marca y dominio propio: el portal vive en la dirección de la empresa, con su logo y su color, y pide la autorización de datos la primera vez. */

const CSS = `
@keyframes pd-v1{0%,10%{opacity:0;transform:scale(.6)}15%,100%{opacity:1;transform:scale(1)}}
@keyframes pd-v2{0%,20%{opacity:0;transform:scale(.6)}25%,100%{opacity:1;transform:scale(1)}}
@keyframes pd-url{0%,22%{width:0}34%,100%{width:118px}}
@keyframes pd-modal{0%,36%{opacity:0;transform:translateY(10px) scale(.97)}42%,66%{opacity:1;transform:translateY(0) scale(1)}71%,100%{opacity:0;transform:translateY(10px) scale(.97)}}
@keyframes pd-shade{0%,36%{opacity:0}42%,66%{opacity:1}71%,100%{opacity:0}}
@keyframes pd-check{0%,52%{background:transparent;border-color:${C.border}}55%,100%{background:${tone('rose')};border-color:${tone('rose')}}}
@keyframes pd-tick{0%,52%{opacity:0}55%,100%{opacity:1}}
@keyframes pd-cursor{0%,40%{transform:translate(380px,290px);opacity:0}44%{opacity:1}50%,54%{transform:translate(226px,179px);opacity:1}60%,64%{transform:translate(380px,204px);opacity:1}72%,100%{transform:translate(380px,204px);opacity:0}}
@keyframes pd-ring{0%,51%{opacity:0;transform:scale(.4)}53%{opacity:1;transform:scale(1)}56%{opacity:0;transform:scale(1.6)}61%{opacity:0;transform:scale(.4)}63%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
`;

export default function PortalDomain(): JSX.Element {
    return (
        <Stage label="El portal en la dirección propia de la empresa, con su logo y su color. El dominio quedó verificado y responde; la primera vez, el cliente acepta la autorización de tratamiento de datos." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Tarjeta del dominio */}
                <At
                    x={16}
                    y={84}
                    w={150}
                    h={134}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 11, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Globe size={11} color={tone('rose')} />
                        <T size={8} weight={800}>
                            Dominio para tus clientes
                        </T>
                    </span>
                    <span style={{ height: 19, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <T size={7.5} weight={600}>
                            pacientes.bellapiel.cl
                        </T>
                    </span>
                    {(
                        [
                            ['Registro TXT', 'Verificado', 'pd-v1'],
                            ['Registro CNAME', 'Responde', 'pd-v2'],
                        ] as const
                    ).map(([l, ok, a]) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <T size={7.5} color={C.mutedFg}>
                                {l}
                            </T>
                            <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 99, background: tone('mint', 0.15), animationName: a }}>
                                <CheckCircle2 size={8} color={tone('mint')} />
                                <T size={7} weight={700} color={tone('mint')}>
                                    {ok}
                                </T>
                            </span>
                        </span>
                    ))}
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Los enlaces de acceso ya salen por este dominio.
                    </T>
                </At>

                {/* El navegador del cliente */}
                <At
                    x={182}
                    y={20}
                    w={280}
                    h={260}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 16px 38px -16px rgba(15,23,42,.5)' }}
                >
                    <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ display: 'flex', gap: 3 }}>
                            {[0.45, 0.3, 0.18].map((o) => (
                                <span key={o} style={{ width: 6, height: 6, borderRadius: 99, background: C.mutedFg, opacity: o }} />
                            ))}
                        </span>
                        <span style={{ flex: 1, height: 18, borderRadius: 99, background: C.muted, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
                            <Lock size={8} color={tone('mint')} />
                            <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 118, animationName: 'pd-url' }}>
                                <T size={8.5} weight={600}>
                                    pacientes.bellapiel.cl
                                </T>
                            </span>
                        </span>
                    </div>
                    {/* El portal con la marca */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: tone('rose', 0.1) }}>
                        <span style={{ width: 22, height: 22, borderRadius: 99, background: tone('rose'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Sparkles size={12} />
                        </span>
                        <T size={9.5} weight={800}>
                            Bella Piel · Pacientes
                        </T>
                    </div>
                    <At x={12} y={74} w={256} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={11.5} weight={800}>
                            Hola, Valentina
                        </T>
                        <span style={{ display: 'flex', gap: 6 }}>
                            {(
                                [
                                    ['PRÓXIMA SESIÓN', '28/10 · 4:00 p. m.'],
                                    ['SESIONES', '4 de 6'],
                                ] as const
                            ).map(([k, v]) => (
                                <span key={k} style={{ flex: 1, borderRadius: 8, border: `1px solid ${C.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                                        {k}
                                    </T>
                                    <T size={9.5} weight={800} color={tone('rose')}>
                                        {v}
                                    </T>
                                </span>
                            ))}
                        </span>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{ height: 24, borderRadius: 7, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
                                <span style={{ width: 70 + i * 14, height: 5, borderRadius: 99, background: C.muted }} />
                                <span style={{ marginLeft: 'auto', width: 34, height: 9, borderRadius: 3, background: tone('rose', 0.3) }} />
                            </span>
                        ))}
                    </At>
                    {/* Autorización de datos */}
                    <At x={0} y={28} w={280} h={232} a="pd-shade" style={{ background: 'rgba(15,23,42,.35)', opacity: 0 }} />
                    <At
                        x={24}
                        y={92}
                        w={232}
                        a="pd-modal"
                        style={{ opacity: 0, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 18px 40px -16px rgba(15,23,42,.6)' }}
                    >
                        <T size={9.5} weight={800} style={{ whiteSpace: 'normal' }}>
                            Autorización para el tratamiento de tus datos
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Bella Piel SpA tratará tus datos para agendar tus sesiones y enviarte tu historial…
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span data-a="" style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'pd-check' }}>
                                <svg data-a="" width="7" height="7" viewBox="0 0 10 10" style={{ opacity: 0, animationName: 'pd-tick' }}>
                                    <path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </span>
                            <T size={7.5} weight={600}>
                                Acepto el tratamiento de mis datos
                            </T>
                        </span>
                        <span style={{ alignSelf: 'flex-end', height: 22, padding: '0 10px', borderRadius: 6, background: tone('rose'), display: 'flex', alignItems: 'center' }}>
                            <T size={8} weight={700} color="#fff">
                                Aceptar y continuar
                            </T>
                        </span>
                    </At>
                </At>
                <Cursor a="pd-cursor" click="pd-ring" rest={[380, 204]} />
            </At>
        </Stage>
    );
}
