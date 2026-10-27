import { CheckCheck, ChevronDown, Search, Send } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Btn, Bubble, C, Cursor, Keyframes, Stage, T, tone } from '../kit';

/**
 * Conectar una app con una clave (WhatsApp de WAS): pegas la clave, buscas tu
 * cuenta, te mandas un mensaje de prueba y, cuando llega al teléfono,
 * conectas.
 */

const CSS = `
@keyframes ik-key{0%,8%{width:0}20%,100%{width:92px}}
@keyframes ik-acc{0%,30%{opacity:0}34%,100%{opacity:1}}
@keyframes ik-ph{0%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes ik-num{0%,40%{width:0}50%,100%{width:84px}}
@keyframes ik-cur{0%{transform:translate(200px,280px);opacity:0}5%{opacity:1}22%,28%{transform:translate(80px,126px)}52%,58%{transform:translate(236px,222px)}82%,86%{transform:translate(244px,262px)}94%,100%{transform:translate(244px,262px);opacity:0}}
@keyframes ik-ring{0%,25%{opacity:0;transform:scale(.4)}26%{opacity:1;transform:scale(1)}30%{opacity:0;transform:scale(1.6)}54%{opacity:0;transform:scale(.4)}55%{opacity:1;transform:scale(1)}59%{opacity:0;transform:scale(1.6)}83%{opacity:0;transform:scale(.4)}84%{opacity:1;transform:scale(1)}88%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ik-msg{0%,62%{opacity:0;transform:translateY(8px) scale(.96)}67%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes ik-ok{0%,68%{opacity:0}72%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ik-badge{0%,64%{opacity:0;transform:scale(.6)}68%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Field({ label, children, y }: { label: string; children: JSX.Element; y: number }): JSX.Element {
    return (
        <At x={16} y={y} w={248} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={8.5} weight={600}>
                {label}
            </T>
            <span
                style={{
                    height: 22,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    gap: 6,
                    overflow: 'hidden',
                }}
            >
                {children}
            </span>
        </At>
    );
}

export default function IntegKeyTest(): JSX.Element {
    return (
        <Stage label="Conectar WhatsApp (WAS): pegas la clave de API, eliges tu cuenta, te mandas un mensaje de prueba y, cuando te llega al teléfono, tocas Conectar." tint="mint">
            <Keyframes css={CSS} />

            {/* El diálogo de conexión */}
            <At
                x={22}
                y={18}
                w={280}
                h={266}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 13,
                    boxShadow: '0 16px 38px -18px rgba(15,23,42,.55)',
                    overflow: 'hidden',
                }}
            >
                <At x={16} y={14} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <IntegrationLogo integrationKey="whatsapp" size={30} />
                    <T size={12} weight={700}>
                        Conectar WhatsApp (WAS)
                    </T>
                </At>
                <Field label="Clave de API" y={56}>
                    <span data-a="" style={{ animationName: 'ik-key', overflow: 'hidden', width: 92, whiteSpace: 'nowrap', fontSize: 10, letterSpacing: 1, color: C.fg }}>
                        ••••••••••••••
                    </span>
                </Field>
                <At x={16} y={102} style={{ display: 'flex' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 8.5, fontWeight: 600 }}>
                        <Search size={10} /> Buscar mis cuentas
                    </span>
                </At>
                <Field label="Cuenta de WhatsApp" y={130}>
                    <>
                        <span style={{ position: 'relative', flex: 1, height: 14 }}>
                            <span data-a="" style={{ animationName: 'ik-ph', position: 'absolute', left: 0, top: 0, fontSize: 9.5, color: C.mutedFg }}>
                                Elige la cuenta
                            </span>
                            <span data-a="" style={{ animationName: 'ik-acc', position: 'absolute', left: 0, top: 0, fontSize: 9.5, fontWeight: 600 }}>
                                Café Aurora · +57 300 555 0101
                            </span>
                        </span>
                        <ChevronDown size={11} color={C.mutedFg} />
                    </>
                </Field>
                {/* Mensaje de prueba */}
                <At x={16} y={178} w={248} h={52} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <T size={8.5} weight={600}>
                        Número para el mensaje de prueba
                    </T>
                    <span style={{ display: 'flex', gap: 6 }}>
                        <span style={{ flex: 1, height: 20, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
                            <span data-a="" style={{ animationName: 'ik-num', overflow: 'hidden', whiteSpace: 'nowrap', width: 84, fontSize: 9.5 }}>
                                +57 310 222 3344
                            </span>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 8.5, fontWeight: 600 }}>
                            <Send size={10} /> Enviar prueba
                        </span>
                    </span>
                </At>
                <At x={16} y={236} w={176} a="ik-ok" style={{ opacity: 1 }}>
                    <T size={8} weight={600} color={C.success} style={{ whiteSpace: 'normal', display: 'block' }}>
                        Mensaje de prueba enviado. Si te llegó, ya puedes conectar.
                    </T>
                </At>
                <At x={204} y={238}>
                    <Btn label="Conectar" />
                </At>
            </At>

            {/* El teléfono que recibe la prueba */}
            <At
                x={330}
                y={34}
                w={128}
                h={234}
                style={{ borderRadius: 20, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)' }}
            >
                <div style={{ height: 30, background: '#128C7E', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 99, background: 'rgba(255,255,255,.35)' }} />
                    <T size={8.5} weight={700} color="#fff">
                        Café Aurora
                    </T>
                </div>
                <div style={{ position: 'relative', height: 196, background: tone('mint', 0.08) }}>
                    <At x={7} y={14} a="ik-msg" style={{ opacity: 1 }}>
                        <Bubble side="left" style={{ maxWidth: 106 }}>
                            ✅ Mensaje de prueba: la conexión funciona.
                            <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, marginTop: 2, color: tone('blue') }}>
                                <T size={7} color={C.mutedFg}>
                                    10:42
                                </T>
                                <CheckCheck size={10} />
                            </span>
                        </Bubble>
                    </At>
                </div>
            </At>
            <At x={442} y={26} a="ik-badge" style={{ opacity: 1 }}>
                <span style={{ minWidth: 17, height: 17, borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
            </At>

            <Cursor a="ik-cur" click="ik-ring" />
        </Stage>
    );
}
