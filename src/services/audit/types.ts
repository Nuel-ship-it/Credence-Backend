/**
 * Audit log action types
 */
export enum AuditAction {
  LIST_USERS = 'LIST_USERS',
  ASSIGN_ROLE = 'ASSIGN_ROLE',
  REVOKE_ROLE = 'REVOKE_ROLE',
  REVOKE_API_KEY = 'REVOKE_API_KEY',
  CREATE_API_KEY = 'CREATE_API_KEY',
  DELETE_USER = 'DELETE_USER',
  DISPUTE_SUBMITTED = 'DISPUTE_SUBMITTED',
  DISPUTE_MARKED_UNDER_REVIEW = 'DISPUTE_MARKED_UNDER_REVIEW',
  DISPUTE_RESOLVED = 'DISPUTE_RESOLVED',
  DISPUTE_DISMISSED = 'DISPUTE_DISMISSED',
  SLASH_REQUEST_CREATED = 'SLASH_REQUEST_CREATED',
  SLASH_VOTE_CAST = 'SLASH_VOTE_CAST',
  EVIDENCE_UPLOADED = 'EVIDENCE_UPLOADED',
  EVIDENCE_ACCESSED = 'EVIDENCE_ACCESSED',
  EXPORT_AUDIT_LOGS = 'EXPORT_AUDIT_LOGS',
  ROTATE_WEBHOOK_SECRET = 'ROTATE_WEBHOOK_SECRET',
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string
  timestamp: string
  actorId: string
  actorEmail: string
  adminId?: string
  adminEmail?: string
  action: AuditAction | string
  resourceType: string
  resourceId: string
  targetUserId?: string
  targetUserEmail?: string
  details: Record<string, unknown>
  ipAddress?: string
  status: AuditStatus
  errorMessage?: string
}
