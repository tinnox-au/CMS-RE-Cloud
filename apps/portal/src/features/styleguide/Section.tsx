import type { ReactNode } from 'react';
import { cx } from '../../ui/index.ts';

export interface SectionProps {
  /** Also the anchor in the side navigation. */
  readonly id: string;
  readonly title: string;
  readonly lead?: ReactNode;
  readonly children: ReactNode;
}

export function Section({ id, title, lead, children }: SectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="tx-sg-section" aria-labelledby={titleId}>
      <header className="tx-sg-section__head">
        <h2 id={titleId}>{title}</h2>
        {lead !== undefined && <p className="tx-muted">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

export interface DemoProps {
  readonly title: string;
  /** A sentence under the stage: what to try, or what the demo does not do. */
  readonly note?: ReactNode;
  /** `row` wraps items in a line, `stack` puts them under each other, `page` drops the frame. */
  readonly layout?: 'row' | 'stack' | 'page';
  readonly children: ReactNode;
}

/** One framed example with a caption. */
export function Demo({ title, note, layout = 'row', children }: DemoProps) {
  return (
    <div className="tx-sg-demo">
      <h3 className="tx-caption">{title}</h3>
      <div className={cx('tx-sg-demo__stage', layout !== 'row' && `tx-sg-demo__stage--${layout}`)}>
        {children}
      </div>
      {note !== undefined && <p className="tx-small tx-muted">{note}</p>}
    </div>
  );
}
