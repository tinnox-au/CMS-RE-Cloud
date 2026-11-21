import {
  MAX_ALERT_RECIPIENTS,
  type AlertRecipientDto,
  type AlertRecipientStatus,
} from '@tinnox/contracts';
import { useCallback, useState } from 'react';
import { isApiRequestError, isOutcomeUnknown } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { formatDate } from '../../lib/users.ts';
import { Page } from '../../shell/Page.tsx';
import { Bell, Plus } from '../../ui/icons.ts';
import {
  Breadcrumb,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorNotice,
  StatusPill,
  useToast,
  VisuallyHidden,
  type DataTableColumn,
  type StatusTone,
} from '../../ui/index.ts';
import { elementByTestId } from '../shared/index.ts';
import { AddAlertAddressDialog } from './AddAlertAddressDialog.tsx';

const STATUS: { readonly [K in AlertRecipientStatus]: { label: string; tone: StatusTone } } = {
  waiting: { label: 'Waiting for confirmation', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  expired: { label: 'Expired: remove and add again', tone: 'neutral' },
};

/**
 * Settings → Alerts (docs/portal-v2/stage-c-alerts.md section 6): the organisation's alert
 * addresses. Every screen alert goes to every confirmed address. Needs `alerts.manage`.
 */
export function AlertsPage() {
  const load = useCallback((signal: AbortSignal) => api.listAlertRecipients(signal), []);
  const { state, reload } = useLoad<AlertRecipientDto[]>(load);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AlertRecipientDto | null>(null);

  const addButton = (size: 'md' | 'lg') => (
    <Button
      variant="primary"
      size={size}
      icon={Plus}
      onClick={() => {
        setAdding(true);
      }}
      data-testid="settings-alerts-add"
    >
      Add address
    </Button>
  );

  const columns: readonly DataTableColumn<AlertRecipientDto>[] = [
    {
      id: 'email',
      header: 'Address',
      grow: true,
      cell: (recipient) => (
        <span translate="no" title={recipient.email}>
          {recipient.email}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: '260px',
      cell: (recipient) => (
        <StatusPill tone={STATUS[recipient.status].tone}>
          {STATUS[recipient.status].label}
        </StatusPill>
      ),
    },
    {
      id: 'added',
      header: 'Added',
      numeric: true,
      width: '120px',
      priority: 2,
      cell: (recipient) => formatDate(recipient.createdAt),
    },
  ];

  const removeButton = (recipient: AlertRecipientDto) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        setRemoveTarget(recipient);
      }}
      data-testid="settings-alerts-row-remove"
    >
      Remove
      <VisuallyHidden> {recipient.email}</VisuallyHidden>
    </Button>
  );

  let body;
  if (state.status === 'error') {
    body = (
      <ErrorNotice
        error={state.error}
        title="The alert addresses could not be loaded"
        onRetry={reload}
      />
    );
  } else if (state.status === 'ready' && state.data.length === 0) {
    body = (
      <Card flush>
        <EmptyState icon={Bell} title="No alert addresses yet" action={addButton('lg')} level={2}>
          Add an address to receive an e-mail when a screen stops reporting.
        </EmptyState>
      </Card>
    );
  } else {
    // shortcut: not paged or searched; the list holds at most MAX_ALERT_RECIPIENTS (20).
    body = (
      <>
        <div className="tx-toolbar">
          <p className="tx-toolbar__count" aria-live="polite" data-testid="settings-alerts-count">
            {state.status === 'ready'
              ? `${state.data.length} of ${MAX_ALERT_RECIPIENTS} addresses`
              : ''}
          </p>
          <div className="tx-toolbar__end">{addButton('md')}</div>
        </div>
        <DataTable
          caption="Alert addresses"
          columns={columns}
          rows={state.status === 'ready' ? state.data : []}
          rowId={(recipient) => recipient.id}
          rowActions={removeButton}
          loading={state.status === 'loading'}
          loadingRows={2}
          rowTestId={(recipient) => `settings-alerts-row-${recipient.id}`}
          density="compact"
        />
      </>
    );
  }

  return (
    <Page title="Alerts">
      <div className="tx-stack" data-testid="settings-alerts-page">
        <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Alerts' }]} />
        <p className="tx-muted">
          Every screen alert goes to every confirmed address here. An address receives nothing until
          its owner opens the link in the confirmation e-mail. When to e-mail is set on each
          screen’s Alerts tab.
        </p>
        {state.status === 'ready' && state.refreshError !== null && (
          <ErrorNotice
            error={state.refreshError}
            title="The alert addresses could not be refreshed"
            onRetry={reload}
          />
        )}
        {body}
      </div>
      <AddAlertAddressDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        onSaved={reload}
      />
      <RemoveAddressDialog
        recipient={removeTarget}
        onClose={() => {
          setRemoveTarget(null);
        }}
        onRemoved={reload}
      />
    </Page>
  );
}

function RemoveAddressDialog({
  recipient,
  onClose,
  onRemoved,
}: {
  readonly recipient: AlertRecipientDto | null;
  readonly onClose: () => void;
  /** The list is out of date: after a removal, or an answer that says it may be. */
  readonly onRemoved: () => void;
}) {
  const toast = useToast();
  // The address as it was when the dialog opened; it stays while the dialog fades out.
  const [shown, setShown] = useState(recipient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [previous, setPrevious] = useState(recipient);
  if (recipient !== previous) {
    setPrevious(recipient);
    if (recipient !== null) {
      setShown(recipient);
      setBusy(false);
      setError(null);
    }
  }

  const confirm = () => {
    if (busy || shown === null) return;
    const target = shown;
    setBusy(true);
    setError(null);
    api.removeAlertRecipient(target.id).then(
      () => {
        setBusy(false);
        onRemoved();
        onClose();
        toast.success(`${target.email} removed from the alert list`);
      },
      (reason: unknown) => {
        setBusy(false);
        // Already gone (removed meanwhile, or by an earlier try whose answer was lost): what
        // was wanted has happened, so say that rather than an error.
        if (isApiRequestError(reason) && reason.status === 404) {
          onRemoved();
          onClose();
          toast.info(`${target.email} was already removed`);
          return;
        }
        // Perhaps removed by this request: read the list again.
        if (isOutcomeUnknown(reason)) onRemoved();
        setError(reason);
      },
    );
  };

  return (
    <ConfirmDialog
      open={recipient !== null}
      title="Remove this address?"
      confirmLabel="Remove address"
      tone="danger"
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
      testId="settings-alerts-remove-dialog"
      returnFocus={focusAfterRemove}
    >
      <p>
        <strong translate="no">{shown?.email}</strong> will receive no more screen alerts. To add it
        again, its owner must confirm it again.
      </p>
      {error !== null && (
        <ErrorNotice
          error={error}
          title={
            isOutcomeUnknown(error)
              ? 'The removal could not be confirmed'
              : 'The address was not removed'
          }
        />
      )}
    </ConfirmDialog>
  );
}

/** Once a removed row is gone: another row's Remove button, else "Add address". */
function focusAfterRemove(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-testid="settings-alerts-row-remove"]') ??
    elementByTestId('settings-alerts-add')()
  );
}
