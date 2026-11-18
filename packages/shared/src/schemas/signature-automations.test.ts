import { describe, expect, it } from 'vitest';
import { automationConfigIssues } from './automation';
import {
    readRequestSignatureConfig,
    requestSignatureIssues,
    requestSignatureSummary,
    signatureEventValue,
    signatureTriggerMatches,
    signatureTriggerSummary,
    type SignatureEventInfo,
} from './signature-automations';

const info: SignatureEventInfo = {
    request_id: 7,
    evento: 'completed',
    titulo: 'Contrato',
    estado: 'Firmado',
    estado_clave: 'completed',
    numero: 'CT-0007',
    firmante: 'Ana Gómez',
    firmante_email: 'ana@acme.co',
    firmante_rol: 'Cliente',
    firmaron: 2,
    total: 2,
    motivo: null,
    codigo: 'ABCD-1234',
    verificar: 'https://app.test/api/v1/public/sign/verify/ABCD-1234',
    siguiente: null,
    siguiente_email: null,
    enlace: null,
    pdf: 'https://app.test/f/1',
    template_id: 3,
};

describe('firma en automatizaciones', () => {
    it('el disparador filtra por evento y plantilla (sin elegir = todos)', () => {
        expect(signatureTriggerMatches({}, info)).toBe(true);
        expect(signatureTriggerMatches({ signature_events: ['completed'] }, info)).toBe(true);
        expect(signatureTriggerMatches({ signature_events: ['signed', 'declined'] }, info)).toBe(false);
        expect(signatureTriggerMatches({ signature_template_ids: [3] }, info)).toBe(true);
        expect(signatureTriggerMatches({ signature_template_ids: [9] }, info)).toBe(false);
        expect(signatureTriggerMatches({ signature_template_ids: [3] }, { ...info, template_id: null })).toBe(false);
        // Un evento desconocido guardado no rompe: se ignora (y queda «todos»).
        expect(signatureTriggerMatches({ signature_events: ['raro'] }, info)).toBe(true);
    });

    it('las variables {{firma.x}} y el resumen', () => {
        expect(signatureEventValue(info, 'evento')).toBe('Firmaron todos');
        expect(signatureEventValue(info, 'firmaron')).toBe('2');
        expect(signatureEventValue(info, 'enlace')).toBe('');
        expect(signatureEventValue(info, 'pdf')).toBe('https://app.test/f/1');
        expect(signatureEventValue(info, 'nada')).toBeUndefined();
        expect(signatureTriggerSummary({ signature_events: ['completed'] })).toBe('Cuando firman todos un documento');
        expect(signatureTriggerSummary({})).toBe('Cuando cambia una firma');
    });

    it('la acción se lee con tolerancia y dice lo que falta', () => {
        const c = readRequestSignatureConfig({ template_id: '4', signers: [{ name: '{{nombre}}', email: '{{correo}}' }, null], expires_days: 999 });
        expect(c.template_id).toBe(4);
        expect(c.signers).toEqual([{ name: '{{nombre}}', email: '{{correo}}', role: '', phone: '' }]);
        expect(c.verify).toBe('email');
        expect(c.verify_connection_id).toBeNull();
        expect(c.expires_days).toBe(180);
        expect(c.send_email).toBe(true);
        expect(requestSignatureIssues({ template_id: 4, signers: [{ name: 'Ana', email: '{{correo}}' }] }, 'actions.0')).toEqual([]);
        const issues = requestSignatureIssues({ source: 'file', signers: [{ name: '', email: '' }], status_field: 'estado' }, 'actions.0').map((i) => i.path);
        expect(issues).toEqual([
            'actions.0.config.file_field',
            'actions.0.config.signers.0.email',
            'actions.0.config.signers.0.name',
            'actions.0.config.status_value',
        ]);
        expect(requestSignatureSummary({ template_id: 4, order: 'sequential', signers: [{}, {}] }, 'Contrato')).toBe('Pide la firma de «Contrato» a 2 personas, en orden');
    });

    it('v0.1.448: el código por SMS o WhatsApp pide la conexión y el celular de cada persona', () => {
        const c = readRequestSignatureConfig({ verify: 'whatsapp', verify_connection_id: '12', verify_template: { name: 'codigo', language: 'es' }, signers: [{ name: 'A', email: 'a@b.co', phone: '{{celular}}' }] });
        expect(c.verify).toBe('whatsapp');
        expect(c.verify_connection_id).toBe(12);
        expect(c.verify_template).toEqual({ name: 'codigo', language: 'es' });
        expect(readRequestSignatureConfig({ verify: 'fax' }).verify).toBe('email');
        expect(readRequestSignatureConfig({ verify_template: { name: '' } }).verify_template).toBeNull();
        const issues = requestSignatureIssues({ template_id: 4, verify: 'sms', signers: [{ name: 'Ana', email: '{{correo}}' }] }, 'actions.0').map((i) => i.path);
        expect(issues).toEqual(['actions.0.config.signers.0.phone', 'actions.0.config.verify_connection_id']);
        expect(requestSignatureIssues({ template_id: 4, verify: 'sms', verify_connection_id: 3, signers: [{ name: 'Ana', email: 'a@b.co', phone: '{{celular}}' }] }, 'a')).toEqual([]);
        expect(requestSignatureSummary({ template_id: 4, verify: 'sms', signers: [{}] }, 'Contrato')).toBe('Pide la firma de «Contrato» a 1 persona, con código por SMS');
    });

    it('guardar una automatización valida la acción', () => {
        const issues = automationConfigIssues({ trigger_type: 'record_created', trigger_config: {}, actions: [{ type: 'request_signature', config: {} }] });
        expect(issues.map((i) => i.path)).toEqual(['actions.0.config.template_id', 'actions.0.config.signers']);
    });
});
