import { BookOpen, Clock, FileText, ListChecks, Receipt, ScanLine, Search, Table } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La búsqueda global: Ctrl+K abre la paleta con lo reciente; al escribir
 * aparecen registros, listas y guías; con las flechas se elige y Enter abre.
 */

const CSS = `
@keyframes bs-keys{0%,2%{opacity:0;transform:translateY(6px) scale(.9)}6%,16%{opacity:1;transform:translateY(0) scale(1)}22%,100%{opacity:0;transform:translateY(-4px)}}
@keyframes bs-pal{0%,10%{opacity:0;transform:translateY(-10px) scale(.97)}15%,94%{opacity:1;transform:translateY(0) scale(1)}99%,100%{opacity:0}}
@keyframes bs-dim{0%,10%{opacity:0}15%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes bs-type{0%,24%{width:0}40%,100%{width:39px}}
@keyframes bs-ph{0%,24%{opacity:1}25%,100%{opacity:0}}
@keyframes bs-recent{0%,38%{opacity:1}42%,100%{opacity:0}}
@keyframes bs-res{0%,40%{opacity:0;transform:translateY(4px)}45%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes bs-sel{0%,58%{transform:translateY(0)}63%,94%{transform:translateY(46px)}99%,100%{transform:translateY(0)}}
@keyframes bs-enter{0%,70%{opacity:0;transform:scale(.8)}74%,84%{opacity:1;transform:scale(1)}88%,100%{opacity:0;transform:scale(.9)}}
@keyframes bs-count{0%,40%{opacity:0}45%,94%{opacity:1}99%,100%{opacity:0}}
`;

const PX = 70;
const PW = 340;

function Key({ label }: { label: string }): JSX.Element {
    return (
        <span
            style={{
                minWidth: 34,
                height: 30,
                padding: '0 9px',
                borderRadius: 7,
                background: C.card,
                border: `1px solid ${C.border}`,
                boxShadow: `0 3px 0 ${C.border}, 0 10px 20px -12px rgba(15,23,42,.5)`,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: C.fg,
            }}
        >
            {label}
        </span>
    );
}

function Group({ label }: { label: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 18, padding: '0 12px' }}>
            <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                {label}
            </T>
        </div>
    );
}

function Result({ icon, t, label, hint }: { icon: JSX.Element; t: 'mint' | 'blue' | 'violet' | 'slate' | 'amber'; label: string; hint: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 12px' }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, background: tone(t, 0.15), color: tone(t), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
            <T size={9.5} weight={600} style={{ flex: 1 }}>
                {label}
            </T>
            <T size={8} color={C.mutedFg}>
                {hint}
            </T>
        </div>
    );
}

export default function PpBuscar(): JSX.Element {
    return (
        <Stage label="Con Ctrl más K se abre la búsqueda global: primero muestra lo reciente y, al escribir «factura», aparecen un registro, una lista y una guía; se elige con las flechas y se abre con Enter." tint="blue">
            <Keyframes css={CSS} />
            {/* La app detrás */}
            <At x={16} y={16} w={448} h={268} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', height: 30, margin: '0 16px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 90, height: 6, borderRadius: 99, background: C.muted }} />
                        <span style={{ width: 60, height: 6, borderRadius: 99, background: C.muted }} />
                        <span style={{ width: 40, height: 12, borderRadius: 4, background: tone(i % 2 ? 'mint' : 'blue', 0.35) }} />
                    </div>
                ))}
            </At>
            <At x={16} y={16} w={448} h={268} a="bs-dim" style={{ borderRadius: 12, background: 'rgba(15,23,42,.38)' }} />

            {/* Atajo */}
            <At x={180} y={120} a="bs-keys" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0, zIndex: 6 }}>
                <Key label="Ctrl" />
                <T size={14} weight={700} color={C.mutedFg}>
                    +
                </T>
                <Key label="K" />
            </At>

            {/* Paleta */}
            <At x={PX} y={32} w={PW} h={236} a="bs-pal" style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 24px 60px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <Search size={13} color={C.mutedFg} />
                    <span style={{ position: 'relative', flex: 1, height: 14 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'bs-ph', opacity: 0 }}>
                            <T size={9.5} color={C.mutedFg}>
                                Buscar listas, registros, dashboards…
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', overflow: 'hidden', width: 39, borderRight: `1.5px solid ${primary()}`, animationName: 'bs-type' }}>
                            <T size={10} weight={500}>
                                factura
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.mutedFg }}>
                        <ScanLine size={10} />
                        <T size={8} color={C.mutedFg}>
                            Escanear
                        </T>
                    </span>
                </div>
                <div style={{ position: 'relative', height: 170 }}>
                    {/* Antes de escribir */}
                    <At x={0} y={4} w={PW} a="bs-recent" style={{ opacity: 0 }}>
                        <Group label="RECIENTES" />
                        <Result icon={<Clock size={11} />} t="slate" label="Clínica Norte" hint="Registro · Clientes" />
                        <Result icon={<Clock size={11} />} t="slate" label="Ventas del mes" hint="Dashboard" />
                        <Group label="IR A" />
                        <Result icon={<Table size={11} />} t="blue" label="Todas las listas" hint="" />
                        <Result icon={<ListChecks size={11} />} t="blue" label="Mi trabajo" hint="" />
                    </At>
                    {/* Resultados */}
                    <At x={0} y={4} w={PW} a="bs-res">
                        <At x={6} y={18} w={PW - 12} h={28} a="bs-sel" style={{ borderRadius: 7, background: primary(0.12), boxShadow: `inset 0 0 0 1px ${primary(0.35)}`, transform: 'translateY(46px)' }} />
                        <div style={{ position: 'relative' }}>
                            <Group label="REGISTROS" />
                            <Result icon={<Receipt size={11} />} t="mint" label="FAC-1042 · Hotel Brisas" hint="Registro · Facturas" />
                            <Group label="LISTAS" />
                            <Result icon={<FileText size={11} />} t="mint" label="Facturas" hint="Lista · Finanzas" />
                            <Group label="AYUDA" />
                            <Result icon={<BookOpen size={11} />} t="violet" label="Cotización y factura en PDF" hint="Guía · 4 min" />
                        </div>
                    </At>
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderTop: `1px solid ${C.border}`, background: C.muted }}>
                    <span style={{ display: 'flex', gap: 10 }}>
                        {[
                            ['↑↓', 'navegar'],
                            ['↵', 'abrir'],
                            ['esc', 'cerrar'],
                        ].map(([k, l]) => (
                            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ fontSize: 7.5, fontWeight: 700, padding: '1px 4px', borderRadius: 3, border: `1px solid ${C.border}`, background: C.card, color: C.mutedFg }}>{k}</span>
                                <T size={7.5} color={C.mutedFg}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </span>
                    <span data-a="" style={{ display: 'flex', animationName: 'bs-count' }}>
                        <T size={7.5} color={C.mutedFg}>
                            3 resultados
                        </T>
                    </span>
                </div>
            </At>
            {/* Enter */}
            <At x={416} y={190} a="bs-enter" style={{ opacity: 0, zIndex: 7 }}>
                <Key label="Enter" />
            </At>
        </Stage>
    );
}
