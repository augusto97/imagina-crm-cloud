import { FileText, Folder, Image as ImageIcon, Server } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Almacenamiento propio: con Google Drive (o un bucket S3) elegido en Ajustes →
 * Almacenamiento, los archivos que se suben y los PDF que se guardan van a la
 * carpeta de la empresa y la barra del plan no se mueve.
 */

const FILES = [
    { name: 'Cuenta de cobro 0042.pdf', icon: <FileText size={12} />, t: 'rose' as const },
    { name: 'Foto del local.jpg', icon: <ImageIcon size={12} />, t: 'blue' as const },
    { name: 'Contrato firmado.pdf', icon: <FileText size={12} />, t: 'violet' as const },
];

const CSS = `
${FILES.map(
    (_, i) => `
@keyframes is-f${i}{0%,${8 + i * 22}%{opacity:1;transform:translate(0,0) scale(1)}${20 + i * 22}%{opacity:1;transform:translate(253px,44px) scale(.95)}${23 + i * 22}%,95%{opacity:0;transform:translate(253px,44px) scale(.9)}96%{opacity:0;transform:translate(0,0) scale(.9)}100%{opacity:1;transform:translate(0,0) scale(1)}}
@keyframes is-r${i}{0%,${20 + i * 22}%{opacity:0;transform:translateY(-4px)}${24 + i * 22}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`,
).join('')}
@keyframes is-drive{0%,18%{box-shadow:0 0 0 0 transparent}22%,26%{box-shadow:0 0 0 4px ${tone('mint', 0.3)}}30%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes is-note{0%,70%{opacity:0;transform:translateY(4px)}76%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

export default function IntegStorage(): JSX.Element {
    return (
        <Stage label="Con el almacenamiento propio elegido, los archivos y los PDF van a la carpeta de la empresa en Google Drive y no ocupan el espacio del plan." tint="mint">
            <Keyframes css={CSS} />

            {/* Lo que se sube en la app */}
            <At x={20} y={34} w={176} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Se sube en la app
                </T>
            </At>
            {FILES.map((f, i) => (
                <At
                    key={f.name}
                    x={20}
                    y={56 + i * 40}
                    w={176}
                    h={32}
                    a={`is-f${i}`}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', boxShadow: '0 6px 16px -10px rgba(15,23,42,.4)' }}
                >
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: tone(f.t, 0.16), color: tone(f.t), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</span>
                    <T size={9} weight={600}>
                        {f.name}
                    </T>
                </At>
            ))}

            {/* Servidor de la plataforma: la barra del plan no se mueve */}
            <At x={20} y={190} w={176} h={88} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Server size={13} color={C.mutedFg} />
                    <T size={9.5} weight={700}>
                        Espacio de tu plan
                    </T>
                </span>
                <span style={{ height: 7, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                    <span style={{ display: 'block', width: '24%', height: '100%', background: primary(), borderRadius: 99 }} />
                </span>
                <T size={8.5} color={C.mutedFg}>
                    1,2 GB de 5 GB
                </T>
                <At x={10} y={64} w={160} a="is-note" style={{ opacity: 1 }}>
                    <T size={8} weight={700} color={tone('mint')}>
                        No cambia: van a tu Drive
                    </T>
                </At>
            </At>

            {/* La carpeta de la empresa en Google Drive */}
            <At
                x={262}
                y={20}
                w={198}
                h={262}
                a="is-drive"
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)' }}
            >
                <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 11px', borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey="google_drive" size={24} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10} weight={700}>
                            Google Drive
                        </T>
                        <T size={8} color={C.mutedFg}>
                            gerencia@cafeaurora.co
                        </T>
                    </span>
                </div>
                <div style={{ padding: '10px 11px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Folder size={14} color={tone('amber')} fill={tone('amber', 0.25)} />
                    <T size={9.5} weight={700}>
                        Carpeta de la app
                    </T>
                </div>
                {FILES.map((f, i) => (
                    <At
                        key={`r${f.name}`}
                        x={11}
                        y={80 + i * 40}
                        w={176}
                        h={32}
                        a={`is-r${i}`}
                        style={{ border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px' }}
                    >
                        <span style={{ width: 20, height: 20, borderRadius: 5, background: tone(f.t, 0.16), color: tone(f.t), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</span>
                        <T size={9} weight={600}>
                            {f.name}
                        </T>
                    </At>
                ))}
            </At>
        </Stage>
    );
}
