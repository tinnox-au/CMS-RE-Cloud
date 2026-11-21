/** Contract tests for e-mail alerts (CMS-15, docs/portal-v2/stage-c-alerts.md section 3). */
import { describe, expect, it } from 'vitest';
import {
  alertDelayText,
  AlertOfflineMinutesSchema,
  AlertRecipientConfirmSchema,
  AlertRecipientCreateSchema,
  AlertRecipientDtoSchema,
  DisplayPatchSchema,
  localWallClock,
  withinWorkingHours,
  type WallClock,
} from './index.ts';

const wall = (day: number, time: string): WallClock => ({ stamp: '', day, time });
const day = { start: '08:00', end: '20:00' };
const weekdays = [day, day, day, day, day, null, null];

describe('alert delay', () => {
  it('says how long the delay is', () => {
    expect(alertDelayText(30)).toBe('30 minutes');
    expect(alertDelayText(60)).toBe('1 hour');
    expect(alertDelayText(90)).toBe('1 hour 30 minutes');
    expect(alertDelayText(2880)).toBe('48 hours');
  });
});

describe('working hours', () => {
  it('reads the inside of today as open, the end as closed', () => {
    expect(withinWorkingHours(weekdays, wall(0, '08:00'))).toBe(true);
    expect(withinWorkingHours(weekdays, wall(0, '19:59'))).toBe(true);
    expect(withinWorkingHours(weekdays, wall(0, '20:00'))).toBe(false);
    expect(withinWorkingHours(weekdays, wall(0, '07:59'))).toBe(false);
    expect(withinWorkingHours(weekdays, wall(5, '12:00'))).toBe(false);
  });
  it('treats no hours as always on', () => {
    expect(withinWorkingHours(null, wall(6, '03:00'))).toBe(true);
  });
  it('reads the wall clock of a zone, and null for an unknown one', () => {
    expect(localWallClock(Date.parse('2026-11-17T21:30:00Z'), 'Australia/Melbourne')).toEqual({
      stamp: '2026-11-18T08:30',
      day: 2,
      time: '08:30',
    });
    expect(localWallClock(0, 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('alert settings', () => {
  it('accepts whole half hours from 30 minutes to 48 hours', () => {
    for (const ok of [30, 60, 90, 1440, 2880])
      expect(AlertOfflineMinutesSchema.safeParse(ok).success, String(ok)).toBe(true);
    for (const bad of [0, 15, 29, 45, 2910, 30.5])
      expect(AlertOfflineMinutesSchema.safeParse(bad).success, String(bad)).toBe(false);
  });
  it('patches the delay (null is off) and the back-online e-mail', () => {
    expect(DisplayPatchSchema.safeParse({ alertOfflineMinutes: null }).success).toBe(true);
    expect(DisplayPatchSchema.safeParse({ alertOfflineMinutes: 120 }).success).toBe(true);
    expect(DisplayPatchSchema.safeParse({ alertBackOnline: false }).success).toBe(true);
    expect(DisplayPatchSchema.safeParse({ alertBackOnline: 'no' }).success).toBe(false);
  });
});

describe('alert recipients', () => {
  it('validates the address as an invite e-mail and lower-cases it', () => {
    expect(AlertRecipientCreateSchema.parse({ email: ' Ops@Example.com ' }).email).toBe(
      'ops@example.com',
    );
    expect(AlertRecipientCreateSchema.safeParse({ email: 'not an address' }).success).toBe(false);
    expect(AlertRecipientCreateSchema.safeParse({ email: 'a@b.co', orgId: 'x' }).success).toBe(
      false,
    );
  });
  it('refuses name, group, list and quoted forms the mailer would deliver elsewhere', () => {
    for (const bad of [
      'attacker<victim@corp.com>',
      'foo,bar@evil.com',
      'a:b@corp.com;',
      '"x"@corp.com',
      'a(b)@corp.com',
      'a[b]@corp.com',
      'a\\b@corp.com',
      'a b@corp.com',
    ])
      expect(AlertRecipientCreateSchema.safeParse({ email: bad }).success, bad).toBe(false);
    expect(AlertRecipientCreateSchema.safeParse({ email: 'ops+tv@corp.com' }).success).toBe(true);
  });
  it('measures the address again after lower-casing', () => {
    // 'İ' lower-cases to two code points: 254 characters become 255.
    const long = `${'a'.repeat(241)}İ@example.com`;
    expect(long.length).toBe(254);
    expect(AlertRecipientCreateSchema.safeParse({ email: long }).success).toBe(false);
  });
  it('takes an opaque token to confirm', () => {
    expect(AlertRecipientConfirmSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
    expect(AlertRecipientConfirmSchema.safeParse({ token: 'a'.repeat(42) }).success).toBe(false);
  });
  it('has three statuses', () => {
    const dto = {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'ops@example.com',
      createdAt: '2026-11-21T00:00:00.000Z',
    };
    for (const status of ['waiting', 'confirmed', 'expired'])
      expect(AlertRecipientDtoSchema.safeParse({ ...dto, status }).success, status).toBe(true);
    expect(AlertRecipientDtoSchema.safeParse({ ...dto, status: 'sent' }).success).toBe(false);
  });
});
