import { AlarmClock, Bell, Eye } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Recordarme» en la ficha: se elige «Mañana a las 9:00», se crea el
 * recordatorio y, al llegar la hora, aparece el aviso en la campana.
 */

const CSS = `
@keyframes rc-pop{0%,10%{opacity:0;transform:translateY(-6px) scale(.98)}14%,42%{opacity:1;transform:translateY(0) scale(1)}46%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes rc-pick{0%,30%{background:transparent;box-shadow:none}33%,42%{background:${primary(0.14)};box-shadow:inset 0 0 0 1px ${primary(0.5)}}46%,100%{background:transparent}}
@keyframes rc-btn{0%,8%{background:transparent}10%,44%{background:${primary(0.16)}}48%,100%{background:transparent}}
@keyframes rc-toast{0%,44%{opacity:0;transform:translateY(8px)}48%,60%{opacity:1;transform:translateY(0)}64%,100%{opacity:0}}
@keyframes rc-clock{0%,60%{opacity:0}64%,74%{opacity:1}78%,100%{opacity:0}}
@keyframes rc-hand{0%,62%{transform:rotate(0)}74%,100%{transform:rotate(720deg)}}
@keyframes rc-notif{0%,74%{opacity:0;transform:translateX(30px)}78%,93%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes rc-shake{0%,74%{transform:rotate(0)}76%{transform:rotate(14deg)}78%{transform:rotate(-12deg)}80%{transform:rotate(7deg)}82%,100%{transform:rotate(0)}}
@keyframes rc-badge{0%,75%{opacity:0;transform:scale(.4)}78%,93%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes rc-cur{0%{transform:translate(260px,270px);opacity:0}4%{opacity:1}8%,10%{transform:translate(347px,30px)}26%,34%{transform:translate(268px,110px)}50%,88%{transform:translate(200px,250px);opacity:1}93%,100%{transform:translate(200px,250px);opacity:0}}
@keyframes rc-ring{0%,8%{opacity:0;transform:scale(.4)}10%{opacity:1;transform:scale(1)}14%{opacity:0;transform:scale(1.6)}31%{opacity:0;transform:scale(.4)}33%{opacity:1;transform:scale(1)}37%,100%{opacity:0;transform:scale(1.6)}}
`;

const PRESETS = ['En 1 hora', 'Hoy a las 17:00', 'Mañana a las 9:00', 'En 3 días', 'El lunes a las 9:00', 'Otra fecha…'];

export default function DiaRecordatorio(): JSX.Element {
    return (
        <Stage label="En la ficha de un registro se toca Recordarme, se elige Mañana a las 9:00 y se crea el recordatorio; al llegar la hora aparece el aviso en la campana." tint="amber">
            <Keyframes css={CSS} />
            {/* Ficha */}
            <At x={20} y={14} w={440} h={272} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 40px -22px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 12px', borderBottom: `1px solid ${C.border}`, gap: 8 }}>
                    <T size={8.5} color={C.mutedFg} style={{ flex: 1 }}>
                        Clientes / Clínica Norte
                    </T>
                </div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <T size={15} weight={700}>
                        Clínica Norte
                    </T>
                    {[
                        ['NIT', '811.072.722-1'],
                        ['Contacto', 'Carlos Ruiz'],
                        ['Teléfono', '+57 320 903 0795'],
                        ['Estado', 'Renovación pendiente'],
                        ['Ciudad', 'Bogotá'],
                        ['Valor del contrato', '$ 4.800.000'],
                    ].map(([k, v]) => (
                        <span key={k} style={{ display: 'flex', alignItems: 'center', height: 22, borderBottom: `1px solid ${C.border}` }}>
                            <T size={8.5} color={C.mutedFg} style={{ width: 90 }}>
                                {k}
                            </T>
                            <T size={9} weight={600}>
                                {v}
                            </T>
                        </span>
                    ))}
                </div>
            </At>
            {/* Botones de la barra de la ficha */}
            <At x={316} y={20} w={22} h={22} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>
                <Eye size={12} />
            </At>
            <At x={340} y={20} w={22} h={22} a="rc-btn" style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fg }}>
                <AlarmClock size={12} />
            </At>
            <At x={386} y={20} w={22} h={22} a="rc-shake" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fg, transformOrigin: '50% 10%' }}>
                <Bell size={12} />
            </At>
            <At x={398} y={16} a="rc-badge" style={{ opacity: 0 }}>
                <span style={{ minWidth: 12, height: 12, borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 7, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            </At>

            {/* Popover Recordarme */}
            <At x={222} y={46} w={168} a="rc-pop" style={{ opacity: 0, zIndex: 5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 18px 40px -16px rgba(15,23,42,.6)', padding: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={9} weight={700}>
                    Recordarme este registro
                </T>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                    {PRESETS.map((p) => (
                        <span
                            key={p}
                            data-a={p.startsWith('Mañana') ? '' : undefined}
                            style={{ fontSize: 7.5, fontWeight: 600, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.fg, animationName: p.startsWith('Mañana') ? 'rc-pick' : undefined, whiteSpace: 'nowrap' }}
                        >
                            {p}
                        </span>
                    ))}
                </div>
                <span style={{ marginTop: 3, height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                    <T size={7.5} color={C.mutedFg}>
                        Llamar para renovar el contrato
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <T size={7} color={C.mutedFg}>
                        28/10/2026 9:00 a. m.
                    </T>
                    <Btn label="Recordarme" style={{ height: 18, fontSize: 8 }} />
                </span>
            </At>

            {/* Confirmación */}
            <At x={150} y={244} a="rc-toast" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 11px', borderRadius: 8, background: C.fg, color: C.card, fontSize: 8.5, fontWeight: 600 }}>
                    ✓ Recordatorio creado · 28/10/2026 9:00 a. m.
                </span>
            </At>

            {/* Pasa el tiempo */}
            <At x={196} y={110} a="rc-clock" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ width: 88, height: 88, borderRadius: 99, background: C.card, border: `3px solid ${primary()}`, boxShadow: '0 16px 36px -14px rgba(15,23,42,.6)', position: 'relative', display: 'block' }}>
                    <span data-a="" style={{ position: 'absolute', left: 41, top: 14, width: 3, height: 30, borderRadius: 2, background: C.fg, transformOrigin: '50% 100%', animationName: 'rc-hand' }} />
                    <span style={{ position: 'absolute', left: 39, top: 40, width: 7, height: 7, borderRadius: 99, background: primary() }} />
                    <span style={{ position: 'absolute', left: 0, right: 0, bottom: -20, display: 'flex', justifyContent: 'center' }}>
                        <T size={9} weight={700} color={primary()} style={{ background: C.card, padding: '1px 6px', borderRadius: 99 }}>
                            Mañana, 9:00
                        </T>
                    </span>
                </span>
            </At>

            {/* El aviso */}
            <At x={212} y={48} w={236} a="rc-notif" style={{ opacity: 0, zIndex: 7, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 18px 40px -16px rgba(15,23,42,.6)', padding: '9px 10px', display: 'flex', gap: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: 99, background: tone('amber', 0.18), color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlarmClock size={12} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={8.5} weight={700}>
                        Recordatorio: Clínica Norte
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Llamar para renovar el contrato
                    </T>
                </span>
            </At>
            <Cursor a="rc-cur" click="rc-ring" rest={[200, 250]} />
        </Stage>
    );
}
