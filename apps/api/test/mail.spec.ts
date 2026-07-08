import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { LogMailTransport } from '../src/mail/transports/log.transport';

class CaptureTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

describe('MailService (sin Redis)', () => {
    it('enqueue sin cola → envío directo por el transporte', async () => {
        const cap = new CaptureTransport();
        const mail = new MailService(loadEnv(), cap); // no onModuleInit → queue null
        await mail.enqueue({ to: 'a@b.test', subject: 'Hola', text: 'cuerpo' });
        expect(cap.sent).toEqual([{ to: 'a@b.test', subject: 'Hola', text: 'cuerpo' }]);
    });

    it('sendNow delega en el transporte', async () => {
        const cap = new CaptureTransport();
        const mail = new MailService(loadEnv(), cap);
        await mail.sendNow({ to: 'x@y.test', subject: 'S' });
        expect(cap.sent).toHaveLength(1);
    });

    it('LogMailTransport no lanza y no envía nada real', async () => {
        await expect(new LogMailTransport().send({ to: 't@t.test', subject: 'S' })).resolves.toBeUndefined();
    });
});
