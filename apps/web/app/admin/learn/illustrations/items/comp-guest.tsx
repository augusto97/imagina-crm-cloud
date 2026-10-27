import { ChevronDown, Lock, MessageSquare, Table2, UserPlus } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Invitar a alguien de afuera a una lista con «Puede comentar»: entra a «Compartido conmigo» y ve sólo esa lista. */

const CSS = `
@keyframes cg-type{0%,4%{width:0}18%,100%{width:112px}}
@keyframes cg-cursor{0%{transform:translate(120px,290px);opacity:0}6%{opacity:1}18%,26%{transform:translate(182px,124px);opacity:1}34%,100%{transform:translate(182px,124px);opacity:0}}
@keyframes cg-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cg-row{0%,24%{opacity:0;transform:translateY(-6px)}30%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cg-screen{0%,34%{opacity:0;transform:translateX(14px)}42%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(14px)}}
@keyframes cg-comment{0%,58%{opacity:0;transform:translateY(6px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cg-hl{0%,46%{background:transparent}50%,92%{background:${primary(0.08)}}100%{background:transparent}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

export default function CompGuest(): JSX.Element {
    return (
        <Stage label="En Compartir se invita al proveedor por correo con el nivel Puede comentar. Él entra a Compartido conmigo, ve sólo la lista Pedidos a proveedor y deja un comentario; no puede editar ni ver nada más de la empresa." tint="mint">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Compartir → Personas de afuera */}
                <At x={16} y={40} w={196} h={196} style={{ ...card, padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <UserPlus size={11} color={tone('mint')} />
                        <T size={8.5} weight={800}>
                            Personas de afuera
                        </T>
                    </span>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Ven sólo esta lista y no ocupan un usuario de tu plan.
                    </T>
                    <span style={{ display: 'flex', gap: 4 }}>
                        <span style={{ flex: 1, height: 20, borderRadius: 5, border: `1px solid ${primary(0.6)}`, display: 'flex', alignItems: 'center', padding: '0 5px', overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 112, animationName: 'cg-type' }}>
                                <T size={7}>pedidos@lacteosandes.co</T>
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'flex', gap: 4 }}>
                        <span style={{ flex: 1, height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 5px' }}>
                            <T size={7}>Puede comentar</T>
                            <ChevronDown size={8} color={C.mutedFg} />
                        </span>
                        <span style={{ height: 20, padding: '0 10px', borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center' }}>
                            <T size={7.5} weight={700} color={C.primaryFg}>
                                Invitar
                            </T>
                        </span>
                    </span>
                    <span style={{ height: 1, background: C.border, margin: '2px 0' }} />
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, animationName: 'cg-row' }}>
                        <Avatar initials="LA" t="mint" size={20} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                            <T size={7} weight={700}>
                                pedidos@lacteosandes.co
                            </T>
                            <T size={6} color={tone('amber')} weight={700}>
                                Invitación pendiente
                            </T>
                        </span>
                    </span>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', animationName: 'cg-row' }}>
                        <Chip label="Puede comentar" t="mint" style={{ height: 15, fontSize: 6.5, padding: '0 6px' }} />
                    </span>
                </At>

                {/* Lo que ve el invitado */}
                <At x={226} y={36} w={238} h={226} a="cg-screen" style={{ ...card, overflow: 'hidden' }}>
                    <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={7.5} weight={800}>
                            Compartido conmigo
                        </T>
                        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Avatar initials="LA" t="mint" size={14} />
                        </span>
                    </div>
                    <div style={{ display: 'flex', height: 200 }}>
                        <div style={{ width: 70, borderRight: `1px solid ${C.border}`, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, background: C.muted }}>
                            <span data-a="" style={{ height: 20, borderRadius: 5, display: 'flex', alignItems: 'center', gap: 3, padding: '0 4px', background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}>
                                <Table2 size={8} color={primary()} />
                                <T size={6.2} weight={700}>
                                    Pedidos a prov.
                                </T>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 4px', opacity: 0.6 }}>
                                <Lock size={7} color={C.mutedFg} />
                                <T size={5.8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                    Nada más de la empresa
                                </T>
                            </span>
                        </div>
                        <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <T size={8.5} weight={800}>
                                Pedidos a proveedor
                            </T>
                            <span style={{ borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                                {(
                                    [
                                        ['OC-0412 · Queso', 'Pendiente', 'amber'],
                                        ['OC-0411 · Leche', 'Despachado', 'mint'],
                                        ['OC-0410 · Yogur', 'Recibido', 'blue'],
                                    ] as const
                                ).map(([n, s, t], i) => (
                                    <span
                                        key={n}
                                        data-a={i === 0 ? '' : undefined}
                                        style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', borderBottom: i < 2 ? `1px solid ${C.border}` : 'none', animationName: i === 0 ? 'cg-hl' : undefined }}
                                    >
                                        <T size={6.8}>{n}</T>
                                        <Chip label={s} t={t} style={{ height: 13, fontSize: 6, padding: '0 5px' }} />
                                    </span>
                                ))}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <MessageSquare size={8} color={C.mutedFg} />
                                <T size={6.5} weight={700} color={C.mutedFg}>
                                    Comentarios de OC-0412
                                </T>
                            </span>
                            <span style={{ display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                                <Avatar initials="DM" t="violet" size={15} />
                                <span style={{ borderRadius: 8, borderTopLeftRadius: 2, background: C.muted, padding: '4px 6px' }}>
                                    <T size={6.5} style={{ whiteSpace: 'normal' }}>
                                        ¿Pueden despachar el jueves?
                                    </T>
                                </span>
                            </span>
                            <span data-a="" style={{ display: 'flex', gap: 5, alignItems: 'flex-start', animationName: 'cg-comment' }}>
                                <Avatar initials="LA" t="mint" size={15} />
                                <span style={{ borderRadius: 8, borderTopLeftRadius: 2, background: tone('mint', 0.15), padding: '4px 6px' }}>
                                    <T size={6.5} style={{ whiteSpace: 'normal' }}>
                                        Sí, sale el jueves a las 8:00.
                                    </T>
                                </span>
                            </span>
                        </div>
                    </div>
                </At>
                <Cursor a="cg-cursor" click="cg-ring" rest={[182, 124]} />
            </At>
        </Stage>
    );
}
