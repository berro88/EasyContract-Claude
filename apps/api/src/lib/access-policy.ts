// The one place that decides who may do what. Routes ask `can(role, action)`
// and never compare roles themselves.

import type { Role } from '@easycontract/shared';

export type Action =
  | 'tenant.view'
  | 'tenant.update'
  | 'project.view'
  | 'project.create'
  | 'document.view'
  | 'document.upload'
  | 'comment.create'
  | 'member.invite';

const MATRIX: Record<Action, readonly Role[]> = {
  'tenant.view': ['owner', 'admin', 'reviewer', 'commenter', 'read_only'],
  'tenant.update': ['owner', 'admin'],
  'project.view': ['owner', 'admin', 'reviewer', 'commenter', 'read_only'],
  'project.create': ['owner', 'admin', 'reviewer'],
  'document.view': ['owner', 'admin', 'reviewer', 'commenter', 'read_only'],
  'document.upload': ['owner', 'admin', 'reviewer'],
  'comment.create': ['owner', 'admin', 'reviewer', 'commenter'],
  'member.invite': ['owner', 'admin'],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

const RANK: Record<Role, number> = { read_only: 0, commenter: 1, reviewer: 2, admin: 3, owner: 4 };

/**
 * A project grant can raise or lower someone's role on one project. Owners and
 * admins keep their tenant-wide role.
 */
export function effectiveProjectRole(tenantRole: Role, grantRole: Role | null): Role {
  if (!grantRole || RANK[tenantRole] >= RANK.admin) return tenantRole;
  return grantRole;
}
