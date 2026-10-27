import { ArrowRight, Lock, Mail } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Decidir desde el correo: el aviso trae Aprobar / Rechazar / Abrir el registro, pero
 * nada se decide con el enlace. Se abre la app, se revisa y se confirma con
 * tu sesión: un correo reenviado no aprueba nada.
 */

const CSS = `
@keyframes apc-cur{0%{transform:translate(160px,290px);opacity:0}6%{opacity:1}14%,20%{transform:translate(60px,200px)}40%,46%{transform:translate(424px,208px)}58%,90%{transform:translate(440px,286px);opacity:1}96%,100%{opacity:0;transform:translate(440px,286px)}}
@keyframes apc-ring{0%,16%{opacity:0;transform:scale(.4)}18%{opacity:1;transform:scale(1)}22%{opacity:0;transform:scale(1.6)}41%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}47%,100%{opacity:0;transform:scale(1.6)}}
@keyframes apc-app{0%,20%{opacity:.25;transform:scale(.97)}26%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:.25}}
@keyframes apc-arrow{0%,19%{opacity:0;transform:translateX(-6px)}23%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes apc-ask{0%,44%{opacity:1}48%,96%{opacity:0}100%{opacity:1}}
@keyframes apc-done{0%,44%{opacity:0;transform:scale(.9)}49%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

const b = (l: string, kind: 'ok' | 'no' | 'back'): JSX.Element => (
    <span style={{ height: 20, padding: '0 6px', borderRadius: 6, background: kind === 'ok' ? C.success : kind === 'no' ? C.destructive : C.card, color: kind === 'back' ? C.fg : '#fff', border: kind === 'back' ? `1px solid ${C.border}` : 'none', fontSize: kind === 'back' ? 7 : 7.6, fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}>{l}</span>
);

export default function AprobCorreo(): JSX.Element {
    return (
        <Stage label="Decidir una aprobación desde el correo: el aviso trae los botones Aprobar, Rechazar y Abrir el registro; al tocarlos se abre la app, se revisa la solicitud y se confirma con tu sesión." tint="amber">
            <Keyframes css={CSS} />
            {/* El correo */}
            <Win x={14} y={50} w={206} h={196} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={10} /> Bandeja de entrada</span>}>
                <At x={12} y={10} w={182} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={9} weight={700}>
                        Te toca aprobar: Viaje a Medellín
                    </T>
                    <T size={7.2} color={C.mutedFg}>
                        Café Aurora · para ana@cafeaurora.co
                    </T>
                </At>
                <At x={12} y={46} w={182} h={112} style={{ borderRadius: 8, border: `1px solid ${C.border}`, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Carlos Ruiz pidió tu aprobación para «Viaje a Medellín» ($ 2.400.000), paso 1 de 2.
                    </T>
                    <span style={{ display: 'flex', borderRadius: 5, background: C.muted, padding: '4px 6px' }}>
                        <T size={7.4} color={C.mutedFg}>
                            «Es el gasto de la feria de cafés.»
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        {b('Aprobar', 'ok')}
                        {b('Rechazar', 'no')}
                        {b('Abrir el registro', 'back')}
                    </span>
                </At>
            </Win>
            <At x={226} y={142} a="apc-arrow" style={{ color: primary() }}>
                <ArrowRight size={14} />
            </At>

            {/* La app: confirmar */}
            <Win x={246} y={50} w={220} h={196} a="apc-app" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lock size={9} /> Tu sesión en la app</span>}>
                <div data-a="" style={{ position: 'absolute', inset: 0, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 7, animationName: 'apc-ask' }}>
                    <T size={10.5} weight={700}>
                        Confirma tu decisión
                    </T>
                    <T size={7.6} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Elegiste «Aprobar» desde el correo. Revisa la solicitud y confirma aquí: nada se decide hasta que tocas el botón.
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 8, border: `1px solid ${C.border}`, padding: '6px 8px' }}>
                        <T size={8.6} weight={700}>
                            Viaje a Medellín
                        </T>
                        <T size={7.4} color={C.mutedFg}>
                            $ 2.400.000 · Paso 1 de 2 · Jefe directo
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 6 }}>
                        {b('Volver', 'back')}
                        <span style={{ height: 22, padding: '0 12px', borderRadius: 6, background: C.success, color: '#fff', fontSize: 8.6, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Aprobar</span>
                    </span>
                </div>
                <div data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, animationName: 'apc-done' }}>
                    <span style={{ width: 38, height: 38, borderRadius: 99, background: C.success, color: '#fff', fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                    <T size={11} weight={700}>
                        Aprobaste el paso 1
                    </T>
                    <T size={7.8} color={C.mutedFg}>
                        Ahora le toca a Gerencia.
                    </T>
                    <span style={{ height: 18, padding: '0 8px', borderRadius: 99, background: tone('amber', 0.16), color: tone('amber'), fontSize: 7.8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Paso 2 de 2 · esperando</span>
                </div>
            </Win>
            <Cursor a="apc-cur" click="apc-ring" rest={[440, 286]} />
        </Stage>
    );
}
