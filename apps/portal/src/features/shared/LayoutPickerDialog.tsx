import type { LayoutDto } from '@tinnox/contracts';
import { api } from '../../api/index.ts';
import { layoutSearchTexts, layoutSummaryLabel } from '../../lib/layouts.ts';
import { LayoutTemplate } from '../../ui/icons.ts';
import { LibraryPickerDialog, type LibraryPickerProps } from './LibraryPickerDialog.tsx';

/**
 * Defaults: title "Choose a layout", confirmLabel "Choose layout", testId
 * `shared-layout-picker`, errorTitle "The change was not saved".
 */
export type LayoutPickerDialogProps = LibraryPickerProps<LayoutDto>;

function loadLayouts(signal: AbortSignal): Promise<LayoutDto[]> {
  return api.listLayouts(signal);
}

const LAYOUTS = { singular: 'layout', plural: 'layouts', href: '/layouts' } as const;

/**
 * Chooses one layout: a searchable list with each layout's main zone playlist and its band
 * height (or number of zones). The list is loaded afresh each time the dialog opens. There is
 * no "none" here: content is removed from a screen on the screen's page.
 */
export function LayoutPickerDialog({
  title = 'Choose a layout',
  confirmLabel = 'Choose layout',
  testId = 'shared-layout-picker',
  ...props
}: LayoutPickerDialogProps) {
  return (
    <LibraryPickerDialog
      {...props}
      title={title}
      confirmLabel={confirmLabel}
      testId={testId}
      load={loadLayouts}
      meta={layoutSummaryLabel}
      searchTexts={layoutSearchTexts}
      icon={LayoutTemplate}
      noun={LAYOUTS}
    />
  );
}
