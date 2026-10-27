import { AlertTriangle, Bell, History } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, tone } from '../kit';

/**
 * El historial de ejecuciones: cada corrida queda con su resultado. Cuando una
 * falla, además se abre un «Problema» (aparece la pastilla arriba y llega el
 * aviso a la campana) hasta que vuelve a funcionar.
 */

const CSS = `
@keyframes ahi-new{0%,18%{opacity:0;transform:translateY(-10px);background:transparent}23%{opacity:1;transform:translateY(0);background:${tone('rose', 0.14)}}40%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes ahi-push{0%,18%{transform:translateY(-40px)}23%,100%{transform:translateY(0)}}
@keyframes ahi-pill{0%,32%{opacity:0;transform:scale(.6)}37%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ahi-badge{0%,44%{opacity:0;transform:scale(.4)}48%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ahi-note{0%,50%{opacity:0;transform:translateY(-6px)}56%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ahi-prob{0%,62%{opacity:0;transform:translateY(8px)}68%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ahi-bell{0%,46%{transform:rotate(0)}48%{transform:rotate(14deg)}50%{transform:rotate(-12deg)}52%{transform:rotate(8deg)}54%,100%{transform:rotate(0)}}
`;

type St = { label: string; t: 'mint' | 'rose' | 'amber' | 'slate' };
const OK: St = { label: 'Éxito', t: 'mint' };
const ROWS: Array<{ st: St; rec: string; when: string; detail: string }> = [
    { st: { label: 'En espera', t: 'amber' }, rec: 'Registro #1047', when: 'hace 1 h', detail: 'En espera hasta el 29/10 a las 09:00' },
    { st: OK, rec: 'Registro #1042', when: 'hace 3 h', detail: 'Enviar email → Esperar → Actualizar campo' },
    { st: OK, rec: 'Registro #1039', when: 'ayer', detail: 'Enviar email → Actualizar campo' },
];

function Status({ st }: { st: St }): JSX.Element {
    return <span style={{ height: 16, padding: '0 7px', borderRadius: 99, background: tone(st.t, 0.16), color: tone(st.t), fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{st.label}</span>;
}

function Row({ st, rec, when, detail }: { st: St; rec: string; when: string; detail: string }): JSX.Element {
    return (
        <div style={{ height: 40, padding: '0 11px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: `1px solid ${C.border}` }}>
            <Status st={st} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <T size={8.6} weight={600}>
                    {rec}
                </T>
                <T size={7.4} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {detail}
                </T>
            </span>
            <T size={7.4} color={C.mutedFg}>
                {when}
            </T>
        </div>
    );
}

export default function AutoHistorial(): JSX.Element {
    return (
        <Stage label="El historial de una automatización: cada corrida queda con su resultado; cuando una falla, se abre un problema, aparece la pastilla roja arriba y llega el aviso a la campana." tint="rose">
            <Keyframes css={CSS} />
            {/* Barra superior de la app */}
            <At x={14} y={14} w={452} h={34} style={{ borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
                <span style={{ flex: 1, height: 18, borderRadius: 6, background: C.muted, maxWidth: 170 }} />
                <span style={{ flex: 1 }} />
                <span data-a="" style={{ animationName: 'ahi-pill', display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 99, background: tone('rose', 0.14), color: tone('rose'), fontSize: 8.4, fontWeight: 700 }}>
                    <AlertTriangle size={10} /> 1 problema
                </span>
                <span style={{ position: 'relative', width: 24, height: 24, borderRadius: 7, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span data-a="" style={{ display: 'flex', animationName: 'ahi-bell' }}>
                        <Bell size={12} />
                    </span>
                    <span data-a="" style={{ position: 'absolute', right: -4, top: -4, width: 12, height: 12, borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 7, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'ahi-badge' }}>
                        1
                    </span>
                </span>
                <span style={{ width: 22, height: 22, borderRadius: 99, background: tone('violet', 0.2) }} />
            </At>
            {/* El aviso */}
            <At x={314} y={60} w={152} a="ahi-note" style={{ zIndex: 5, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 16px 34px -14px rgba(15,23,42,.5)', padding: '8px 10px', display: 'flex', gap: 8 }}>
                <span style={{ width: 22, height: 22, borderRadius: 99, background: tone('rose', 0.16), color: tone('rose'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertTriangle size={11} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <T size={8.4} weight={700}>
                        Falló «Cobro de facturas»
                    </T>
                    <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                        Enviar email: el registro no tiene correo del cliente.
                    </T>
                    <T size={7.6} weight={700} color={tone('blue')}>
                        Ir a arreglarlo →
                    </T>
                </span>
            </At>
            {/* Ajustes → Problemas */}
            <At x={314} y={164} w={152} a="ahi-prob" style={{ borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 10px 24px -16px rgba(15,23,42,.45)' }}>
                <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Ajustes · Problemas
                </T>
                <T size={8.4} weight={700}>
                    Cobro de facturas
                </T>
                <T size={7.4} color={C.mutedFg}>
                    Falló 3 veces desde ayer
                </T>
                <span style={{ display: 'flex', gap: 5 }}>
                    <span style={{ height: 18, padding: '0 7px', borderRadius: 5, background: tone('blue'), color: '#fff', fontSize: 7.4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Ir a arreglarlo</span>
                    <span style={{ height: 18, padding: '0 7px', borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 7.4, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Ya lo arreglé</span>
                </span>
            </At>
            {/* El historial */}
            <Win x={14} y={60} w={290} h={224} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><History size={10} /> Historial de ejecuciones</span>}>
                <At x={0} y={0} w={290} h={40} a="ahi-new">
                    <Row st={{ label: 'Fallida', t: 'rose' }} rec="Registro #1051" when="hace un momento" detail="Enviar email: sin destinatario" />
                </At>
                <At x={0} y={40} w={290} h={160} a="ahi-push">
                    {ROWS.map((r) => (
                        <Row key={r.rec} {...r} />
                    ))}
                    <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ height: 20, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 8, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Cargar más</span>
                    </div>
                </At>
            </Win>
        </Stage>
    );
}
