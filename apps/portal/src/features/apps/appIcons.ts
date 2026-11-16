import type { AppType } from '@tinnox/contracts';
import {
  CalendarDays,
  Clock,
  MoveHorizontal,
  QrCode,
  Timer,
  Type,
  type IconComponent,
} from '../../ui/icons.ts';

/** The picture of each app type, in lists, the library and the sequence. */
export const APP_TYPE_ICONS: { readonly [K in AppType]: IconComponent } = {
  clock: Clock,
  date: CalendarDays,
  countdown: Timer,
  ticker: MoveHorizontal,
  qr: QrCode,
  text: Type,
};
