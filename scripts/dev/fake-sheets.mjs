// Google Sheets FALSO para desarrollo y E2E (v0.1.459, G3): la API v4 que usa
// la sincronización de una lista con una hoja.
// Uso: node scripts/dev/fake-sheets.mjs [puerto] [token]   (default 9931, sheets-token)
// La API se apunta con GOOGLE_SHEETS_API_URL=http://127.0.0.1:9931.
// Control: POST /__set {id,title,tabs:[{gid,title,rows}]} · GET /__dump?id= ·
//          POST /__fail {status: 401|403|429|null} · GET /__log
// Es el mismo doble que usan los tests (apps/api/test/helpers/fake-sheets.ts):
// Node 22 quita los tipos de TypeScript solo.
import { startFakeSheets } from '../../apps/api/test/helpers/fake-sheets.ts';

const port = Number(process.argv[2] ?? 9931);
const token = process.argv[3] ?? 'sheets-token';
const fake = await startFakeSheets({ port, token });
console.log(`Google Sheets falso en ${fake.apiBase} (token ${token})`);
