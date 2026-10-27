import { Building2, Check, ChevronDown, Coffee, KeyRound, LogOut, Mail, Shield } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Cómo entra el cliente: elige entrar con contraseña y, ya adentro, cambia entre sus cuentas desde el menú. */

const CSS = `
@keyframes plg-cursor{0%{transform:translate(140px,290px);opacity:0}5%{opacity:1}12%,16%{transform:translate(162px,120px)}34%,38%{transform:translate(120px,235px)}46%{transform:translate(400px,54px)}50%,54%{transform:translate(412px,48px)}66%,70%{transform:translate(372px,110px);opacity:1}80%,100%{transform:translate(372px,110px);opacity:0}}
@keyframes plg-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}35%{opacity:0;transform:scale(.4)}37%{opacity:1;transform:scale(1)}40%{opacity:0;transform:scale(1.6)}51%{opacity:0;transform:scale(.4)}53%{opacity:1;transform:scale(1)}56%{opacity:0;transform:scale(1.6)}67%{opacity:0;transform:scale(.4)}69%{opacity:1;transform:scale(1)}72%,100%{opacity:0;transform:scale(1.6)}}
@keyframes plg-segA{0%,14%{background:${C.card};color:${C.fg}}17%,96%{background:transparent;color:${C.mutedFg}}100%{background:${C.card};color:${C.fg}}}
@keyframes plg-segB{0%,14%{background:transparent;color:${C.mutedFg}}17%,96%{background:${C.card};color:${C.fg}}100%{background:transparent;color:${C.mutedFg}}}
@keyframes plg-link{0%,14%{opacity:1}17%,96%{opacity:0}100%{opacity:1}}
@keyframes plg-pass{0%,14%{opacity:0}17%,96%{opacity:1}100%{opacity:0}}
@keyframes plg-t1{0%,18%{width:0}26%,100%{width:66px}}
@keyframes plg-t2{0%,26%{width:0}32%,100%{width:44px}}
@keyframes plg-menu{0%,52%{opacity:0;transform:translateY(-6px) scale(.97)}56%,70%{opacity:1;transform:translateY(0) scale(1)}74%,100%{opacity:0;transform:translateY(-6px) scale(.97)}}
@keyframes plg-acc1{0%,70%{opacity:1}73%,96%{opacity:0}100%{opacity:1}}
@keyframes plg-acc2{0%,70%{opacity:0}73%,96%{opacity:1}100%{opacity:0}}
@keyframes plg-glow{0%,72%{background:transparent}76%,86%{background:${primary(0.08)}}94%,100%{background:transparent}}
`;

function MenuRow({ icon, label, check, muted }: { icon: JSX.Element; label: string; check?: boolean; muted?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 19, padding: '0 8px' }}>
            <span style={{ color: C.mutedFg, display: 'flex' }}>{icon}</span>
            <T size={8} weight={check ? 700 : 500} color={muted ? C.mutedFg : C.fg} style={{ flex: 1 }}>
                {label}
            </T>
            {check && <Check size={10} color={primary()} strokeWidth={3} />}
        </span>
    );
}

export default function PortalLogin(): JSX.Element {
    return (
        <Stage label="La pantalla para entrar al portal ofrece entrar con un enlace por correo o con contraseña. Ya adentro, el menú de la cuenta deja cambiar entre los registros del cliente." tint="cyan">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Pantalla de entrar */}
                <At
                    x={22}
                    y={30}
                    w={196}
                    h={240}
                    style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)', padding: 14 }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={11} />
                        </span>
                        <T size={8.5} weight={800}>
                            Café Aurora
                        </T>
                    </span>
                    <At x={14} y={44} w={168}>
                        <T size={12} weight={800}>
                            Entrar a tu portal
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ display: 'block', marginTop: 3 }}>
                            Elige cómo quieres entrar.
                        </T>
                        <span style={{ display: 'flex', marginTop: 10, padding: 2, gap: 2, borderRadius: 7, background: C.muted }}>
                            {(['Con un enlace por correo', 'Con contraseña'] as const).map((l, i) => (
                                <span
                                    key={l}
                                    data-a=""
                                    style={{
                                        flex: 1,
                                        textAlign: 'center',
                                        padding: '4px 0',
                                        borderRadius: 5,
                                        fontSize: 7,
                                        fontWeight: 700,
                                        color: i ? C.fg : C.mutedFg,
                                        background: i ? C.card : 'transparent',
                                        animationName: i ? 'plg-segB' : 'plg-segA',
                                    }}
                                >
                                    {l}
                                </span>
                            ))}
                        </span>
                    </At>
                    {/* Con enlace */}
                    <At x={14} y={112} w={168} a="plg-link" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={7.5} weight={700}>
                            Correo
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}` }} />
                        <span style={{ height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <Mail size={9} color={C.primaryFg} />
                            <T size={8} weight={700} color={C.primaryFg}>
                                Enviarme un enlace
                            </T>
                        </span>
                    </At>
                    {/* Con contraseña */}
                    <At x={14} y={112} w={168} a="plg-pass" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <T size={7.5} weight={700}>
                            Correo
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 66, animationName: 'plg-t1' }}>
                                <T size={8}>ramiro@lav.co</T>
                            </span>
                        </span>
                        <T size={7.5} weight={700}>
                            Contraseña
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 44, animationName: 'plg-t2' }}>
                                <T size={9} weight={800} style={{ letterSpacing: 1 }}>
                                    ••••••••
                                </T>
                            </span>
                        </span>
                        <span style={{ marginTop: 3, height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Entrar
                            </T>
                        </span>
                    </At>
                </At>

                {/* Ya adentro: el menú de la cuenta */}
                <At
                    x={236}
                    y={30}
                    w={226}
                    h={240}
                    style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)', overflow: 'hidden' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={10} />
                        </span>
                        <T size={8} weight={800}>
                            Café Aurora
                        </T>
                        <span data-a="" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, animationName: 'plg-glow' }}>
                            <span style={{ position: 'relative', width: 62, height: 10 }}>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'plg-acc1' }}>
                                    <T size={7.5} weight={700}>
                                        Lav. Centro
                                    </T>
                                </span>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'plg-acc2' }}>
                                    <T size={7.5} weight={700}>
                                        Lav. Norte
                                    </T>
                                </span>
                            </span>
                            <ChevronDown size={9} color={C.mutedFg} />
                        </span>
                    </div>
                    <At x={12} y={46} w={202}>
                        <span style={{ position: 'relative', display: 'block', height: 16 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'plg-acc1' }}>
                                <T size={11.5} weight={800}>
                                    Lavandería Centro
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'plg-acc2' }}>
                                <T size={11.5} weight={800}>
                                    Lavandería Norte
                                </T>
                            </span>
                        </span>
                        {[86, 64, 92].map((w, i) => (
                            <span key={i} style={{ display: 'block', marginTop: 10, height: 26, borderRadius: 7, border: `1px solid ${C.border}`, padding: '6px 8px' }}>
                                <span style={{ display: 'block', width: w, height: 5, borderRadius: 99, background: C.muted }} />
                                <span style={{ display: 'block', marginTop: 4, width: w * 0.6, height: 5, borderRadius: 99, background: C.muted }} />
                            </span>
                        ))}
                    </At>
                    {/* Menú abierto */}
                    <At
                        x={74}
                        y={32}
                        w={144}
                        a="plg-menu"
                        style={{ opacity: 0, background: C.card, borderRadius: 9, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -12px rgba(15,23,42,.5)', padding: '5px 0', zIndex: 4 }}
                    >
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ display: 'block', padding: '2px 8px 3px', letterSpacing: '.05em' }}>
                            CAFÉ AURORA
                        </T>
                        <MenuRow icon={<Building2 size={9} />} label="Lavandería Centro" check />
                        <MenuRow icon={<Building2 size={9} />} label="Lavandería Norte" />
                        <span style={{ display: 'block', height: 1, margin: '4px 0', background: C.border }} />
                        <MenuRow icon={<Mail size={9} />} label="¿Eres cliente de otra empresa?" />
                        <MenuRow icon={<KeyRound size={9} />} label="Cambiar contraseña" />
                        <MenuRow icon={<Shield size={9} />} label="Mis datos personales" />
                        <MenuRow icon={<LogOut size={9} />} label="Salir" muted />
                    </At>
                </At>
                <Cursor a="plg-cursor" click="plg-ring" rest={[372, 110]} />
            </At>
        </Stage>
    );
}
