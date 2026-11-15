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

/** ISO 8601 UTC timestamp, for example 2026-11-14T03:15:00.000Z. */
export const UtcTimestampSchema = z.iso.datetime();
export type UtcTimestamp = z.infer<typeof UtcTimestampSchema>;

/** Lower-case hexadecimal SHA-256 digest. */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected 64 lower-case hex characters');
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

/** Route parameter object for `/:id` style routes. */
export const IdParamSchema = z.object({ id: UuidSchema }).strict();
export type IdParam = z.infer<typeof IdParamSchema>;
