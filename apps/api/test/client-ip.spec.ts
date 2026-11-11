import { describe, expect, it } from 'vitest';
import { rateKeyForIp } from '../src/common/client-ip';

describe('rateKeyForIp — la clave de los límites por IP', () => {
    it('IPv4 tal cual; IPv4 dentro de IPv6 cuenta como la IPv4', () => {
        expect(rateKeyForIp('203.0.113.7')).toBe('203.0.113.7');
        expect(rateKeyForIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
        expect(rateKeyForIp('::FFFF:cb00:7107')).toBe('203.0.113.7');
        expect(rateKeyForIp(' 127.0.0.1 ')).toBe('127.0.0.1');
    });

    it('dos direcciones IPv6 de la misma red /64 son una sola clave; otra red, otra clave', () => {
        const a = rateKeyForIp('2001:db8:aa:bb::1');
        expect(a).toBe('2001:db8:aa:bb::/64');
        expect(rateKeyForIp('2001:0DB8:00aa:00bb:ffff:1:2:3')).toBe(a);
        expect(rateKeyForIp('[2001:db8:aa:bb:1::9]')).toBe(a);
        expect(rateKeyForIp('2001:db8:aa:bc::1')).not.toBe(a);
        expect(rateKeyForIp('::1')).toBe('0:0:0:0::/64');
        expect(rateKeyForIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
        // Mil direcciones de una red: una clave.
        const keys = new Set(Array.from({ length: 1000 }, (_v, i) => rateKeyForIp(`2a00:1450:4000:80e:${i.toString(16)}::${(i * 7).toString(16)}`)));
        expect(keys.size).toBe(1);
    });

    it('lo que no es una IP no rompe', () => {
        expect(rateKeyForIp('')).toBe('unknown');
        expect(rateKeyForIp(undefined)).toBe('unknown');
        expect(rateKeyForIp('no-es-ip')).toBe('no-es-ip');
        expect(rateKeyForIp('x'.repeat(500)).length).toBe(64);
    });
});
