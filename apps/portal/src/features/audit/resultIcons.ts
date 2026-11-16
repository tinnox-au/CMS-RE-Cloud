import type { AuditResult } from '@tinnox/contracts';
import {
  CircleCheck,
  CircleX,
  TriangleExclamationPoint,
  type IconComponent,
} from '../../ui/icons.ts';

/** The icon beside each result, so a result never rests on its colour alone. */
export const RESULT_ICONS: { readonly [K in AuditResult]: IconComponent } = {
  success: CircleCheck,
  failure: CircleX,
  denied: TriangleExclamationPoint,
};
