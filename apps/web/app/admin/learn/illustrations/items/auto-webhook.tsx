import { PenLine, Play, Webhook } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Llamar webhook externo»: se arma la petición con filas clave/valor, se toca
 * «Probar ahora», la otra app responde y el paso siguiente usa un dato de esa
 * respuesta con {{webhook.body.id}}.
 */

const CSS = `
@keyframes aw2-cur{0%{transform:translate(200px,292px);opacity:0}6%{opacity:1}14%,20%{transform:translate(70px,247px)}34%,90%{transform:translate(150px,282px);opacity:1}96%,100%{opacity:0;transform:translate(150px,282px)}}
@keyframes aw2-ring{0%,16%{opacity:0;transform:scale(.4)}18%{opacity:1;transform:scale(1)}23%,100%{opacity:0;transform:scale(1.6)}}
@keyframes aw2-res{0%,22%{opacity:0;transform:translateY(8px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes aw2-ok{0%,34%{opacity:0;transform:scale(.6)}38%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes aw2-id{0%,46%{background:transparent}50%,66%{background:${tone('amber', 0.3)}}72%,100%{background:transparent}}
@keyframes aw2-next{0%,52%{opacity:0;transform:translateY(8px)}58%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes aw2-tag{0%,66%{opacity:1}70%,95%{opacity:0}100%{opacity:1}}
@keyframes aw2-val{0%,66%{opacity:0;transform:scale(.85)}70%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

const mono = { fontFamily: 'ui-monospace, monospace' } as const;

function KV({ y, k, v, tag }: { y: number; k: string; v: string; tag?: boolean }): JSX.Element {
    return (
        <At x={10} y={y} w={190} style={{ display: 'flex', gap: 4 }}>
            <span style={{ width: 62, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                <T size={7.8} weight={600}>
                    {k}
                </T>
            </span>
            <span style={{ flex: 1, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px', overflow: 'hidden' }}>
                <T size={7.6} weight={tag ? 700 : 500} color={tag ? primary() : C.fg} style={tag ? mono : undefined}>
                    {v}
                </T>
            </span>
        </At>
    );
}

export default function AutoWebhook(): JSX.Element {
    return (
        <Stage label="La acción Llamar webhook externo: se arma la petición con filas de datos, se prueba, la otra app responde con un número de mensaje y el paso siguiente lo guarda en el registro usando la variable de la respuesta." tint="mint">
            <Keyframes css={CSS} />
            <Win x={14} y={22} w={210} h={256} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Webhook size={10} /> Llamar webhook externo</span>}>
                <At x={10} y={8} w={190} style={{ display: 'flex', gap: 4 }}>
                    <span style={{ height: 20, padding: '0 7px', borderRadius: 5, background: tone('mint', 0.16), color: tone('mint'), fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center' }}>POST</span>
                    <span style={{ flex: 1, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <T size={7.6} style={mono}>
                            https://api.mensajes.co/send
                        </T>
                    </span>
                </At>
                <At x={10} y={36} w={190} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={7.2} weight={600} color={C.mutedFg}>
                        Tipo de contenido
                    </T>
                    <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <T size={7.6}>Datos de formulario (x-www-form-urlencoded)</T>
                    </span>
                </At>
                <At x={10} y={72} style={{ display: 'flex' }}>
                    <T size={7.2} weight={600} color={C.mutedFg}>
                        Cuerpo — datos que pide la API
                    </T>
                </At>
                <KV y={88} k="recipient" v="{{telefono}}" tag />
                <KV y={112} k="message" v="Hola {{cliente}}, tu…" />
                <KV y={136} k="account" v="Ventas Café Aurora" />
                <At x={10} y={164} w={190} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 8, color: C.mutedFg }}>›</span>
                    <T size={7.6} color={C.mutedFg}>
                        Cabeceras, parámetros de la URL y firma
                    </T>
                </At>
                <At x={10} y={190} w={110} h={24} style={{ borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Play size={10} />
                    <T size={8} weight={600}>
                        Probar ahora
                    </T>
                </At>
            </Win>

            {/* Lo que respondió */}
            <Win x={236} y={22} w={230} h={148} a="aw2-res" title="Resultado de la prueba">
                <At x={10} y={8} w={210} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Se envió
                    </T>
                    <T size={7.4} style={mono}>
                        recipient=%2B573105550142&amp;message=Hola…
                    </T>
                </At>
                <At x={10} y={40} w={210} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Respondió
                    </T>
                    <span data-a="" style={{ animationName: 'aw2-ok', height: 15, padding: '0 6px', borderRadius: 99, background: tone('mint', 0.16), color: tone('mint'), fontSize: 7.6, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>200 OK</span>
                </At>
                <At x={10} y={60} w={210} h={60} style={{ borderRadius: 6, background: C.muted, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.3 }}>
                    <T size={7.6} style={mono}>{'{'}</T>
                    <T size={7.6} style={{ ...mono, paddingLeft: 10 }}>
                        {'"ok": true,'}
                    </T>
                    <span data-a="" style={{ animationName: 'aw2-id', alignSelf: 'flex-start', display: 'flex', borderRadius: 3, padding: '0 2px', marginLeft: 8 }}>
                        <T size={7.6} weight={700} style={mono}>
                            {'"id": "msg_812"'}
                        </T>
                    </span>
                    <T size={7.6} style={mono}>{'}'}</T>
                </At>
            </Win>

            {/* El paso siguiente usa la respuesta */}
            <At x={236} y={182} w={230} a="aw2-next" style={{ borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <IconSquare t="blue" size={22}>
                        <PenLine size={12} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Paso 2 · Actualizar campos
                        </T>
                        <T size={8.6} weight={600}>
                            Guardar el número del mensaje
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 70, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <T size={7.8} weight={600}>
                            Id mensaje
                        </T>
                    </span>
                    <span style={{ position: 'relative', flex: 1, height: 20, borderRadius: 5, border: `1px solid ${C.border}` }}>
                        <span data-a="" style={{ position: 'absolute', left: 6, top: 4, display: 'flex', opacity: 0, animationName: 'aw2-tag' }}>
                            <T size={7.6} weight={700} color={primary()} style={mono}>
                                {'{{webhook.body.id}}'}
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 6, top: 3, display: 'flex', animationName: 'aw2-val' }}>
                            <span style={{ height: 14, padding: '0 5px', borderRadius: 4, background: tone('amber', 0.25), display: 'inline-flex', alignItems: 'center' }}>
                                <T size={7.6} weight={700} style={mono}>
                                    msg_812
                                </T>
                            </span>
                        </span>
                    </span>
                </span>
            </At>
            <Cursor a="aw2-cur" click="aw2-ring" rest={[150, 282]} />
        </Stage>
    );
}
