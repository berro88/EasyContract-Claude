import type { FastifyInstance } from 'fastify';
import type { FindingsResponse } from '@easycontract/shared';
import { type Services, HttpError, notFound } from '../lib/context.ts';
import { runFindings } from '../analysis/findings.ts';
import { latestVersion, listDocuments, loadDocument, versionBlocks } from './documents.ts';

export const findingsRoutes = ({ db }: Services) => async (app: FastifyInstance) => {
  /** Risk findings for a document's latest version. Computed on request from stored passages. */
  app.get('/api/documents/:documentId/findings', async (req): Promise<FindingsResponse> => {
    const { documentId } = req.params as { documentId: string };
    const doc = loadDocument(db, req.actor, documentId);
    const v = latestVersion(db, req.actor.tenantId, documentId);
    if (!v) throw notFound();
    if (v.status !== 'ready') throw new HttpError(422, `We couldn't read "${doc.title}", so it can't be checked for risks.`);
    const projectDocuments = listDocuments(db, req.actor.tenantId, doc.project_id)
      .filter((d) => d.id !== documentId && d.latestVersion?.status === 'ready')
      .map((d) => ({ title: d.title, role: d.role }));
    return runFindings({ versionId: v.id, role: doc.role, title: doc.title, blocks: versionBlocks(db, req.actor.tenantId, v.id), projectDocuments });
  });
};
