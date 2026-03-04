import { z } from 'zod';
import { 
  insertUserSchema, insertConnectorSchema, insertCompanySchema,
  insertContactSchema, insertLeadSchema, insertDealSchema, 
  insertAssetSchema, insertInvestorProfileSchema, insertPipelineStageSchema,
  insertLeadRuleSchema,
  users, connectors, companies, contacts, leads, deals, assets, 
  investorProfiles, matchSuggestions, pipelineStages, leadRules,
  organizations
} from './schema';

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
  sdr: {
    queue: {
      method: 'GET' as const,
      path: '/api/sdr/queue' as const,
      responses: { 
        200: z.array(z.custom<typeof leads.$inferSelect & { company: typeof companies.$inferSelect }>()) 
      }
    },
    updateLead: {
      method: 'PATCH' as const,
      path: '/api/sdr/leads/:id' as const,
      input: z.object({ status: z.string() }),
      responses: { 200: z.custom<typeof leads.$inferSelect>() }
    },
    rules: {
      list: {
        method: 'GET' as const,
        path: '/api/sdr/rules' as const,
        responses: { 200: z.array(z.custom<typeof leadRules.$inferSelect>()) }
      }
    }
  },
  crm: {
    companies: {
      list: {
        method: 'GET' as const,
        path: '/api/crm/companies' as const,
        responses: { 200: z.array(z.custom<typeof companies.$inferSelect>()) }
      },
      create: {
        method: 'POST' as const,
        path: '/api/crm/companies' as const,
        input: insertCompanySchema,
        responses: { 201: z.custom<typeof companies.$inferSelect>() }
      }
    },
    contacts: {
      list: {
        method: 'GET' as const,
        path: '/api/crm/contacts' as const,
        responses: { 200: z.array(z.custom<typeof contacts.$inferSelect>()) }
      },
      create: {
        method: 'POST' as const,
        path: '/api/crm/contacts' as const,
        input: insertContactSchema,
        responses: { 201: z.custom<typeof contacts.$inferSelect>() }
      }
    },
    deals: {
      list: {
        method: 'GET' as const,
        path: '/api/crm/deals' as const,
        input: z.object({ pipelineType: z.string().optional() }).optional(),
        responses: { 
          200: z.array(z.custom<typeof deals.$inferSelect & { company: typeof companies.$inferSelect | null }>()) 
        }
      },
      create: {
        method: 'POST' as const,
        path: '/api/crm/deals' as const,
        input: insertDealSchema,
        responses: { 201: z.custom<typeof deals.$inferSelect>() }
      },
      update: {
        method: 'PATCH' as const,
        path: '/api/crm/deals/:id' as const,
        input: insertDealSchema.partial(),
        responses: { 200: z.custom<typeof deals.$inferSelect>() }
      }
    },
    stages: {
      list: {
        method: 'GET' as const,
        path: '/api/crm/stages' as const,
        responses: { 200: z.array(z.custom<typeof pipelineStages.$inferSelect>()) }
      }
    }
  },
  matching: {
    assets: {
      list: {
        method: 'GET' as const,
        path: '/api/matching/assets' as const,
        responses: { 200: z.array(z.custom<typeof assets.$inferSelect>()) }
      },
      create: {
        method: 'POST' as const,
        path: '/api/matching/assets' as const,
        input: insertAssetSchema,
        responses: { 201: z.custom<typeof assets.$inferSelect>() }
      }
    },
    investors: {
      list: {
        method: 'GET' as const,
        path: '/api/matching/investors' as const,
        responses: { 200: z.array(z.custom<typeof investorProfiles.$inferSelect>()) }
      },
      create: {
        method: 'POST' as const,
        path: '/api/matching/investors' as const,
        input: insertInvestorProfileSchema,
        responses: { 201: z.custom<typeof investorProfiles.$inferSelect>() }
      }
    },
    suggestions: {
      list: {
        method: 'GET' as const,
        path: '/api/matching/suggestions' as const,
        responses: { 
          200: z.array(z.custom<typeof matchSuggestions.$inferSelect & { 
            asset: typeof assets.$inferSelect,
            investor: typeof investorProfiles.$inferSelect
          }>()) 
        }
      },
      run: {
        method: 'POST' as const,
        path: '/api/matching/run' as const,
        responses: { 200: z.object({ success: z.boolean(), matchesFound: z.number() }) }
      }
    }
  },
  stats: {
    dashboard: {
      method: 'GET' as const,
      path: '/api/stats/dashboard' as const,
      responses: {
        200: z.object({
          leadsCount: z.number(),
          activeDealsCount: z.number(),
          assetsCount: z.number(),
          investorsCount: z.number(),
          matchesCount: z.number()
        })
      }
    }
  }
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
