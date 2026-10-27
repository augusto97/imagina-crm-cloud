import { FileText, Inbox, PenLine, Send } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La acción «Enviar email» de una automatización: destinatario y asunto con
 * variables, el formato «Diseño visual», la firma y un PDF adjunto; y
 * «Enviarme una prueba», que deja el correo en tu bandeja.
 */

const CSS = `
@keyframes ce-cur{0%,30%{transform:translate(250px,40px)}44%,100%{transform:translate(206px,262px)}}
@keyframes ce-click{0%,44%{opacity:0;transform:scale(.4)}46%{opacity:1;transform:scale(1)}54%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ce-btn{0%,44%{background:transparent}46%,54%{background:${primary(0.14)}}60%,100%{background:transparent}}
@keyframes ce-toast{0%,52%{opacity:0;transform:translateY(-8px)}58%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes ce-mail{0%,60%{opacity:0;transform:translateX(14px)}68%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes ce-tag{0%,8%{background:${tone('violet', 0.12)}}14%,22%{background:${tone('violet', 0.32)}}28%,100%{background:${tone('violet', 0.12)}}}
`;

function Field({ label, children }: { label: string; children: JSX.Element | JSX.Element[] | string }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={7.5} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ height: 20, display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.card }}>{children}</span>
        </span>
    );
}

function Tag({ name, a }: { name: string; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ display: 'inline-flex', alignItems: 'center', height: 14, padding: '0 5px', borderRadius: 4, background: tone('violet', 0.12), animationName: a }}>
            <T size={7.5} weight={700} color={tone('violet')}>
                {`{{${name}}}`}
            </T>
        </span>
    );
}

export default function CorreoEnviar(): JSX.Element {
    return (
        <Stage label="La acción «Enviar email»: para el correo del registro, un asunto con variables, formato «Diseño visual», la firma y la cuenta de cobro adjunta. Al tocar «Enviarme una prueba», el correo llega a tu bandeja con los datos del último registro." tint="blue">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={16} y={14} w={248} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 11, boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('blue', 0.16), color: tone('blue'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Send size={11} />
                        </span>
                        <T size={10} weight={700}>
                            Enviar email
                        </T>
                    </span>
                    <Field label="Para">
                        <Tag name="email" a="ce-tag" />
                    </Field>
                    <Field label="Asunto">
                        <T size={8.5}>Tu cuenta de cobro</T>
                        <Tag name="numero" />
                    </Field>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600} color={C.mutedFg}>
                            Formato del correo
                        </T>
                        <span style={{ display: 'flex', height: 20, borderRadius: 6, background: C.muted, padding: 2, gap: 2 }}>
                            {['Diseño visual', 'Texto', 'HTML'].map((o, i) => (
                                <span key={o} style={{ flex: i === 0 ? 1.6 : 1, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? C.card : 'transparent', boxShadow: i === 0 ? '0 1px 3px rgba(15,23,42,.18)' : 'none' }}>
                                    <T size={7.5} weight={i === 0 ? 700 : 500} color={i === 0 ? C.fg : C.mutedFg}>
                                        {o}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 7, border: `1px dashed ${primary(0.5)}`, background: primary(0.06) }}>
                        <T size={8} weight={700} color={primary()}>
                            Editar diseño
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                            7 bloques
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 12, borderRadius: 99, background: primary(), position: 'relative' }}>
                            <span style={{ position: 'absolute', right: 2, top: 2, width: 8, height: 8, borderRadius: 99, background: '#fff' }} />
                        </span>
                        <PenLine size={10} color={C.mutedFg} />
                        <T size={8}>Agregar la firma · Laura Gómez</T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <T size={7.5} weight={600} color={C.mutedFg}>
                            Adjuntar PDF
                        </T>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 6px', borderRadius: 99, background: tone('rose', 0.12) }}>
                            <FileText size={9} color={tone('rose')} />
                            <T size={7.5} weight={600} color={tone('rose')}>
                                Cuenta de cobro
                            </T>
                        </span>
                    </span>
                    <span data-a="" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 26, borderRadius: 7, border: `1px solid ${C.border}`, animationName: 'ce-btn' }}>
                        <Inbox size={11} color={C.fg} />
                        <T size={8.5} weight={600}>
                            Enviarme una prueba
                        </T>
                    </span>
                </At>

                {/* Aviso de la prueba */}
                <At x={280} y={22} w={186} a="ce-toast" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', boxShadow: '0 12px 26px -14px rgba(15,23,42,.5)', display: 'flex', gap: 7, alignItems: 'center' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: C.success }} />
                    <T size={8} weight={600} style={{ whiteSpace: 'normal' }}>
                        Te enviamos la prueba a laura@cafeaurora.co
                    </T>
                </At>

                {/* Bandeja de entrada */}
                <At x={280} y={78} w={186} a="ce-mail" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <Inbox size={10} color={C.mutedFg} />
                        <T size={8} weight={700}>
                            Recibidos
                        </T>
                    </span>
                    {[
                        { from: 'Café Aurora', subj: 'Tu cuenta de cobro CC-0042', pre: 'Hola Ana, te enviamos tu cuenta…', on: true },
                        { from: 'Banco', subj: 'Extracto de octubre', pre: 'Tu extracto ya está disponible', on: false },
                        { from: 'Proveedor', subj: 'Lista de precios', pre: 'Te compartimos la lista…', on: false },
                    ].map((m) => (
                        <span key={m.subj} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 10px', borderBottom: `1px solid ${C.border}`, background: m.on ? primary(0.07) : 'transparent', opacity: m.on ? 1 : 0.55 }}>
                            <T size={8} weight={m.on ? 800 : 600}>
                                {m.from}
                            </T>
                            <T size={7.5} weight={m.on ? 700 : 500}>
                                {m.subj}
                            </T>
                            <T size={7} color={C.mutedFg}>
                                {m.pre}
                            </T>
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px' }}>
                        <FileText size={9} color={tone('rose')} />
                        <T size={7} color={C.mutedFg}>
                            Adjunto: Cuenta de cobro CC-0042.pdf
                        </T>
                    </span>
                </At>
                <Cursor a="ce-cur" click="ce-click" rest={[206, 262]} />
            </div>
        </Stage>
    );
}
