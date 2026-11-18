import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * El token se crea en la app, en Ajustes → API → Nuevo token. Actúa como la
 * persona que lo creó, en su empresa: ve y cambia sólo lo que ella puede.
 */
export class ImaginaBaseApi implements ICredentialType {
    name = 'imaginaBaseApi';

    displayName = 'Imagina Base API';

    icon = 'file:imaginaBase.svg' as const;

    documentationUrl = 'https://github.com/augusto97/imagina-crm-cloud/blob/main/docs/api.md';

    properties: INodeProperties[] = [
        {
            displayName: 'Dirección de la app',
            name: 'baseUrl',
            type: 'string',
            default: '',
            placeholder: 'https://app.tuempresa.com',
            required: true,
            description: 'La dirección con la que entras a la app (sin /api/v1).',
        },
        {
            displayName: 'Token de la API',
            name: 'apiToken',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
            description: 'Créalo en Ajustes → API → Nuevo token. Empieza con ib_pat_.',
        },
    ];

    authenticate: IAuthenticateGeneric = {
        type: 'generic',
        properties: {
            headers: { Authorization: '=Bearer {{$credentials.apiToken}}' },
        },
    };

    test: ICredentialTestRequest = {
        request: {
            baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}/api/v1',
            url: '/whoami',
        },
    };
}
