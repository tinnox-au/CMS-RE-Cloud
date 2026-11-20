import type { AuditEventDto } from '@tinnox/contracts';
import { useState } from 'react';
import {
  auditActionLabel,
  auditActor,
  auditActorIdLabel,
  auditActorText,
  auditAllTargets,
  auditDetailJson,
  auditReasonCodes,
  auditTime,
  presentAuditResult,
  type AuditNames,
} from '../../lib/auditView.ts';
import { Button, Dialog, Fact, Facts, StatusPill } from '../../ui/index.ts';
import { AuditPlainObject, AuditTargetLine } from './AuditObject.tsx';
import './audit.css';

export interface AuditDetailDialogProps {
  /** The event to show; null keeps the dialog closed. */
  readonly event: AuditEventDto | null;
  readonly names: AuditNames;
  readonly onClose: () => void;
}

/**
 * Everything one audit event recorded: when (local and UTC), what, the result, who (the
 * person's name from the member list, marked when they were removed or renamed since), the
 * objects it names, and its structured detail as JSON. Every value is put on the page as
 * text; nothing from an event is ever read as markup.
 */
export function AuditDetailDialog({ event, names, onClose }: AuditDetailDialogProps) {
  const open = event !== null;
  // The event stays while the dialog fades out.
  const [shown, setShown] = useState<AuditEventDto | null>(event);
  if (event !== null && event !== shown) setShown(event);

  const current = event ?? shown;
  const time = current === null ? null : auditTime(current.occurredAt);
  const result = current === null ? null : presentAuditResult(current.result);
  const json = current === null ? '' : auditDetailJson(current.detail);
  const targets = current === null ? [] : auditAllTargets(current);
  const reasons = current === null ? [] : auditReasonCodes(current);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={current === null ? 'Event' : auditActionLabel(current)}
      description={time?.local}
      size="md"
      className="tx-audit-dialog"
      footer={
        <Button variant="primary" onClick={onClose} data-testid="audit-detail-close">
          Close
        </Button>
      }
    >
      {current !== null && time !== null && result !== null && (
        <div className="tx-stack" data-testid="audit-detail">
          <Facts className="tx-audit-dialog__facts">
            <Fact label="Time">
              <time dateTime={time.iso ?? undefined}>{time.local}</time>
            </Fact>
            <Fact label="Exact time (UTC)" testId="audit-detail-utc">
              <span className="tx-mono">{time.utc}</span>
            </Fact>
            <Fact label="Action" testId="audit-detail-action">
              <code className="tx-audit-raw">{current.action}</code>
            </Fact>
            <Fact label="Result">
              <StatusPill tone={result.tone}>{result.label}</StatusPill>
            </Fact>
            {reasons.length > 0 && (
              <Fact label="Reason">
                <span className="tx-cluster">
                  {reasons.map((code) => (
                    <span key={code} className="tx-code">
                      {code}
                    </span>
                  ))}
                </span>
              </Fact>
            )}
            <Fact label="Actor" testId="audit-detail-actor">
              {auditActorText(auditActor(current, names))}
            </Fact>
            {current.actorId !== null && (
              <Fact label={auditActorIdLabel(current.actorType)}>
                <span className="tx-mono tx-break">{current.actorId}</span>
              </Fact>
            )}
            {targets.length === 0 ? (
              <Fact label="Object">
                <AuditPlainObject event={current} fullId />
              </Fact>
            ) : (
              targets.map((target, index) => (
                <Fact
                  key={`${target.kind}:${target.id}`}
                  label={index === 0 ? 'Object' : 'Also names'}
                >
                  <AuditTargetLine target={target} names={names} event={current} fullId />
                </Fact>
              ))
            )}
            {targets.length > 0 &&
              current.objectType !== null &&
              current.objectId !== null &&
              !targets.some((target) => target.id === current.objectId?.toLowerCase()) && (
                <Fact label="Recorded object">
                  <AuditPlainObject event={current} fullId />
                </Fact>
              )}
            <Fact label="Event ID">
              <span className="tx-mono">{current.id}</span>
            </Fact>
          </Facts>
          <section className="tx-audit-dialog__detail" aria-labelledby="audit-detail-json-title">
            <h3 id="audit-detail-json-title" className="tx-caption tx-audit-dialog__caption">
              Recorded detail
            </h3>
            {json === '' ? (
              <p className="tx-muted">This event has no further detail.</p>
            ) : (
              <pre
                className="tx-audit-json"
                tabIndex={0}
                aria-label="Recorded detail as JSON"
                data-testid="audit-detail-json"
              >
                {json}
              </pre>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
