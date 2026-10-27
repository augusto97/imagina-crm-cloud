import { KeyRound, Plug, ShieldCheck } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * La conexión MCP: un asistente externo (Claude, Cursor…) pregunta por tus
 * datos; la app responde con TU acceso (tu rol, tus permisos) y la conexión
 * se ve y se revoca desde Ajustes.
 */

const CSS = `
@keyframes imc-q{0%,4%{opacity:0;transform:translateY(6px)}9%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes imc-tool{0%,14%{opacity:0;transform:translateY(6px)}19%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes imc-pkt{0%,18%{opacity:0;transform:translateX(0)}20%{opacity:1}30%{opacity:1;transform:translateX(70px)}32%,100%{opacity:0;transform:translateX(70px)}}
@keyframes imc-back{0%,40%{opacity:0;transform:translateX(0)}42%{opacity:1}52%{opacity:1;transform:translateX(-70px)}54%,100%{opacity:0;transform:translateX(-70px)}}
@keyframes imc-app{0%,30%{box-shadow:0 0 0 0 transparent}33%,44%{box-shadow:0 0 0 3px ${primary(0.3)}}50%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes imc-a{0%,54%{opacity:0;transform:translateY(6px)}60%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes imc-used{0%,44%{opacity:0}48%,94%{opacity:1}99%,100%{opacity:0}}
`;

export default function IaMcp(): JSX.Element {
    return (
        <Stage label="La conexión MCP: un asistente externo como Claude pregunta cuántas facturas vencidas hay; la app responde con tu acceso y tus permisos, y la conexión se ve y se revoca desde Ajustes." tint="blue">
            <Keyframes css={CSS} />
            {/* El asistente externo */}
            <Win x={14} y={24} w={210} h={252} title="Tu asistente (Claude, Cursor…)">
                <At x={50} y={10} w={150} a="imc-q" style={{ borderRadius: '10px 10px 3px 10px', background: C.muted, padding: '6px 8px' }}>
                    <T size={8} style={{ whiteSpace: 'normal', lineHeight: 1.4, display: 'block' }}>
                        ¿Cuántas facturas vencidas tengo y quién me debe más?
                    </T>
                </At>
                <At x={10} y={62} a="imc-tool" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 99, border: `1px solid ${C.border}`, background: C.card }}>
                    <Plug size={10} color={primary()} />
                    <T size={7.6} weight={600}>
                        Consultó «Facturas» en Café Aurora
                    </T>
                </At>
                <At x={10} y={92} w={190} a="imc-a" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8.2} style={{ whiteSpace: 'normal', lineHeight: 1.45, display: 'block' }}>
                        Tienes <b>4 facturas vencidas</b> por <b>$ 3.180.000</b>. Quien más debe es <b>Hotel Brisas</b> ($ 1.250.000).
                    </T>
                    <T size={8.2} style={{ whiteSpace: 'normal', lineHeight: 1.45, display: 'block' }}>
                        ¿Quieres que les cambie el estado a «Vencida»? Te muestro la propuesta antes de aplicarla.
                    </T>
                </At>
            </Win>

            {/* El viaje */}
            <At x={234} y={128} w={60} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone('mint') }}>
                    <ShieldCheck size={14} />
                </span>
                <T size={7} weight={600} color={C.mutedFg} style={{ textAlign: 'center', whiteSpace: 'normal', lineHeight: 1.25 }}>
                    con tu rol y permisos
                </T>
            </At>
            <At x={226} y={110} a="imc-pkt" style={{ opacity: 0 }}>
                <span style={{ display: 'block', width: 9, height: 9, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
            <At x={296} y={110} a="imc-back" style={{ opacity: 0 }}>
                <span style={{ display: 'block', width: 9, height: 9, borderRadius: 99, background: tone('mint'), boxShadow: `0 0 0 4px ${tone('mint', 0.2)}` }} />
            </At>

            {/* La app: Ajustes → Seguridad → Conexión MCP */}
            <Win x={304} y={24} w={162} h={252} a="imc-app" title="Ajustes · Seguridad">
                <At x={10} y={10} w={142} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Plug size={11} color={primary()} />
                    <T size={8.6} weight={700}>
                        Conexión MCP
                    </T>
                </At>
                <At x={10} y={32} w={142} style={{ borderRadius: 9, border: `1px solid ${C.border}`, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.4} weight={700}>
                        Claude
                    </T>
                    <T size={7.2} color={C.mutedFg}>
                        Conexión autorizada
                    </T>
                    <T size={7.2} color={C.mutedFg}>
                        Lectura y cambios · se renueva solo
                    </T>
                    <span data-a="" style={{ animationName: 'imc-used', display: 'flex' }}>
                        <T size={7.2} weight={700} color={tone('mint')}>
                            Último uso: hace un momento
                        </T>
                    </span>
                    <span style={{ alignSelf: 'flex-start', marginTop: 3, height: 18, padding: '0 8px', borderRadius: 5, border: `1px solid ${C.border}`, color: C.destructive, fontSize: 7.6, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Revocar</span>
                </At>
                <At x={10} y={128} w={142} style={{ borderRadius: 9, border: `1px solid ${C.border}`, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <KeyRound size={10} color={C.mutedFg} />
                        <T size={8.4} weight={700}>
                            Cursor (token)
                        </T>
                    </span>
                    <T size={7.2} color={C.mutedFg}>
                        Sólo lectura · vence en 90 días
                    </T>
                    <span style={{ alignSelf: 'flex-start', marginTop: 3, height: 18, padding: '0 8px', borderRadius: 5, border: `1px solid ${C.border}`, color: C.destructive, fontSize: 7.6, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Revocar</span>
                </At>
                <At x={10} y={202} w={142} style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ height: 20, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 7.8, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <KeyRound size={9} /> Nuevo token
                    </span>
                </At>
            </Win>
        </Stage>
    );
}
