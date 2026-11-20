import type { ReactNode } from 'react';
import { Banner } from '../../ui/index.ts';

export interface ReadOnlyNoteProps {
  /** One line: what the person can do here and who makes changes. Never an instruction to act. */
  readonly children: ReactNode;
}

/**
 * The one line at the top of an editor, or of a section of the screen page, that the signed-in
 * role opens read-only (docs/portal-v2/stage-c.md, section 7.3). Import it by this file's path,
 * not through `index.ts`.
 */
export function ReadOnlyNote({ children }: ReadOnlyNoteProps) {
  return <Banner tone="info">{children}</Banner>;
}
