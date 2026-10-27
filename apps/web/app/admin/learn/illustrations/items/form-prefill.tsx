import { EyeOff, Lock, RotateCw } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/** Pregunta oculta: el enlace trae «?origen=instagram», la pregunta oculta se llena sola y el registro llega con su origen. */

const CSS = `
@keyframes fpf-q{0%,8%{width:0}26%,100%{width:92px}}
@keyframes fpf-qhl{0%,26%{background:transparent}30%,48%{background:${tone('amber', 0.25)}}56%,100%{background:transparent}}
@keyframes fpf-fly{0%,30%{opacity:0;transform:translate(0,0)}33%{opacity:1;transform:translate(0,0)}44%{opacity:1;transform:translate(-196px,182px)}47%,100%{opacity:0;transform:translate(-196px,182px)}}
@keyframes fpf-val{0%,44%{opacity:0;transform:scale(.6)}48%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fpf-row{0%,46%{box-shadow:0 0 0 0 transparent}50%,58%{box-shadow:0 0 0 2px ${tone('amber', 0.5)}}66%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes fpf-btn{0%,57%{transform:scale(1)}59%{transform:scale(.94)}62%,100%{transform:scale(1)}}
@keyframes fpf-cursor{0%,40%{transform:translate(150px,290px);opacity:0}46%{opacity:1}54%,60%{transform:translate(126px,256px);opacity:1}70%,100%{transform:translate(126px,256px);opacity:0}}
@keyframes fpf-ring{0%,57%{opacity:0;transform:scale(.4)}59%{opacity:1;transform:scale(1)}63%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fpf-push{0%,62%{transform:translateY(-26px)}68%,100%{transform:translateY(0)}}
@keyframes fpf-new{0%,62%{opacity:0;transform:translateX(16px)}68%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes fpf-glow{0%,66%{background:${tone('amber', 0.18)}}88%,100%{background:transparent}}
`;

const ROWS: Array<[string, string, 'blue' | 'violet' | 'mint', 'blue' | 'mint' | 'slate']> = [
    ['Hotel Brisas', 'facebook', 'violet', 'blue'],
    ['Óptica Visión', 'volante', 'mint', 'slate'],
    ['Clínica Norte', 'facebook', 'blue', 'blue'],
];

export default function FormPrefill(): JSX.Element {
    return (
        <Stage label="El enlace del formulario termina en ?origen=instagram: la pregunta oculta Origen se completa sola y el registro llega a la lista marcado como Instagram." tint="amber">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Barra del navegador */}
                <At
                    x={24}
                    y={16}
                    w={432}
                    h={30}
                    style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', boxShadow: '0 8px 20px -12px rgba(15,23,42,.35)' }}
                >
                    <RotateCw size={10} color={C.mutedFg} />
                    <span style={{ flex: 1, height: 20, borderRadius: 99, background: C.muted, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px' }}>
                        <Lock size={8} color={C.mutedFg} />
                        <T size={9} color={C.mutedFg}>
                            tuempresa.com/formulario/cotizacion
                        </T>
                        <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 92, marginLeft: -5, borderRadius: 4, animationName: 'fpf-q' }}>
                            <span data-a="" style={{ display: 'inline-block', padding: '1px 2px', borderRadius: 4, animationName: 'fpf-qhl' }}>
                                <T size={9} weight={700}>
                                    ?origen=instagram
                                </T>
                            </span>
                        </span>
                    </span>
                </At>
                {/* El valor que baja del enlace */}
                <At x={248} y={21} a="fpf-fly" style={{ opacity: 0, zIndex: 8 }}>
                    <Pill label="instagram" t="amber" style={{ boxShadow: '0 6px 14px -6px rgba(15,23,42,.45)', background: C.card, border: `1px solid ${tone('amber', 0.5)}` }} />
                </At>

                {/* El formulario */}
                <At
                    x={24}
                    y={66}
                    w={220}
                    h={214}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={12} y={12}>
                        <T size={11} weight={800}>
                            Pide tu cotización
                        </T>
                    </At>
                    {['Nombre', 'Teléfono'].map((l, i) => (
                        <At key={l} x={12} y={34 + i * 38} w={196} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={8} weight={700}>
                                {l}
                            </T>
                            <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                                <T size={8}>{i === 0 ? 'Camilo Duarte' : '+57 315 220 1188'}</T>
                            </span>
                        </At>
                    ))}
                    {/* La oculta */}
                    <At
                        x={8}
                        y={112}
                        w={204}
                        h={50}
                        a="fpf-row"
                        style={{ borderRadius: 7, border: `1.5px dashed ${C.border}`, background: C.muted, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <EyeOff size={9} color={C.mutedFg} />
                            <T size={8} weight={700}>
                                Origen
                            </T>
                            <T size={6.5} color={C.mutedFg}>
                                Oculta · se completa desde la dirección
                            </T>
                        </span>
                        <span style={{ height: 17, borderRadius: 5, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', padding: '0 4px' }}>
                            <span data-a="" style={{ display: 'inline-flex', animationName: 'fpf-val' }}>
                                <Pill label="instagram" t="amber" style={{ height: 13, fontSize: 7.5 }} />
                            </span>
                        </span>
                    </At>
                    <At x={12} y={176} w={196} h={22} a="fpf-btn" style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8.5} weight={700} color={C.primaryFg}>
                            Enviar
                        </T>
                    </At>
                </At>

                {/* La lista */}
                <Win x={260} y={66} w={196} h={214} title="Oportunidades">
                    <div style={{ display: 'flex', padding: '7px 10px 5px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ width: 104 }}>
                            Cliente
                        </T>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Origen
                        </T>
                    </div>
                    <At x={0} y={24} w={194} h={26} a="fpf-new" style={{ zIndex: 2 }}>
                        <div data-a="" style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, animationName: 'fpf-glow' }}>
                            <span style={{ width: 104, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <Avatar initials="CD" t="amber" size={15} />
                                <T size={8.5} weight={700}>
                                    Camilo Duarte
                                </T>
                            </span>
                            <Pill label="Instagram" t="amber" style={{ height: 16, fontSize: 8 }} />
                        </div>
                    </At>
                    <At x={0} y={50} w={194} a="fpf-push">
                        {ROWS.map(([n, o, t, ot]) => (
                            <div key={n} style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                                <span style={{ width: 104, display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <Avatar initials={n.slice(0, 2).toUpperCase()} t={t} size={15} />
                                    <T size={8.5}>{n}</T>
                                </span>
                                <Pill label={o === 'facebook' ? 'Facebook' : 'Volante'} t={ot} style={{ height: 16, fontSize: 8 }} />
                            </div>
                        ))}
                    </At>
                </Win>
                <Cursor a="fpf-cursor" click="fpf-ring" rest={[126, 256]} />
            </At>
        </Stage>
    );
}
