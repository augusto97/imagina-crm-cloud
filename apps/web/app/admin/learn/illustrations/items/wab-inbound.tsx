import { MessageCircle, Search, Sparkles } from 'lucide-react';

import { At, Avatar, Bubble, C, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Un cliente nuevo escribe: la app busca su número en la lista de contactos,
 * como no está crea el registro con el nombre de su perfil, deja el último
 * mensaje y dispara «Cuando llega un mensaje de WhatsApp»; un campo con IA
 * clasifica la intención.
 */

const CSS = `
@keyframes wi-msg{0%,4%{opacity:0;transform:translateY(8px) scale(.96)}10%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes wi-pkt{0%,14%{opacity:0;transform:translate(0,0)}17%{opacity:1}30%{opacity:1;transform:translate(-120px,0)}32%,100%{opacity:0;transform:translate(-120px,0)}}
@keyframes wi-search{0%,28%{opacity:0}32%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes wi-row{0%,44%{opacity:0;transform:translateY(-6px);background:transparent}50%{opacity:1;transform:translateY(0);background:${tone('mint', 0.16)}}66%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes wi-trig{0%,58%{box-shadow:0 0 0 0 transparent}63%,70%{box-shadow:0 0 0 3px ${primary(0.35)}}76%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes wi-ai{0%,70%{opacity:0;transform:scale(.6)}76%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

const ROWS = [
    { n: 'Carlos Ruiz', ph: '+57 300 118 2040', m: '¿Tienen domicilio?', t: 'amber' as const },
    { n: 'Lucía Martínez', ph: '+57 312 904 1188', m: 'Perfecto, gracias', t: 'violet' as const },
];

function Row({ n, ph, m, t, extra }: { n: string; ph: string; m: string; t: 'amber' | 'violet' | 'blue'; extra?: JSX.Element }): JSX.Element {
    return (
        <span style={{ display: 'grid', gridTemplateColumns: '84px 76px 1fr 44px', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <Avatar initials={n.split(' ').map((w) => w[0]).join('')} t={t} size={15} />
                <T size={8.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {n}
                </T>
            </span>
            <T size={8} color={C.mutedFg}>
                {ph}
            </T>
            <T size={8.5} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m}
            </T>
            <span>{extra}</span>
        </span>
    );
}

export default function WabInbound(): JSX.Element {
    return (
        <Stage label="Un cliente nuevo escribe por WhatsApp: la app busca su número en la lista de contactos, crea el registro con su nombre, deja el último mensaje, dispara la automatización y un campo con IA clasifica la intención." tint="mint">
            <Keyframes css={CSS} />

            {/* La lista de contactos */}
            <At x={12} y={20} w={322} h={162} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px -18px rgba(15,23,42,.5)' }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={9.5} weight={700}>
                        Contactos por WhatsApp
                    </T>
                    <span data-a="" style={{ animationName: 'wi-search', marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 7px', borderRadius: 99, background: primary(0.12), color: primary(), fontSize: 8, fontWeight: 700 }}>
                        <Search size={9} /> +57 315 660 7781
                    </span>
                </div>
                <span style={{ display: 'grid', gridTemplateColumns: '84px 76px 1fr 44px', gap: 6, height: 20, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Nombre', 'Teléfono', 'Último mensaje', 'Intención'].map((h) => (
                        <T key={h} size={7.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    ))}
                </span>
                <div data-a="" style={{ animationName: 'wi-row' }}>
                    <Row
                        n="Carolina Díaz"
                        ph="+57 315 660 7781"
                        m="2 cajas de café"
                        t="blue"
                        extra={
                            <span data-a="" style={{ animationName: 'wi-ai', display: 'inline-flex', alignItems: 'center', gap: 2, height: 15, padding: '0 5px', borderRadius: 5, background: tone('violet'), color: '#fff', fontSize: 7.5, fontWeight: 700, flexShrink: 0 }}>
                                <Sparkles size={8} /> Pedido
                            </span>
                        }
                    />
                </div>
                {ROWS.map((r) => (
                    <Row key={r.n} {...r} />
                ))}
            </At>

            {/* La automatización que se dispara */}
            <At x={12} y={198} w={322} h={78} a="wi-trig" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconSquare t="mint" size={24}>
                        <MessageCircle size={13} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Cuando
                        </T>
                        <T size={10} weight={600}>
                            Llega un mensaje de WhatsApp
                        </T>
                    </span>
                </span>
                <T size={8.5} color={C.mutedFg}>
                    {'Variables: {{whatsapp.texto}} · {{whatsapp.nombre}} · {{whatsapp.de}}'}
                </T>
            </At>

            {/* El teléfono del cliente */}
            <At x={346} y={22} w={118} h={256} style={{ borderRadius: 20, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)' }}>
                <div style={{ height: 30, background: '#128C7E', display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px' }}>
                    <span style={{ width: 15, height: 15, borderRadius: 99, background: 'rgba(255,255,255,.35)' }} />
                    <T size={8} weight={700} color="#fff">
                        Café Aurora ✓
                    </T>
                </div>
                <div style={{ position: 'relative', height: 216, background: tone('mint', 0.08) }}>
                    <At x={14} y={14} a="wi-msg" style={{ opacity: 1 }}>
                        <Bubble side="right" style={{ maxWidth: 88 }}>
                            Hola, quiero 2 cajas de café para mi oficina ☕
                        </Bubble>
                    </At>
                </div>
            </At>
            <At x={330} y={60} a="wi-pkt" style={{ opacity: 0 }}>
                <span style={{ display: 'block', width: 10, height: 10, borderRadius: 99, background: '#25D366', boxShadow: '0 0 0 4px rgba(37,211,102,.25)' }} />
            </At>
        </Stage>
    );
}
