import { z } from 'zod';
import { insertConnectorSchema, insertCompanySchema, insertAssetSchema, users, connectors, companies, assets } from './schema';

export type {
  User, InsertUser,
  Connector, InsertConnector,
  Company, InsertCompany,
  Contact, InsertContact,
  Lead, InsertLead,
  Deal, InsertDeal,
  Asset, InsertAsset,
  InvestorProfile, InsertInvestorProfile,
  MatchSuggestion,
  PipelineStage, InsertPipelineStage,
  LeadRule,
  Organization
} from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
  unauthorized: z.object({ message: z.string() }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login' as const,
      input: z.object({ username: z.string(), password: z.string() }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      }
    },
    logout: {
      method: 'POST' as const,
      path: '/api/logout' as const,
      responses: { 200: z.void() }
    },
    me: {
      method: 'GET' as const,
      path: '/api/user' as const,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      }
    }
  },
  connectors: {
    list: {
      method: 'GET' as const,
      path: '/api/connectors' as const,
      responses: { 200: z.array(z.custom<typeof connectors.$inferSelect>()) }
    },
    create: {
      method: 'POST' as const,
      path: '/api/connectors' as const,
      input: insertConnectorSchema,
      responses: { 201: z.custom<typeof connectors.$inferSelect>() }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/connectors/:id' as const,
      input: insertConnectorSchema.partial(),
      responses: { 200: z.custom<typeof connectors.$inferSelect>() }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/connectors/:id' as const,
      responses: { 204: z.void() }
    },
    run: {
      method: 'POST' as const,
      path: '/api/connectors/:id/run' as const,
      responses: { 200: z.object({ success: z.boolean(), message: z.string() }) }
    }
  },
  companies: {
    list: { method: 'GET' as const, path: '/api/companies' as const, responses: { 200: z.array(z.custom<typeof companies.$inferSelect>()) } },
    create: { method: 'POST' as const, path: '/api/companies' as const, input: insertCompanySchema, responses: { 201: z.custom<typeof companies.$inferSelect>() } },
  },
  assets: {
    list: { method: 'GET' as const, path: '/api/assets' as const, responses: { 200: z.array(z.custom<typeof assets.$inferSelect>()) } },
    create: { method: 'POST' as const, path: '/api/assets' as const, input: insertAssetSchema, responses: { 201: z.custom<typeof assets.$inferSelect>() } },
  },

};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
