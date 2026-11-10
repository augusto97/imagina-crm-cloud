import { Check, KeyRound, Search, Webhook } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.389 — conectar WhatsApp con Imagina WAS: pegar la clave de API, tocar
 * «Buscar mis cuentas» y elegir el número (aparece solo, con su estado), y
 * los avisos quedan registrados sin hacer nada más. Al final, la conexión
 * lista para mandar mensajes y archivos y recibir lo que escriben.
 */

const STEPS = [
    { icon: <KeyRound size={12} />, title: 'Pega la clave de API', where: 'Tu panel de Whats → API Keys' },
    { icon: <Search size={12} />, title: 'Buscar mis cuentas', where: 'Eliges el número de la lista' },
    { icon: <Webhook size={12} />, title: 'Avisos registrados solos', where: 'Mensajes y estados, sin configurar' },
];

const NUMBERS = [
    { phone: '+57 317 833 9119', name: 'Café Aurora', ok: true },
    { phone: '+57 300 555 0142', name: 'Bodega', ok: false },
];

const CSS = `
${STEPS.map(
    (_, i) => `
@keyframes wiw-s${i}{0%,${6 + i * 18}%{border-color:${C.border};background:${C.card}}${10 + i * 18}%,92%{border-color:${tone('mint', 0.55)};background:${tone('mint', 0.07)}}97%,100%{border-color:${C.border};background:${C.card}}}
@keyframes wiw-c${i}{0%,${8 + i * 18}%{opacity:0;transform:scale(.4)}${12 + i * 18}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}`,
).join('')}
@keyframes wiw-list{0%,22%{opacity:0;transform:translateY(6px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes wiw-pick{0%,32%{border-color:${C.border};background:${C.card}}36%,92%{border-color:${tone('mint', 0.6)};background:${tone('mint', 0.09)}}97%,100%{border-color:${C.border};background:${C.card}}}
@keyframes wiw-done{0%,62%{opacity:0;transform:translateY(8px) scale(.97)}68%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
`;

export default function WabWasConectar(): JSX.Element {
    return (
        <Stage
            label="Conectar WhatsApp con Whats: pegas la clave de API, tocas «Buscar mis cuentas» y eliges tu número de la lista, y los avisos de mensajes y estados quedan registrados solos."
            tint="mint"
        >
            <Keyframes css={CSS} />
            {STEPS.map((s, i) => (
                <At
                    key={s.title}
                    x={20}
                    y={24 + i * 56}
                    w={230}
                    h={46}
                    a={`wiw-s${i}`}
                    style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)' }}
                >
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: primary(0.12), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                        <T size={9.5} weight={700}>
                            {s.title}
                        </T>
                        <T size={8} color={C.mutedFg}>
                            {s.where}
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{ animationName: `wiw-c${i}`, width: 17, height: 17, borderRadius: 99, background: C.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                        <Check size={11} strokeWidth={3} />
                    </span>
                </At>
            ))}

            {/* Los números que trae «Buscar mis cuentas» */}
            <At x={20} y={200} w={230} h={80} a="wiw-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {NUMBERS.map((n, i) => (
                    <span
                        key={n.phone}
                        data-a=""
                        style={{
                            animationName: i === 0 ? 'wiw-pick' : undefined,
                            border: `1px solid ${C.border}`,
                            background: C.card,
                            borderRadius: 9,
                            height: 34,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '0 9px',
                        }}
                    >
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: n.ok ? C.success : C.mutedFg, flexShrink: 0 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                            <T size={9} weight={700}>
                                {n.phone}
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                {n.name} · {n.ok ? 'Conectado' : 'Desconectado'}
                            </T>
                        </span>
                    </span>
                ))}
            </At>

            {/* La conexión lista */}
            <At
                x={280}
                y={70}
                w={180}
                h={160}
                a="wiw-done"
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 13, boxShadow: '0 16px 36px -16px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                <IntegrationLogo integrationKey="whatsapp_web" size={36} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={10.5} weight={700}>
                        WhatsApp (Whats)
                    </T>
                    <T size={9} color={C.mutedFg}>
                        +57 317 833 9119 · Café Aurora
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ height: 17, padding: '0 7px', borderRadius: 99, background: 'hsl(var(--imcrm-success) / .14)', color: C.success, fontSize: 8.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Conectado</span>
                    <span style={{ height: 17, padding: '0 7px', borderRadius: 99, background: tone('mint', 0.14), color: tone('mint'), fontSize: 8.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Avisos activos</span>
                </span>
                <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Mensajes y archivos cuando quieras · lo que te escriben llega a la lista
                </T>
            </At>
        </Stage>
    );
}
