import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@easycontract/shared';
import type { Db } from '../db/index.ts';
import { newId, now } from '../db/index.ts';
import type { AiProvider, OcrProvider, PlaybookSource } from '../interfaces/index.ts';
import type { FileStorage } from './storage.ts';
import type { Config } from '../config.ts';
import { type Action, can } from './access-policy.ts';

export interface Services {
  db: Db;
  storage: FileStorage;
  ai: AiProvider;
  playbooks: PlaybookSource;
  /** Present only when local OCR is switched on and available. */
  ocr?: OcrProvider | null;
  config: Config;
}

export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
  /** How the request was signed in: a session cookie, the dev-only header, or temporary open access. */
  via: 'session' | 'dev' | 'open';
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, 'Not found');

/** Records who did what. Metadata only: never pass document or clause text. */
export function audit(
  db: Db,
  e: { tenantId: string; userId: string | null; action: string; resourceType?: string; resourceId?: string; outcome: 'allowed' | 'denied'; metadata?: Record<string, string | number | boolean | null> },
) {
  db.prepare(
    `INSERT INTO audit_events (id, tenant_id, user_id, action, resource_type, resource_id, outcome, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId('aud'), e.tenantId, e.userId, e.action, e.resourceType ?? null, e.resourceId ?? null, e.outcome,
    JSON.stringify(e.metadata ?? {}), now());
}

export function recordUsage(db: Db, e: { tenantId: string; userId: string; kind: 'ai_tokens' | 'pages_processed'; quantity: number; refType: string; refId: string }) {
  db.prepare(
    `INSERT INTO usage_events (id, tenant_id, user_id, kind, quantity, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId('use'), e.tenantId, e.userId, e.kind, e.quantity, e.refType, e.refId, now());
}

/** Throws 403 (and audits it) unless the role allows the action. */
export function requireCan(db: Db, actor: Actor, role: Role, action: Action, resource?: { type: string; id: string }) {
  if (can(role, action)) return;
  audit(db, { tenantId: actor.tenantId, userId: actor.userId, action: 'access.denied', resourceType: resource?.type,
    resourceId: resource?.id, outcome: 'denied', metadata: { attempted: action, reason: 'role' } });
  throw new HttpError(403, "Your role doesn't allow this.");
}

/**
 * Audits a lookup that found nothing in the caller's tenant but exists in
 * another one. The caller still just gets a 404, so nothing leaks.
 */
export function auditCrossTenant(db: Db, actor: Actor, table: 'projects' | 'documents' | 'extraction_blocks', id: string) {
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND tenant_id <> ?`).get(id, actor.tenantId);
  if (exists) {
    audit(db, { tenantId: actor.tenantId, userId: actor.userId, action: 'access.denied', resourceType: table, resourceId: id,
      outcome: 'denied', metadata: { reason: 'other_tenant' } });
  }
}

export type Req = FastifyRequest;
export type Res = FastifyReply;

/** A safe download file name: letters, digits, dots and single dashes. */
export function fileName(title: string, ext: string) {
  const base = title.replace(/[^\w.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'document';
  return `${base}.${ext}`;
}
