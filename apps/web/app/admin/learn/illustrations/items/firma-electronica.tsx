import { CheckCircle2, Clock, FileSignature, Mail, ShieldCheck } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Firma electrónica: desde la ficha se pide la firma de un contrato; la
 * persona lo abre en el celular, pone el código que le llegó al correo,
 * dibuja su firma y firma. La ficha pasa a «Firmado» con el PDF firmado.
 */

const CSS = `
@keyframes fe-phone{0%,10%{opacity:0;transform:translateY(10px)}16%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes fe-code{0%,22%{opacity:0}26%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fe-ink{0%,30%{stroke-dashoffset:220}52%,92%{stroke-dashoffset:0}97%,100%{stroke-dashoffset:220}}
@keyframes fe-btn{0%,54%{box-shadow:0 0 0 0 transparent}58%,62%{box-shadow:0 0 0 4px ${primary(0.3)}}66%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes fe-done{0%,62%{opacity:0;transform:scale(.96)}66%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes fe-s1a{0%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes fe-s1b{0%,62%{opacity:0}66%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fe-s2a{0%,74%{opacity:1}78%,100%{opacity:0}}
@keyframes fe-s2b{0%,74%{opacity:0}78%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fe-chip{0%,80%{opacity:0}84%,92%{opacity:1}97%,100%{opacity:0}}
`;

function Status({ label, t, icon, a }: { label: string; t: 'mint' | 'amber' | 'slate'; icon: JSX.Element; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, animationName: a, display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 6px', borderRadius: 99, background: tone(t, 0.15), color: tone(t) }}>
            {icon}
            <T size={6.5} weight={700} color={tone(t)}>
                {label}
            </T>
        </span>
    );
}

function Signer({ name, mail, before, after }: { name: string; mail: string; before: [string, string]; after: [string, string] }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 0', borderTop: `1px solid ${C.border}` }}>
            <span style={{ width: 20, height: 20, borderRadius: 99, background: C.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <T size={7} weight={700}>
                    {name.split(' ').map((p) => p[0]).join('')}
                </T>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                <T size={8.5} weight={600}>
                    {name}
                </T>
                <T size={6.5} color={C.mutedFg}>
                    {mail}
                </T>
            </span>
            <span style={{ position: 'relative', width: 70, height: 15 }}>
                <Status label={before[0]} t={before[1] === 'wait' ? 'slate' : 'amber'} icon={before[1] === 'wait' ? <Clock size={8} /> : <Mail size={8} />} a={name.startsWith('Carla') ? 'fe-s1a' : 'fe-s2a'} />
                <Status label={after[0]} t="mint" icon={<CheckCircle2 size={8} />} a={name.startsWith('Carla') ? 'fe-s1b' : 'fe-s2b'} />
            </span>
        </span>
    );
}

export default function FirmaElectronica(): JSX.Element {
    return (
        <Stage label="Desde la ficha se pide la firma de un contrato a dos personas. La primera lo abre en el celular, pone el código que le llegó al correo, dibuja su firma y firma; cuando firman las dos, la ficha muestra «Firmado» con el PDF firmado." tint="mint" cycle={8}>
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={14} y={22} w={250} h={256} title="Contratos · Beta Ltda.">
                    <At x={12} y={10} w={226}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileSignature size={12} color={C.mutedFg} />
                            <T size={10} weight={700}>
                                Firmas
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, padding: '7px 8px', borderRadius: 8, background: C.muted }}>
                            <T size={8.5} weight={700} style={{ flex: 1 }}>
                                Contrato de servicios CT-0007
                            </T>
                            <span data-a="" style={{ animationName: 'fe-chip', opacity: 0, display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 6px', borderRadius: 99, background: tone('mint'), color: '#fff' }}>
                                <ShieldCheck size={8} />
                                <T size={6.5} weight={700} color="#fff">
                                    Firmado
                                </T>
                            </span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                            <Signer name="Carla Ruiz" mail="ca***@cliente.co" before={['Lo abrió', 'sent']} after={['Firmó', 'ok']} />
                            <Signer name="Ana Gómez" mail="an***@acme.co" before={['Le toca después', 'wait']} after={['Firmó', 'ok']} />
                        </span>
                        <span style={{ display: 'block', marginTop: 10 }}>
                            <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                                Al firmar todos, el PDF firmado con la constancia se guarda en el registro y les llega a todos por correo.
                            </T>
                        </span>
                    </At>
                </Win>

                {/* El celular de quien firma */}
                <At x={290} y={18} w={168} h={266} a="fe-phone" style={{ opacity: 0, borderRadius: 22, border: `6px solid #1f2937`, background: C.card, boxShadow: '0 18px 40px -18px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={9} weight={800}>
                            Contrato de servicios
                        </T>
                        <span style={{ height: 52, borderRadius: 5, background: C.muted, display: 'flex', flexDirection: 'column', gap: 4, padding: 7 }}>
                            {[90, 70, 82, 55].map((w) => (
                                <span key={w} style={{ display: 'block', width: `${w}%`, height: 3, borderRadius: 99, background: C.border }} />
                            ))}
                        </span>
                        <T size={6.5} weight={700} color={C.mutedFg}>
                            CÓDIGO QUE TE LLEGÓ AL CORREO
                        </T>
                        <span data-a="" style={{ animationName: 'fe-code', opacity: 0, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.35em' }}>
                            <T size={9} weight={700}>
                                482913
                            </T>
                        </span>
                        <T size={6.5} weight={700} color={C.mutedFg}>
                            TU FIRMA
                        </T>
                        <span style={{ height: 50, borderRadius: 6, border: `1px dashed ${C.border}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="120" height="40" viewBox="0 0 120 40">
                                <path
                                    data-a=""
                                    d="M6 28 C 18 6, 24 6, 28 24 S 40 36, 46 18 S 58 6, 62 22 S 76 34, 84 16 S 100 10, 114 20"
                                    fill="none"
                                    stroke="#1e293b"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    style={{ strokeDasharray: 220, strokeDashoffset: 220, animationName: 'fe-ink' }}
                                />
                            </svg>
                        </span>
                        <span data-a="" style={{ animationName: 'fe-btn', height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <FileSignature size={10} color={C.primaryFg} />
                            <T size={8.5} weight={700} color={C.primaryFg}>
                                Firmar
                            </T>
                        </span>
                    </div>
                    <At x={0} y={0} w={156} h={254} a="fe-done" style={{ opacity: 0, background: C.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 14, textAlign: 'center' }}>
                        <CheckCircle2 size={28} color={tone('mint')} />
                        <T size={10} weight={800}>
                            ¡Firmaste el documento!
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                            Cuando firmen las demás personas, te llega el PDF firmado.
                        </T>
                    </At>
                </At>
            </div>
        </Stage>
    );
}
