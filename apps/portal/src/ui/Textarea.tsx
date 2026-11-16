import type { Ref, TextareaHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>;
}

/** A multi-line text field that can be resized downwards. Put it inside a Field. */
export function Textarea({ className, rows = 3, ref, ...rest }: TextareaProps) {
  return <textarea {...rest} ref={ref} rows={rows} className={cx('tx-textarea', className)} />;
}
