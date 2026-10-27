import { Bell, Eye, Megaphone, MousePointerClick, Sparkles } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Novedades: el operador publica un aviso (o llega uno con cada versión) y
 * cada persona lo ve en el megáfono de la barra superior; la consola cuenta
 * cuántos lo vieron, lo abrieron y tocaron el botón.
 */

const CSS = `
@keyframes pnv-pub{0%,18%{transform:scale(1)}21%{transform:scale(.93)}24%,100%{transform:scale(1)}}
@keyframes pnv-u1{0%,24%{opacity:0;transform:translateY(-6px)}32%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pnv-u2{0%,30%{opacity:0;transform:translateY(-6px)}38%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pnv-u3{0%,36%{opacity:0;transform:translateY(-6px)}44%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pnv-n1{0%,46%{opacity:1}52%,92%{opacity:0}100%{opacity:1}}
@keyframes pnv-n2{0%,46%{opacity:0}52%,92%{opacity:1}100%{opacity:0}}
`;

function UserCard({ y, initials, name, t, a }: { y: number; initials: string; name: string; t: 'violet' | 'cyan' | 'amber'; a: string }): JSX.Element {
    return (
        <At x={300} y={y} w={166} a={a}>
            <div
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
                }}
            >
                <Avatar initials={initials} t={t} size={20} />
                <T size={8.5} weight={600} style={{ flex: 1 }}>
                    {name}
                </T>
                <span
                    style={{
                        position: 'relative',
                        color: primary(),
                        display: 'inline-flex',
                    }}
                >
                    <Megaphone size={13} />
                    <span
                        style={{
                            position: 'absolute',
                            right: -5,
                            top: -5,
                            minWidth: 12,
                            height: 12,
                            borderRadius: 99,
                            background: C.destructive,
                            color: '#fff',
                            fontSize: 7,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        1
                    </span>
                </span>
                <Bell size={12} color={C.mutedFg} />
            </div>
        </At>
    );
}

export default function PlatNovedades(): JSX.Element {
    return (
        <Stage
            label="En Plataforma, Novedades, el operador publica un aviso con título, texto y botón. Cada persona lo ve en el megáfono de la barra superior, y la consola cuenta cuántos lo vieron, lo abrieron y tocaron el botón."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={20}
                w={270}
                h={260}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Megaphone size={13} color={primary()} />
                    <T size={11} weight={700}>
                        Nueva novedad
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 5 }}>
                    {['Nueva función', 'Mejora', 'Corrección', 'Aviso'].map((k, i) => (
                        <span
                            key={k}
                            style={{
                                height: 18,
                                padding: '0 7px',
                                borderRadius: 99,
                                border: `1px solid ${i === 3 ? primary(0.6) : C.border}`,
                                color: i === 3 ? primary() : C.fg,
                                fontSize: 8,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            {k}
                        </span>
                    ))}
                </span>
                {/* Vista previa */}
                <div
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        background: tone('amber', 0.05),
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Sparkles size={11} color={tone('amber')} />
                        <T size={7.5} weight={700} color={tone('amber')} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            Aviso
                        </T>
                    </span>
                    <T size={10} weight={700}>
                        Mantenimiento el sábado 2 a las 11 p. m.
                    </T>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        La app puede no responder por 10 minutos. Tus datos no se tocan.
                    </T>
                    <span
                        style={{
                            alignSelf: 'flex-start',
                            height: 20,
                            padding: '0 9px',
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Ver detalles
                    </span>
                </div>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <T size={8} color={C.mutedFg}>
                        Para: todos los roles · todos los planes · vence el 03/11
                    </T>
                </span>
                <span
                    data-a=""
                    style={{
                        alignSelf: 'flex-end',
                        marginTop: 'auto',
                        height: 22,
                        padding: '0 11px',
                        borderRadius: 6,
                        background: primary(),
                        color: C.primaryFg,
                        fontSize: 9,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        animationName: 'pnv-pub',
                    }}
                >
                    Publicar
                </span>
            </At>

            <UserCard y={22} initials="AG" name="Ana · Café Aurora" t="violet" a="pnv-u1" />
            <UserCard y={66} initials="JR" name="Jorge · Ferretería El Sol" t="amber" a="pnv-u2" />
            <UserCard y={110} initials="LC" name="Lucía · Clínica Norte" t="cyan" a="pnv-u3" />

            <At
                x={300}
                y={162}
                w={166}
                h={118}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                }}
            >
                <T size={9} weight={700}>
                    Estadísticas
                </T>
                {[
                    [<Eye key="e" size={11} />, 'la vieron', '0', '214'],
                    [<Megaphone key="m" size={11} />, 'la abrieron', '0', '96'],
                    [<MousePointerClick key="c" size={11} />, 'tocaron el botón', '0', '31'],
                ].map(([icon, l, a, b]) => (
                    <span key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: C.mutedFg, display: 'inline-flex' }}>{icon}</span>
                        <span style={{ display: 'inline-grid', width: 26 }}>
                            <span
                                data-a=""
                                style={{
                                    gridArea: '1 / 1',
                                    opacity: 0,
                                    animationName: 'pnv-n1',
                                }}
                            >
                                <T size={9} weight={700}>
                                    {a}
                                </T>
                            </span>
                            <span data-a="" style={{ gridArea: '1 / 1', animationName: 'pnv-n2' }}>
                                <T size={9} weight={700}>
                                    {b}
                                </T>
                            </span>
                        </span>
                        <T size={8.5} color={C.mutedFg}>
                            {l}
                        </T>
                    </span>
                ))}
            </At>
        </Stage>
    );
}
