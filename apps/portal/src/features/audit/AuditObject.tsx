import type { AuditEventDto } from '@tinnox/contracts';
import { Link } from 'react-router-dom';
import {
  auditObjectTypeLabel,
  auditTagScope,
  auditTargetLabel,
  resolveAuditTarget,
  shortAuditId,
  type AuditNames,
  type AuditTarget,
} from '../../lib/auditView.ts';
import { VisuallyHidden } from '../../ui/index.ts';
import './audit.css';

export interface AuditTargetLineProps {
  readonly target: AuditTarget;
  readonly names: AuditNames;
  readonly event: Pick<AuditEventDto, 'detail'>;
  /** Show the whole identifier rather than its first block (the details dialog). */
  readonly fullId?: boolean;
}

/**
 * One object an event names: its name as a link where it still exists and has a page, "No
 * longer exists" once its list shows it was deleted, and the identifier where neither is known.
 * Nothing is invented: a name comes only from a list the server returned.
 */
export function AuditTargetLine({ target, names, event, fullId = false }: AuditTargetLineProps) {
  const resolved = resolveAuditTarget(target, names, auditTagScope(event.detail));
  const kind = auditTargetLabel(target.kind);
  const id = fullId ? target.id : shortAuditId(target.id);
  if (resolved.state === 'found') {
    return (
      <span className="tx-audit-object">
        {resolved.path === null ? (
          <span className="tx-audit-object__name">{resolved.name}</span>
        ) : (
          <Link className="tx-audit-object__name" to={resolved.path} title={resolved.name}>
            {resolved.name}
          </Link>
        )}
        <span className="tx-audit-object__meta">
          {kind} ·{' '}
          <span className="tx-mono" title={target.id}>
            {id}
          </span>
        </span>
      </span>
    );
  }
  if (resolved.state === 'gone') {
    return (
      <span className="tx-audit-object">
        <span className="tx-audit-object__name tx-audit-object__name--gone">
          {kind} <span className="tx-audit-object__gone">no longer exists</span>
        </span>
        <span className="tx-audit-object__meta">
          <span className="tx-mono" title={target.id}>
            {id}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="tx-audit-object">
      <span className="tx-audit-object__name">{kind}</span>
      <span className="tx-audit-object__meta">
        {resolved.path === null ? (
          <span className="tx-mono" title={target.id}>
            {id}
          </span>
        ) : (
          <Link className="tx-mono" to={resolved.path} title={target.id}>
            {id}
            <VisuallyHidden> (open {kind.toLowerCase()})</VisuallyHidden>
          </Link>
        )}
      </span>
    </span>
  );
}

export interface AuditPlainObjectProps {
  readonly event: Pick<AuditEventDto, 'objectType' | 'objectId'>;
  readonly fullId?: boolean;
}

/** An object the portal has no page for (an operator account, a session): its kind and id. */
export function AuditPlainObject({ event, fullId = false }: AuditPlainObjectProps) {
  const kind = auditObjectTypeLabel(event.objectType);
  if (kind === null && event.objectId === null) {
    return (
      <span className="tx-audit-none">
        <span aria-hidden="true">–</span>
        <VisuallyHidden>None</VisuallyHidden>
      </span>
    );
  }
  return (
    <span className="tx-audit-object">
      <span className="tx-audit-object__name">{kind ?? 'Object'}</span>
      {event.objectId !== null && (
        <span className="tx-audit-object__meta">
          <span className="tx-mono tx-break" title={event.objectId}>
            {fullId ? event.objectId : shortAuditId(event.objectId)}
          </span>
        </span>
      )}
    </span>
  );
}
