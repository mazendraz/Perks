import {
  staffSecurityCommand,
  contactPhone,
} from '../../../packages/contracts/src/account-management.js';
import { cardTemplate, stampDesign, logoStyles } from '../../../packages/contracts/src/branding.js';
import {
  platformAdminInput,
  platformAdminCommand,
} from '../../../packages/contracts/src/platform-admin.js';
import {
  loginInput,
  registerInput,
  changePasswordInput,
  resetRequestInput,
  resetPasswordInput,
} from '../../../packages/contracts/src/auth.js';
import { z } from 'zod';
import type { FastifySchema } from 'fastify';
import type swagger from '@fastify/swagger';
import type { OpenAPIV3 } from 'openapi-types';
import {
  enrollmentInput,
  enrollmentOutput,
  awardInput,
  awardOutput,
  draftInput,
  draftActivationInput,
  redemptionStartInput,
  redemptionDecisionInput,
  redemptionOutput,
  requestDecisionInput,
  preferenceInput,
  failureOutput,
  draftOutput,
  activationOutput,
  redemptionStartOutput,
  redemptionDecisionOutput,
  requestDecisionOutput,
  preferenceOutput,
} from '../../../packages/contracts/src/commands.js';
import { provisioningInput } from '../../../packages/contracts/src/provisioning.js';

type Contract = {
  body?: z.ZodType;
  response?: z.ZodType;
  key?: boolean;
  revision?: boolean;
  responseStatus?: number;
};
const contracts: Record<string, Contract> = {
  'POST /api/v1/platform/admins': { body: platformAdminInput, key: true },
  'POST /api/v1/platform/admins/:id/security': { body: platformAdminCommand, key: true },
  'POST /api/v1/merchants/:m/assets': {
    body: z
      .object({ base64: z.string().max(2800000), publishLogo: z.boolean().default(false) })
      .strict(),
  },
  'POST /api/v1/platform/provisioning-drafts/:id/credentials': {
    body: z
      .object({
        revision: z.number().int().positive(),
        accounts: z
          .array(
            z
              .object({
                email: z.email(),
                password: z.string().min(12).max(128).meta({ writeOnly: true }),
              })
              .strict(),
          )
          .min(1)
          .max(40),
      })
      .strict(),
    response: z.object({ emails: z.array(z.email()) }),
  },
  'GET /api/v1/platform/provisioning-drafts/:id/credentials': {
    response: z.object({ emails: z.array(z.email()) }),
  },
  'POST /api/v1/platform/provisioning-drafts/:id/logo': {
    body: z.object({ base64: z.string().max(2800000) }).strict(),
    response: z.object({
      asset: z.object({ id: z.uuid(), width: z.number(), height: z.number() }),
    }),
  },
  'POST /api/v1/platform/merchants/:m/accounts': {
    body: z
      .object({
        email: z.email(),
        password: z.string().min(12).max(128).meta({ writeOnly: true }),
        role: z.enum(['owner', 'manager', 'cashier']),
        branchIds: z.array(z.uuid()).min(1).max(10),
        maxQty: z.number().int().min(1).max(100),
      })
      .strict(),
    key: true,
  },
  'POST /api/v1/merchants/:m/invitations': {
    body: z
      .object({
        email: z.email(),
        password: z.string().min(12).max(128).meta({ writeOnly: true }).optional(),
        role: z.enum(['owner', 'manager', 'cashier']),
        branchIds: z.array(z.uuid()).min(1).max(10),
        maxQty: z.number().int().min(1).max(100),
      })
      .strict(),
    key: true,
  },
  'PATCH /api/v1/merchants/:m/branding': {
    body: z
      .object({
        contactPhone: contactPhone.optional(),
        contactEmail: z.email().optional(),
        name: z.string().min(2).max(120),
        primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        surfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        template: cardTemplate,
        logoStyle: z.enum(logoStyles).optional(),
        logoSize: z.number().int().min(32).max(72).optional(),
        stampShape: stampDesign.stampShape.removeDefault().optional(),
        stampIcon: stampDesign.stampIcon.removeDefault().optional(),
        stampStyle: stampDesign.stampStyle.removeDefault().optional(),
        terms: z.string().min(4).max(3000),
        logoAssetId: z.uuid().nullable().optional(),
      })
      .strict(),
    revision: true,
  },
  'POST /api/v1/merchants/:m/staff/:id/security': { body: staffSecurityCommand, key: true },
  'POST /api/v1/platform/merchants/:m/whatsapp': {
    body: z.object({ message: z.string().trim().min(1).max(2000) }).strict(),
  },
  'POST /api/v1/merchants/:m/customer-outreach/:id/whatsapp': {
    body: z.object({ message: z.string().trim().min(1).max(2000) }).strict(),
  },
  'PATCH /api/v1/me/merchants/:m/contact': { body: z.object({ contactPhone }).strict() },
  'POST /api/v1/auth/login': {
    body: loginInput,
    response: z.object({
      csrfToken: z.string(),
      portal: z.enum(['platform', 'merchant', 'cashier', 'customer']),
    }),
  },
  'POST /api/v1/auth/register': {
    body: registerInput,
    response: z.object({
      csrfToken: z.string(),
      portal: z.enum(['platform', 'merchant', 'cashier', 'customer']),
    }),
  },
  'POST /api/v1/auth/password/change': {
    body: changePasswordInput,
    response: z.object({
      csrfToken: z.string(),
      portal: z.enum(['platform', 'merchant', 'cashier', 'customer']),
    }),
  },
  'POST /api/v1/auth/password/reset-request': {
    body: resetRequestInput,
    response: z.object({ accepted: z.literal(true) }),
    responseStatus: 202,
  },
  'POST /api/v1/auth/password/reset': {
    body: resetPasswordInput,
    response: z.object({ changed: z.literal(true) }),
  },
  'POST /api/v1/me/memberships': { body: enrollmentInput, response: enrollmentOutput, key: true },
  'POST /api/v1/merchants/:m/stamp-awards': { body: awardInput, response: awardOutput, key: true },
  'POST /api/v1/platform/provisioning-drafts': {
    body: draftInput,
    response: draftOutput,
    key: true,
  },
  'PATCH /api/v1/platform/provisioning-drafts/:id': {
    body: draftInput,
    response: draftOutput,
    revision: true,
  },
  'POST /api/v1/platform/provisioning-drafts/:id/activate': {
    body: draftActivationInput,
    response: activationOutput,
    key: true,
  },
  'POST /api/v1/merchants/:m/rewards/:r/redemption-challenges': {
    body: redemptionStartInput,
    response: redemptionStartOutput,
    key: true,
  },
  'POST /api/v1/me/redemption-challenges/:id/decision': {
    body: redemptionDecisionInput,
    response: redemptionDecisionOutput,
    key: true,
  },
  'POST /api/v1/merchants/:m/redemption-challenges/:id/complete': {
    body: z.object({}).strict(),
    response: redemptionOutput,
    key: true,
  },
  'POST /api/v1/merchants/:m/stamp-requests/:id/decision': {
    body: requestDecisionInput,
    response: requestDecisionOutput,
    key: true,
  },
  'PATCH /api/v1/me/merchants/:m/preferences': {
    body: preferenceInput,
    response: preferenceOutput,
  },
};
const json = (schema: z.ZodType): OpenAPIV3.SchemaObject =>
  z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as OpenAPIV3.SchemaObject;
// Documentation-only transform: command handlers remain the sole validators.
// AJV never coerces numbers/booleans, removes properties or changes these bodies.
export const contractDocumentation: swagger.SwaggerTransform = ({ schema = {}, url, route }) => {
  if (url.includes('/auth/challenges') || url === '/api/v1/auth/mfa/verify')
    return { schema: { ...schema, hide: true }, url };
  const method = String(route.method).toUpperCase(),
    contract = contracts[method + ' ' + url];
  const publicRoute =
    url.includes('/public/') ||
    (url.includes('/auth/') &&
      !['/api/v1/auth/mfa/verify', '/api/v1/auth/logout', '/api/v1/auth/password/change'].includes(
        url,
      )) ||
    url.includes('/health/') ||
    url === '/api/v1/local/mail';
  const headers: Record<string, unknown> = {},
    required: string[] = [];
  if (url.startsWith('/api/'))
    headers['x-nuqta-workspace'] = {
      type: 'string',
      enum: ['platform', 'merchant', 'cashier', 'customer'],
      description:
        'Selects the portal session and CSRF cookies. Portal authorization is checked on every request. Omit only for the legacy shared sign-in flow.',
    };
  if (url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.Origin = {
      type: 'string',
      description: 'Must exactly match the configured public app origin.',
    };
    required.push('Origin');
  }
  if (!publicRoute && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['x-csrf-token'] = {
      type: 'string',
      description: 'Session CSRF token; the exact configured Origin header is also required.',
    };
    required.push('x-csrf-token');
  }
  if (contract?.key) {
    headers['Idempotency-Key'] = {
      type: 'string',
      minLength: 8,
      maxLength: 120,
      pattern: '^[A-Za-z0-9:_-]+$',
    };
    required.push('Idempotency-Key');
  }
  if (contract?.revision) {
    headers['If-Match'] = {
      type: 'integer',
      minimum: 1,
      description: 'The last observed draft revision.',
    };
    required.push('If-Match');
  }
  const params = Object.fromEntries(
    [...url.matchAll(/:([A-Za-z]+)/g)].map((m) => [
      m[1],
      { type: 'string', ...(['m', 'id', 'r'].includes(m[1]!) ? { format: 'uuid' } : {}) },
    ]),
  );
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 410, 422, 429, 500, 503].map((status) => [
      status,
      {
        ...json(failureOutput),
        description: 'Structured error; fields refer to the submitted command paths.',
      },
    ]),
  );
  const documented: FastifySchema = {
    ...schema,
    ...(Object.keys(params).length
      ? { params: { type: 'object', properties: params, required: Object.keys(params) } }
      : {}),
    ...(Object.keys(headers).length
      ? { headers: { type: 'object', properties: headers, required } }
      : {}),
    ...(contract?.body ? { body: json(contract.body) } : {}),
    response: {
      ...errors,
      [contract?.responseStatus || 200]: contract?.response
        ? json(contract.response)
        : {
            description:
              'Successful response. This route has no strict documented response DTO yet.',
          },
      ...(schema.response as Record<string, unknown> | undefined),
    },
    security: publicRoute ? [] : [{ session: [] }],
    ...(url.startsWith('/api/v1/platform/')
      ? {
          description:
            'Platform authorization required. Password sessions use current account and platform-role checks. Legacy test sessions additionally require fresh MFA.',
        }
      : {}),
  };
  return { schema: documented, url };
};
export const activationDataSchema = json(provisioningInput);
