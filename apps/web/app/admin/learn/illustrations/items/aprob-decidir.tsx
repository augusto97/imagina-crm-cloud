import { Bell, ClipboardCheck } from 'lucide-react';

import { At, Avatar, Bar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Decidir desde la ficha: a quien le toca ve «Pendiente de tu aprobación» con
 * Aprobar, Rechazar y Devolver. Al devolver escribe qué hay que corregir; la
 * solicitud queda «Devuelta» y a quien la pidió le llega el aviso.
 */

const CSS = `
@keyframes apd-cur{0%{transform:translate(400px,290px);opacity:0}6%{opacity:1}16%,21%{transform:translate(184px,194px)}34%,40%{transform:translate(362px,262px)}52%,90%{transform:translate(440px,286px);opacity:1}96%,100%{opacity:0;transform:translate(440px,286px)}}
@keyframes apd-ring{0%,18%{opacity:0;transform:scale(.4)}20%{opacity:1;transform:scale(1)}24%{opacity:0;transform:scale(1.6)}35%{opacity:0;transform:scale(.4)}37%{opacity:1;transform:scale(1)}41%,100%{opacity:0;transform:scale(1.6)}}
@keyframes apd-dlg{0%,21%{opacity:0;transform:translateY(8px) scale(.97)}25%,38%{opacity:1;transform:translateY(0) scale(1)}42%,100%{opacity:0;transform:translateY(8px) scale(.97)}}
@keyframes apd-type{0%,25%{width:0}33%,100%{width:150px}}
@keyframes apd-bar{0%,40%{opacity:1}44%,96%{opacity:0}100%{opacity:1}}
@keyframes apd-done{0%,40%{opacity:0;transform:translateY(6px)}45%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes apd-note{0%,52%{opacity:0;transform:translateX(16px)}58%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
`;

const btn = (label: string, kind: 'ok' | 'no' | 'back'): JSX.Element => {
    const bg = kind === 'ok' ? C.success : C.card;
    const fg = kind === 'ok' ? '#fff' : kind === 'no' ? C.destructive : C.fg;
    return (
        <span style={{ height: 22, padding: '0 11px', borderRadius: 6, background: bg, color: fg, border: kind === 'ok' ? 'none' : `1px solid ${C.border}`, fontSize: 8.6, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{label}</span>
    );
};

export default function AprobDecidir(): JSX.Element {
    return (
        <Stage label="Decidir una aprobación desde la ficha: a quien le toca ve Pendiente de tu aprobación con Aprobar, Rechazar y Devolver; al devolver escribe qué hay que corregir y a quien la pidió le llega el aviso." tint="amber">
            <Keyframes css={CSS} />
            <Win x={14} y={14} w={340} h={272} title="Gastos · Viaje a Medellín">
                <At x={14} y={10}>
                    <T size={12} weight={700}>
                        Viaje a Medellín
                    </T>
                </At>
                <At x={14} y={34} w={312} style={{ display: 'flex', gap: 18 }}>
                    {[
                        ['Monto', '$ 2.400.000'],
                        ['Solicitante', 'Carlos Ruiz'],
                        ['Fecha', '24/10/2026'],
                    ].map(([k, v]) => (
                        <span key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={7.2} color={C.mutedFg}>
                                {k}
                            </T>
                            <T size={8.8} weight={600}>
                                {v}
                            </T>
                        </span>
                    ))}
                </At>
                {/* Bloque de aprobación */}
                <At x={14} y={70} w={312} h={112} style={{ borderRadius: 10, border: `1px solid ${tone('amber', 0.45)}`, background: tone('amber', 0.08), padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ClipboardCheck size={12} color={tone('amber')} />
                        <T size={9} weight={700}>
                            Pendiente de tu aprobación
                        </T>
                        <span style={{ marginLeft: 'auto', height: 15, padding: '0 6px', borderRadius: 99, background: tone('amber', 0.2), color: tone('amber'), fontSize: 7.4, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Paso 1 de 2</span>
                    </span>
                    <T size={7.6} color={C.mutedFg}>
                        Gasto mayor a $ 1M · Pedida por Carlos Ruiz · hace 2 h
                    </T>
                    <span style={{ display: 'flex', borderRadius: 6, background: C.card, border: `1px solid ${C.border}`, padding: '4px 7px' }}>
                        <T size={7.8}>«Es el gasto del viaje a la feria de cafés.»</T>
                    </span>
                    <span style={{ position: 'relative', display: 'block', height: 22 }}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', gap: 6, animationName: 'apd-bar', opacity: 0 }}>
                            {btn('Aprobar', 'ok')}
                            {btn('Rechazar', 'no')}
                            {btn('Devolver', 'back')}
                        </span>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 6, animationName: 'apd-done' }}>
                            <span style={{ height: 18, padding: '0 8px', borderRadius: 99, background: tone('blue', 0.16), color: tone('blue'), fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Devuelta</span>
                            <T size={7.6} color={C.mutedFg}>
                                Qué hay que corregir: adjunta la cotización
                            </T>
                        </span>
                    </span>
                </At>
                <At x={14} y={196} w={312} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} weight={700}>
                        Comentarios
                    </T>
                    <Bar w="90%" />
                    <Bar w="70%" />
                </At>
            </Win>

            {/* Diálogo del motivo */}
            <At x={196} y={196} w={196} a="apd-dlg" style={{ opacity: 0, zIndex: 6, borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -14px rgba(15,23,42,.55)', padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={8.8} weight={700}>
                    Qué hay que corregir
                </T>
                <span style={{ height: 22, borderRadius: 6, border: `1px solid ${primary(0.5)}`, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
                    <span data-a="" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', animationName: 'apd-type' }}>
                        <T size={8}>adjunta la cotización firmada</T>
                    </span>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    {btn('Cancelar', 'back')}
                    <span style={{ height: 22, padding: '0 11px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8.6, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Devolver</span>
                </span>
            </At>

            {/* El aviso a quien pidió */}
            <At x={362} y={40} w={106} a="apd-note" style={{ borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -14px rgba(15,23,42,.5)', padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Bell size={11} color={primary()} />
                    <T size={7.4} weight={700} color={C.mutedFg}>
                        Carlos Ruiz
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 5 }}>
                    <Avatar initials="AM" t="violet" size={18} />
                    <T size={7.6} weight={600} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                        Ana devolvió tu solicitud para corregir
                    </T>
                </span>
            </At>
            <Cursor a="apd-cur" click="apd-ring" rest={[440, 286]} />
        </Stage>
    );
}
