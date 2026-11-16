/** Build-time configuration of the player. Nothing here is secret. */
export const API_ORIGIN: string = __API_ORIGIN__;

/** Reported in every heartbeat (max 40 characters). */
export const PLAYER_VERSION = 'player-web/0.2.0';

/** True in `vite build` output. The service worker is only registered there. */
export const IS_PRODUCTION_BUILD: boolean = import.meta.env.PROD;
