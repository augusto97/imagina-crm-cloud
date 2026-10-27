import { Bell, Building2, Download, GraduationCap, Keyboard, LogOut, Megaphone, Moon, Settings, User } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * El menú de tu cuenta (avatar arriba a la derecha): empresa, ajustes,
 * novedades, modo oscuro, instalar la app y cerrar sesión. Al tocar «Modo
 * oscuro» la app cambia de tema en este dispositivo.
 */

const CSS = `
@keyframes cmn-menu{0%,14%{opacity:0;transform:translateY(-6px) scale(.98)}20%,47%{opacity:1;transform:translateY(0) scale(1)}53%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes cmn-cursor{0%{transform:translate(250px,280px);opacity:0}6%{opacity:1}12%,16%{transform:translate(434px,32px)}40%,46%{transform:translate(380px,160px)}62%,88%{transform:translate(380px,160px);opacity:1}95%,100%{opacity:0;transform:translate(380px,160px)}}
@keyframes cmn-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}19%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}44%{opacity:1;transform:scale(1)}48%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cmn-hov{0%,36%{background:transparent}40%,47%{background:${primary(0.1)}}80%,100%{background:transparent}}
@keyframes cmn-dark{0%,48%{opacity:0}56%,92%{opacity:1}100%{opacity:0}}
`;

const LIGHT = {
    bg: '#ffffff',
    fg: '#0f172a',
    mut: '#e8ebf0',
    mutFg: '#64748b',
    bd: '#e2e8f0',
};
const DARK = {
    bg: '#121212',
    fg: '#f1f5f9',
    mut: '#262626',
    mutFg: '#a3a3a3',
    bd: '#2b2b2b',
};

function Screen({ p }: { p: typeof LIGHT }): JSX.Element {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                background: p.bg,
                display: 'flex',
            }}
        >
            <div
                style={{
                    width: 40,
                    background: p.mut,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                    paddingTop: 44,
                }}
            >
                {[0, 1, 2, 3].map((i) => (
                    <span
                        key={i}
                        style={{
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            background: i === 1 ? 'hsl(var(--imcrm-primary))' : p.bd,
                        }}
                    />
                ))}
            </div>
            <div
                style={{
                    flex: 1,
                    padding: '44px 14px 0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                }}
            >
                <span style={{ fontSize: 13, fontWeight: 700, color: p.fg }}>Clientes</span>
                {[0, 1, 2, 3, 4].map((i) => (
                    <span
                        key={i}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            height: 22,
                            borderBottom: `1px solid ${p.bd}`,
                        }}
                    >
                        <span
                            style={{
                                width: 90,
                                height: 6,
                                borderRadius: 99,
                                background: p.fg,
                                opacity: 0.75,
                            }}
                        />
                        <span
                            style={{
                                width: 44,
                                height: 12,
                                borderRadius: 4,
                                background: 'hsl(var(--imcrm-primary) / .6)',
                            }}
                        />
                        <span
                            style={{
                                width: 50,
                                height: 6,
                                borderRadius: 99,
                                background: p.mutFg,
                                opacity: 0.6,
                            }}
                        />
                    </span>
                ))}
            </div>
        </div>
    );
}

function Item({ icon, label, a, sub }: { icon: JSX.Element; label: string; a?: string; sub?: string }): JSX.Element {
    return (
        <span
            data-a={a ? '' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 18,
                padding: '0 9px',
                borderRadius: 5,
                animationName: a,
            }}
        >
            <span style={{ color: C.mutedFg, display: 'inline-flex' }}>{icon}</span>
            <T size={9}>{label}</T>
            {sub && (
                <T size={8} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                    {sub}
                </T>
            )}
        </span>
    );
}

export default function CuentaMenu(): JSX.Element {
    return (
        <Stage
            label="Al tocar tu avatar arriba a la derecha se abre el menú de tu cuenta: empresa, ajustes, novedades, modo oscuro, instalar la app, primeros pasos, atajos y cerrar sesión. Con «Modo oscuro» la app cambia de tema en este dispositivo."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={14}
                w={448}
                h={272}
                style={{
                    borderRadius: 12,
                    overflow: 'hidden',
                    border: `1px solid ${C.border}`,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <Screen p={LIGHT} />
                <div
                    data-a=""
                    style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0,
                        animationName: 'cmn-dark',
                    }}
                >
                    <Screen p={DARK} />
                </div>
                {/* Barra superior */}
                <div
                    style={{
                        position: 'absolute',
                        left: 40,
                        right: 0,
                        top: 0,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 12,
                        padding: '0 10px',
                    }}
                >
                    <Bell size={13} color="#94a3b8" />
                    <Avatar initials="AG" t="violet" size={22} />
                </div>
            </At>

            {/* Menú */}
            <At x={286} y={40} w={170} a="cmn-menu">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 5,
                        boxShadow: '0 16px 34px -14px rgba(15,23,42,.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                    }}
                >
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            padding: '6px 8px 8px',
                            borderBottom: `1px solid ${C.border}`,
                            marginBottom: 3,
                        }}
                    >
                        <Avatar initials="AG" t="violet" size={22} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={9.5} weight={700}>
                                Ana Gómez
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                ana@cafeaurora.co
                            </T>
                        </span>
                    </span>
                    <Item icon={<Building2 size={11} />} label="Empresa" sub="Café Aurora" />
                    <Item icon={<User size={11} />} label="Mi cuenta" />
                    <Item icon={<Settings size={11} />} label="Ajustes" />
                    <Item icon={<Megaphone size={11} />} label="Novedades" />
                    <Item icon={<Moon size={11} />} label="Modo oscuro" a="cmn-hov" />
                    <Item icon={<Download size={11} />} label="Instalar la app" />
                    <Item icon={<GraduationCap size={11} />} label="Primeros pasos" />
                    <Item icon={<Keyboard size={11} />} label="Atajos de teclado" />
                    <span style={{ height: 1, background: C.border, margin: '3px 0' }} />
                    <Item icon={<LogOut size={11} />} label="Cerrar sesión" />
                </div>
            </At>
            <Cursor a="cmn-cursor" click="cmn-ring" rest={[380, 160]} />
        </Stage>
    );
}
