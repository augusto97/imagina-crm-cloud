import { Building2, FileArchive, Lock, Server } from 'lucide-react';

import { At, C, Flow, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Migrar una empresa: se exporta Café Aurora del servidor A a un archivo
 * portable, viaja cifrado por Google Drive y se importa en el servidor B.
 * La empresa de origen queda intacta.
 */

const CSS = `
@keyframes pmg-file{0%,10%{opacity:0;transform:translate(0,0) scale(.7)}18%,24%{opacity:1;transform:translate(0,0) scale(1)}40%{opacity:1;transform:translate(152px,0) scale(1)}46%,54%{opacity:1;transform:translate(152px,0) scale(1)}70%{opacity:1;transform:translate(304px,0) scale(1)}76%,100%{opacity:0;transform:translate(304px,0) scale(.7)}}
@keyframes pmg-new{0%,72%{opacity:0;transform:translateY(8px)}80%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pmg-lock{0%,30%{opacity:0}36%,74%{opacity:1}80%,100%{opacity:0}}
`;

function ServerBox({ x, title, sub, children }: { x: number; title: string; sub: string; children: JSX.Element }): JSX.Element {
    return (
        <At
            x={x}
            y={44}
            w={138}
            h={182}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                boxShadow: '0 10px 26px -14px rgba(15,23,42,.45)',
            }}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Server size={14} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={9.5} weight={700}>
                        {title}
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        {sub}
                    </T>
                </span>
            </span>
            {children}
        </At>
    );
}

function Company({ name, t, faded }: { name: string; t: 'amber' | 'blue' | 'violet' | 'mint'; faded?: boolean }): JSX.Element {
    return (
        <span
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 26,
                padding: '0 7px',
                borderRadius: 7,
                border: `1px solid ${C.border}`,
                opacity: faded ? 0.6 : 1,
            }}
        >
            <span
                style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: tone(t),
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Building2 size={9} />
            </span>
            <T size={8.5} weight={600}>
                {name}
            </T>
        </span>
    );
}

export default function PlatMigrate(): JSX.Element {
    return (
        <Stage
            label="Se exporta la empresa Café Aurora del servidor A a un archivo portable que viaja cifrado por Google Drive y se importa en el servidor B. La empresa de origen queda intacta."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <ServerBox x={14} title="Servidor A" sub="origen">
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <Company name="Café Aurora" t="amber" />
                    <Company name="Clínica Norte" t="blue" />
                    <Company name="Agencia Rumbo" t="violet" />
                </span>
            </ServerBox>

            {/* Drive */}
            <At
                x={170}
                y={74}
                w={140}
                h={150}
                style={{
                    background: C.card,
                    border: `1px dashed ${C.border}`,
                    borderRadius: 12,
                    padding: 9,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                }}
            >
                <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#00AC47" d="M12 8.1L8.1 1.4c-.4.2-.7.5-.9.9L.3 14.5c-.2.4-.3.8-.3 1.2h7.7L12 8.1z" />
                    <path fill="#2684FC" d="M16.3 15.7H7.7l-3.9 6.7c.4.2.8.3 1.2.3h14.2c.4 0 .8-.1 1.2-.3l-4.1-6.7z" />
                    <path fill="#FFBA00" d="M20.4 8.6l-3.6-6.2c-.2-.4-.5-.7-.9-.9L12 8.1l4.3 7.6H24c0-.4-.1-.8-.3-1.2l-3.3-5.9z" />
                </svg>
                <T size={8.5} weight={700}>
                    Google Drive
                </T>
                <T size={7.5} color={C.mutedFg}>
                    Empresas exportadas
                </T>
                <span
                    data-a=""
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        color: tone('mint'),
                        animationName: 'pmg-lock',
                    }}
                >
                    <Lock size={9} />
                    <T size={7.5} weight={700} color={tone('mint')}>
                        cifrada
                    </T>
                </span>
            </At>
            <At x={152} y={199}>
                <Flow x1={0} y1={0} x2={18} y2={0} />
            </At>
            <At x={310} y={199}>
                <Flow x1={0} y1={0} x2={18} y2={0} />
            </At>

            <ServerBox x={328} title="Servidor B" sub="destino">
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <Company name="Hotel Brisas" t="mint" faded />
                    <span data-a="" style={{ animationName: 'pmg-new' }}>
                        <Company name="Café Aurora" t="amber" />
                    </span>
                </span>
            </ServerBox>

            {/* El archivo que viaja */}
            <At x={22} y={186} a="pmg-file" style={{ opacity: 0 }}>
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        height: 26,
                        padding: '0 8px',
                        borderRadius: 7,
                        background: C.card,
                        border: `1.5px solid ${primary(0.6)}`,
                        boxShadow: '0 10px 22px -10px rgba(15,23,42,.55)',
                    }}
                >
                    <FileArchive size={12} color={primary()} />
                    <T size={8} weight={700}>
                        cafe-aurora.tar
                    </T>
                </span>
            </At>

            <At x={14} y={246} w={452} style={{ textAlign: 'center' }}>
                <T size={8.5} color={C.mutedFg}>
                    Viajan datos, archivos y personas. La empresa de origen queda intacta.
                </T>
            </At>
        </Stage>
    );
}
