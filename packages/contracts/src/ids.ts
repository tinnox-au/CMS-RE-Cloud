import { z } from 'zod';

/** All entity identifiers are server-generated UUIDs. */
export const UuidSchema = z.uuid();

export const OrgIdSchema = UuidSchema;
export const SiteIdSchema = UuidSchema;
export const DisplayIdSchema = UuidSchema;
export const MediaIdSchema = UuidSchema;
export const PlaylistIdSchema = UuidSchema;
export const PlaylistItemIdSchema = UuidSchema;
export const PublicationIdSchema = UuidSchema;
export const RegistrationIdSchema = UuidSchema;
export const PairingSessionIdSchema = UuidSchema;
export const TagIdSchema = UuidSchema;
export const FolderIdSchema = UuidSchema;
export const AppIdSchema = UuidSchema;
export const ScheduleIdSchema = UuidSchema;
export const LayoutIdSchema = UuidSchema;

export type Uuid = z.infer<typeof UuidSchema>;
export type OrgId = Uuid;
export type SiteId = Uuid;
export type DisplayId = Uuid;
export type MediaId = Uuid;
export type PlaylistId = Uuid;
export type PlaylistItemId = Uuid;
export type PublicationId = Uuid;
export type RegistrationId = Uuid;
export type PairingSessionId = Uuid;
export type TagId = Uuid;
export type FolderId = Uuid;
export type AppId = Uuid;
export type ScheduleId = Uuid;
export type LayoutId = Uuid;

/** ISO 8601 UTC timestamp, for example 2026-11-14T03:15:00.000Z. */
export const UtcTimestampSchema = z.iso.datetime();
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

/**
 * Wall-clock date and time without a zone, for example 2026-11-14T09:30. Read in
 * the zone of each screen's site. Year 1000 or later: PostgreSQL has no year 0.
 */
export const LocalDateTimeSchema = z
  .string()
  .regex(/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'expected YYYY-MM-DDTHH:mm')
  .refine((v) => {
    const date = new Date(`${v}:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 16) === v;
  }, 'not a real date and time');
export type LocalDateTime = z.infer<typeof LocalDateTimeSchema>;

/** Wall-clock time of day, HH:mm. '24:00' is the end of the day. */
export const LocalTimeSchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'expected HH:mm between 00:00 and 24:00');
export type LocalTime = z.infer<typeof LocalTimeSchema>;

/**
 * IANA time zone name. Length only: an older player's time zone data must not
 * reject a whole manifest over a zone name. The server checks the zone when it
 * builds a manifest; the player fails open.
 */
export const TimeZoneSchema = z.string().min(1).max(64);
export type TimeZone = z.infer<typeof TimeZoneSchema>;

/** Lower-case hexadecimal SHA-256 digest. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected 64 lower-case hex characters');
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/**
 * Route parameter object for `/:id` style routes. A UUID is accepted in either
 * letter case and parses to lower case, the form the database returns: whatever
 * a route records about the object (its audit event above all) then names it in
 * one spelling only, however the address was typed.
 */
export const IdParamSchema = z
  .object({ id: UuidSchema.transform((id) => id.toLowerCase()) })
  .strict();
export type IdParam = z.infer<typeof IdParamSchema>;
