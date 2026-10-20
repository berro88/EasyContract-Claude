import type { FastifyInstance } from 'fastify';
import { type CompanyProfile, type Me, POLICY_DISCLAIMER, POLICY_IS_DRAFT, POLICY_KEY, POLICY_SECTIONS, POLICY_TITLE, POLICY_VERSION } from '@easycontract/shared';
import { type Services, HttpError, audit, requireCan } from '../lib/context.ts';

const PROFILE_FIELDS: (keyof CompanyProfile)[] = ['name', 'legalName', 'registrationNumber', 'address', 'country', 'industry', 'contactEmail'];

export function readProfile(json: string): CompanyProfile {
  const raw = JSON.parse(json || '{}') as Partial<CompanyProfile>;
  return Object.fromEntries(PROFILE_FIELDS.map((f) => [f, typeof raw[f] === 'string' ? raw[f] : ''])) as unknown as CompanyProfile;
}

export const tenantRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  app.get('/api/me', async (req): Promise<Me> => {
    const { userId, tenantId, role } = req.actor;
    const user = db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).get(userId) as Me['user'];
    const tenant = db.prepare(`SELECT id, name FROM tenants WHERE id = ?`).get(tenantId) as Me['tenant'];
    const sub = db.prepare(`SELECT plan_id FROM subscriptions WHERE tenant_id = ? AND status = 'active' LIMIT 1`).get(tenantId) as { plan_id: string } | undefined;
    const accepted = db.prepare(
      `SELECT 1 FROM policy_acceptances WHERE user_id = ? AND tenant_id = ? AND document_key = ? AND version = ?`,
    ).get(userId, tenantId, POLICY_KEY, POLICY_VERSION);
    return { user, tenant, role, plan: sub?.plan_id ?? null, policyAccepted: !!accepted, authMode: req.actor.via };
  });

  app.get('/api/policy', async () => ({
    key: POLICY_KEY,
    version: POLICY_VERSION,
    draft: POLICY_IS_DRAFT,
    title: POLICY_TITLE,
    disclaimer: POLICY_DISCLAIMER,
    sections: POLICY_SECTIONS,
  }));

  app.get('/api/tenant/profile', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.view');
    const row = db.prepare(`SELECT profile_json FROM tenants WHERE id = ?`).get(req.actor.tenantId) as { profile_json: string };
    return readProfile(row.profile_json);
  });

  app.put('/api/tenant/profile', async (req) => {
    requireCan(db, req.actor, req.actor.role, 'tenant.update', { type: 'tenants', id: req.actor.tenantId });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = {} as CompanyProfile;
    for (const f of PROFILE_FIELDS) {
      const v = body[f];
      if (v !== undefined && typeof v !== 'string') throw new HttpError(400, `${f} must be text.`);
      if (typeof v === 'string' && v.length > 500) throw new HttpError(400, `${f} is too long.`);
      profile[f] = (v as string | undefined)?.trim() ?? '';
    }
    if (!profile.name) throw new HttpError(400, 'Company name is required.');
    db.prepare(`UPDATE tenants SET profile_json = ?, name = ? WHERE id = ?`).run(JSON.stringify(profile), profile.name, req.actor.tenantId);
    audit(db, { tenantId: req.actor.tenantId, userId: req.actor.userId, action: 'tenant.profile_update', resourceType: 'tenants',
      resourceId: req.actor.tenantId, outcome: 'allowed' });
    return profile;
  });
};
