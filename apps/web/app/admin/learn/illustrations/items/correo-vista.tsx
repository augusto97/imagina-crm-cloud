import { Monitor, Moon, Smartphone } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * La vista previa del editor de correos: primero con las variables a la
 * vista, después con los datos de un registro real y por último en el
 * celular y en modo oscuro.
 */

const BRAND = '#0e7490';

const CSS = `
@keyframes cv-a{0%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes cv-b{0%,30%{opacity:0}34%,63%{opacity:1}67%,100%{opacity:0}}
@keyframes cv-c{0%,63%{opacity:0}67%,100%{opacity:1}}
@keyframes cv-seg1{0%,30%{transform:translateX(0)}34%,100%{transform:translateX(100%)}}
@keyframes cv-seg2{0%,63%{transform:translateX(0)}67%,100%{transform:translateX(100%)}}
`;

function V({ children }: { children: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 13, padding: '0 4px', borderRadius: 4, background: tone('violet', 0.14), color: tone('violet'), fontSize: 7.5, fontWeight: 700, verticalAlign: 'middle' }}>{`{{${children}}}`}</span>
    );
}

function Seg({ a, opts, anim, w }: { a: string; opts: [JSX.Element, JSX.Element]; anim: string; w: number }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'flex', width: w, height: 20, borderRadius: 6, background: C.muted, padding: 2, boxSizing: 'border-box' }}>
            <span data-a="" style={{ position: 'absolute', left: 2, top: 2, bottom: 2, width: 'calc(50% - 2px)', borderRadius: 4, background: C.card, boxShadow: '0 1px 3px rgba(15,23,42,.2)', transform: 'translateX(100%)', animationName: anim }} />
            {opts.map((o, i) => (
                <span key={`${a}${i}`} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '0 6px' }}>
                    {o}
                </span>
            ))}
        </span>
    );
}

/** El correo en escritorio, con variables o con datos. */
function Desktop({ data }: { data: boolean }): JSX.Element {
    const ink = '#1f2937';
    const soft = '#6b7280';
    return (
        <div style={{ position: 'absolute', left: 80, top: 0, width: 260, background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 20px -10px rgba(15,23,42,.4)' }}>
            <div style={{ height: 26, background: BRAND, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                <T size={8.5} weight={800} color="#fff">
                    Café Aurora
                </T>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: ink, lineHeight: 1.3 }}>Hola {data ? 'Ana Restrepo' : <V>nombre</V>}, tu factura vence pronto</span>
                <span style={{ fontSize: 8, color: soft, lineHeight: 1.5 }}>
                    La factura {data ? <b style={{ color: ink }}>FAC-1043</b> : <V>numero</V>} por {data ? <b style={{ color: ink }}>$ 1.250.000</b> : <V>monto</V>} vence el {data ? <b style={{ color: ink }}>15/11/2026</b> : <V>vencimiento</V>}.
                </span>
                <span style={{ alignSelf: 'center', padding: '6px 16px', borderRadius: 6, background: BRAND, color: '#fff', fontSize: 8.5, fontWeight: 700 }}>Pagar ahora</span>
            </div>
        </div>
    );
}

export default function CorreoVista(): JSX.Element {
    return (
        <Stage label="La vista previa del editor: primero el correo con las variables a la vista, después con los datos de un registro real (Ana Restrepo, FAC-1043, $ 1.250.000) y al final en el celular y en modo oscuro." tint="blue">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={14} y={14} w={452} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)' }}>
                    <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={700}>
                            Diseñar correo
                        </T>
                        <span style={{ marginLeft: 'auto' }} />
                        <Seg
                            a="d"
                            w={124}
                            anim="cv-seg2"
                            opts={[
                                <>
                                    <Monitor size={9} color={C.mutedFg} />
                                    <T size={7} weight={600}>
                                        Escritorio
                                    </T>
                                </>,
                                <>
                                    <Smartphone size={9} color={C.mutedFg} />
                                    <T size={7} weight={600}>
                                        Celular
                                    </T>
                                </>,
                            ]}
                        />
                        <Seg
                            a="v"
                            w={196}
                            anim="cv-seg1"
                            opts={[
                                <T key="a" size={7} weight={600}>
                                    Ver las variables
                                </T>,
                                <T key="b" size={7} weight={600}>
                                    Datos de un registro
                                </T>,
                            ]}
                        />
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 34, bottom: 0, background: C.muted, padding: '26px 0' }}>
                        <div style={{ position: 'relative', height: '100%' }}>
                            <div data-a="" style={{ position: 'absolute', inset: 0, opacity: 0, animationName: 'cv-a' }}>
                                <Desktop data={false} />
                            </div>
                            <div data-a="" style={{ position: 'absolute', inset: 0, opacity: 0, animationName: 'cv-b' }}>
                                <Desktop data />
                            </div>
                            {/* Celular en modo oscuro */}
                            <div data-a="" style={{ position: 'absolute', inset: 0, animationName: 'cv-c' }}>
                                <div style={{ position: 'absolute', left: 60, top: -12, width: 132, height: 200, borderRadius: 18, border: '5px solid #111827', background: '#121212', overflow: 'hidden' }}>
                                    <div style={{ height: 22, background: BRAND, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                                        <T size={7} weight={800} color="#fff">
                                            Café Aurora
                                        </T>
                                    </div>
                                    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#f3f4f6', lineHeight: 1.25 }}>Hola Ana Restrepo, tu factura vence pronto</span>
                                        <span style={{ fontSize: 7, color: '#9ca3af', lineHeight: 1.5 }}>La factura FAC-1043 por $ 1.250.000 vence el 15/11/2026.</span>
                                        <span style={{ alignSelf: 'stretch', textAlign: 'center', padding: '6px 0', borderRadius: 6, background: BRAND, color: '#fff', fontSize: 7.5, fontWeight: 700 }}>Pagar ahora</span>
                                    </div>
                                </div>
                                <div style={{ position: 'absolute', left: 214, top: 30, width: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Moon size={12} color={tone('violet')} />
                                        <T size={9} weight={700}>
                                            Modo oscuro
                                        </T>
                                    </span>
                                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                                        En el celular las columnas se apilan y el botón ocupa el ancho. Con tus colores para modo oscuro, Apple Mail y Outlook los respetan.
                                    </T>
                                    <span style={{ display: 'flex', gap: 5 }}>
                                        {['#121212', '#1f2937', '#f3f4f6'].map((c) => (
                                            <span key={c} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: `1px solid ${C.border}` }} />
                                        ))}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </At>
            </div>
        </Stage>
    );
}
