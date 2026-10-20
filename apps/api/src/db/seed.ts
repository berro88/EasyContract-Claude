import { POLICY_KEY, POLICY_VERSION } from '@easycontract/shared';
import { type Db, newId, now } from './index.ts';
import { seedExamples } from '../library/store.ts';

export const SEED = {
  tenantId: 'tenant_demo',
  ownerId: 'user_owner',
  // A second tenant exists only so isolation can be tested.
  otherTenantId: 'tenant_other',
  otherUserId: 'user_other',
};

/** Idempotent: safe to run against an existing database. */
export function seed(db: Db) {
  const t = now();
  const run = (sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);

  run(`INSERT OR IGNORE INTO plans (id, name, limits_json) VALUES ('local_unlimited', 'Local unlimited', '{}')`);

  const tenants: [string, string, string, string, string][] = [
    [SEED.tenantId, 'Demo Company', SEED.ownerId, 'owner@demo.example', 'Demo Owner'],
    [SEED.otherTenantId, 'Other Company', SEED.otherUserId, 'owner@other.example', 'Other Owner'],
  ];
  for (const [tenantId, tenantName, userId, email, userName] of tenants) {
    run(`INSERT OR IGNORE INTO tenants (id, name, profile_json, created_at) VALUES (?, ?, ?, ?)`,
      tenantId, tenantName, JSON.stringify({ name: tenantName }), t);
    run(`INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`, userId, email, userName, t);
    run(`INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      tenantId, userId, t);
    const hasSub = db.prepare(`SELECT 1 FROM subscriptions WHERE tenant_id = ?`).get(tenantId);
    if (!hasSub) {
      run(`INSERT INTO subscriptions (id, tenant_id, plan_id, status, created_at) VALUES (?, ?, 'local_unlimited', 'active', ?)`,
        newId('sub'), tenantId, t);
    }
    const hasAi = db.prepare(`SELECT 1 FROM ai_provider_configs WHERE tenant_id = ?`).get(tenantId);
    if (!hasAi) {
      run(`INSERT INTO ai_provider_configs (id, tenant_id, provider_key, model_id, data_residency, allow_external_processing, created_at)
           VALUES (?, ?, 'deterministic', NULL, 'local', 0, ?)`, newId('aic'), tenantId, t);
    }
    // Real sign-up (Stage 8) records this; the dev seed accepts on the user's behalf.
    const accepted = db.prepare(
      `SELECT 1 FROM policy_acceptances WHERE user_id = ? AND tenant_id = ? AND document_key = ? AND version = ?`,
    ).get(userId, tenantId, POLICY_KEY, POLICY_VERSION);
    if (!accepted) {
      run(`INSERT INTO policy_acceptances (id, user_id, tenant_id, document_key, version, accepted_at) VALUES (?, ?, ?, ?, ?, ?)`,
        newId('pol'), userId, tenantId, POLICY_KEY, POLICY_VERSION, t);
    }
  }
  // Labelled example library content, inactive, for the demo company only.
  seedExamples(db, SEED.tenantId);
}
