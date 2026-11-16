# Operations and release checklist: TINNOX CMS prototype M0

Date: 2026-11-14. Companion to `docs/security/threat-model.md` and `docs/security/control-matrix.md`.

Status of this page: procedures written on 2026-11-14. **The backup and restore procedure (section 2) was executed once on 2026-11-14** with `npm run backup:verify` (results in section 2.4). The incident runbook has not been rehearsed. The release-checklist statuses in section 5 were updated by the integration step. This page states no legal conclusion; where the law is mentioned, it is OAIC's published description, and whether it applies to TINNOX is for TINNOX and its advisers to determine (`docs/security/control-matrix.md` section 6).

Contents: 1 incident response; 2 backup and restore; 3 retention; 4 data locations; 5 pre-customer-release checklist; 6 dependency updates.

## 1. Incident-response runbook

Scope: any suspected loss of confidentiality, integrity or availability of the CMS, its data, its credentials or its build pipeline. For the M0 prototype (local, synthetic data) the realistic incidents are a leaked development secret, a compromised dependency or developer account, and a defect that crosses the organisation boundary. The same steps are the starting point for a hosted service.

### 1.1 Roles (NEEDS TINNOX INPUT)

| Role | Responsibility | Named person |
|---|---|---|
| Incident owner | Runs the response, keeps the timeline, decides containment | _to be named_ |
| Technical lead | Investigates, contains, restores | _to be named_ |
| Privacy and legal contact | Decides whether a data breach assessment is needed, and on notification, with legal advice | _to be named_ |
| Executive sponsor | Accepts risk; approves external communication | _to be named_ |
| Customer contact | Tells affected customers as contracts require | _to be named_ |

### 1.2 Detection

Sources available in M0: `audit_event` rows (failed sign-ins, pairing failures and lockouts, revocations, publishes); API logs (rate-limit hits, 401, 403 and 404 bursts, start-up refusals); delivery status in the portal (unexpected active publication, heartbeats from a revoked registration being refused); `npm run audit` and `npm run scan:secrets` results in CI; a report from a person.

Not available in M0: central log collection, alerting, intrusion detection. Until these exist, detection depends on someone looking.

Anyone who suspects an incident tells the incident owner at once. Do not wait to be sure.

### 1.3 Containment (do first; do not wait for the assessment)

Pick what fits; record the time of each action in UTC.

| Situation | Action |
|---|---|
| Player device lost, cloned or token suspected stolen | Portal: revoke the player for that display (`POST /api/displays/:id/revoke-player`). Re-pair a trusted device. Revocation does not erase content already cached on the old device. |
| Operator account or session suspected stolen | Identity provider: end the user's sessions, reset credentials and the second factor, disable the account if needed. Database (as administrator): remove that subject's `session` rows. |
| Server secret exposed (`SESSION_SECRET`, `MEDIA_URL_HMAC_SECRET`, `PAIRING_CLIENT_KEY_SECRET`, `OIDC_CLIENT_SECRET`, a database password) | Replace the secret and restart. Rotating the session secret signs everyone out; rotating the HMAC secret invalidates outstanding media URLs (players request new ones). Development: `npm run setup -- --force`, then `npm run reset -- --yes` and start again (`docs/dev-handoff.md` section 8). Remove the secret from Git history if it was committed and treat it as exposed regardless. |
| Wrong or hostile content on a screen | Publish a known-good playlist to the display, or revoke the player. Keep the offending publication row: it is immutable and is evidence. |
| Cross-organisation exposure suspected | Take the affected route or the whole API offline until understood. Preserve logs first. |
| Malicious upload suspected | Stop the media worker container; keep the job files; do not open the file on a workstation. |
| Compromised dependency or CI | Freeze merges and deployments; pin to the last known-good lockfile; rotate any secret the pipeline could read. |

### 1.4 Evidence preservation

Before restarting, resetting or cleaning anything:

1. Record the timeline so far: who noticed what, when (UTC), and each action taken.
2. Export `audit_event` for the period (as a database administrator, so events with no organisation are included).
3. Save API, PostgreSQL, Keycloak and media-worker container logs (`npm run infra:logs` shows only recent lines; copy the full logs).
4. Take a database dump and a copy of the media and jobs directories using section 2, into a separate location with restricted access.
5. Record the Git commit, lockfile hash and container image identifiers that were running.
6. **Do not run `npm run reset`** until evidence is copied: it deletes the database volume, the Keycloak container and `./data`.

Evidence may contain personal information and secrets. Limit access and keep it only as long as the investigation and any legal hold need.

### 1.5 Assessment

Answer, in writing:

1. What happened, when, and is it still happening?
2. Which organisations, displays, media and accounts are affected?
3. Was any **personal information** involved (operator names and identifiers, addresses in logs, people shown in media)? Whose, how much, how sensitive?
4. Who obtained or could have obtained it, and what protection (hashing, expiry, revocation) still stands?
5. What harm is likely, and to whom?
6. What remedial action has been or can be taken to prevent that harm?

Start the assessment when the suspicion arises, in parallel with containment.

### 1.6 Escalation

- Immediately to the incident owner and technical lead.
- To the privacy and legal contact as soon as personal information may be involved, or a customer's data or screen was affected.
- To the executive sponsor for anything affecting a customer, anything that may need notification, or any incident still uncontained after one working day.
- Obtain legal advice before deciding that notification is or is not required.

### 1.7 Notification responsibilities

Who decides and who sends (NEEDS TINNOX INPUT: names, and customer contract terms):

| Audience | Trigger | Owner |
|---|---|---|
| Affected customers | As each contract requires, and in any case when their content, screens or accounts were affected | Customer contact, approved by executive sponsor |
| Affected individuals and the Australian Information Commissioner | Where the Notifiable Data Breaches scheme applies to TINNOX and an eligible data breach is established (below) | Privacy and legal contact |
| Other regulators, insurers, police, the Australian Signals Directorate's reporting channel | As advised | Executive sponsor with legal advice |
| Suppliers (hosting, identity provider) | When their service is involved | Technical lead |

**Notifiable Data Breaches (NDB) scheme: two different duties. Applicability to TINNOX is to be determined by TINNOX with counsel.** As OAIC's guidance (Part 4, updated February 2025; accessed 2026-11-14) describes the scheme:

1. **Assessment duty, when a breach is only suspected.** If an entity is aware of reasonable grounds to *suspect* that there may have been an eligible data breach, it must carry out a reasonable and expeditious assessment, and take all reasonable steps to complete it within 30 calendar days after becoming aware of those grounds. OAIC expects 30 days to be treated as a maximum and the assessment to be completed much sooner wherever possible, because the risk of serious harm often grows with time. If it cannot reasonably be finished in 30 days, document the steps taken, the reasons and that the assessment was reasonable and expeditious.
2. **Notification duty, once an eligible breach is established.** As soon as the entity has reasonable grounds to *believe* there has been an eligible data breach, whether part-way through an assessment or at its end, it must promptly prepare a statement for the Commissioner and notify the individuals at risk, as soon as practicable.

**Thirty days is not a grace period.** It is the outer limit for finishing an assessment of a suspicion. It never delays containment, it never delays notification once the belief is formed, and an assessment that reaches its conclusion on day 3 leads to notification then, not on day 30.

OAIC describes an eligible data breach as one where: there is unauthorised access to, unauthorised disclosure of, or loss of personal information the entity holds; this is likely to result in serious harm to one or more individuals; and the entity has not been able to prevent the likely risk of serious harm with remedial action. OAIC also notes that successful remedial action can mean notification is not required, which is one more reason to contain first. The statement to the Commissioner must include the entity's identity and contact details, a description of the breach, the kinds of information involved, and recommended steps for individuals. Use OAIC's current guidance and form at the time; do not rely on this summary.

Even where the scheme does not apply, tell affected customers and people when they need to act to protect themselves.

### 1.8 Afterwards

Root cause, fix, a regression test, an update to the threat model and control matrix, and a short written review. Record the incident and the decisions made, including a decision not to notify and its reasons.

## 2. Backup and restore procedure (database plus media references)

Purpose: prove that a database backup and a media backup taken together restore to a consistent state, where every `ready` media row has its file with the recorded size and SHA-256, and every publication's assets resolve.

The steps below are automated, with stricter checks, by `scripts/backup-restore-check.sh` (`npm run backup:verify`): it refuses to run while the API listens on port 4000, verifies every media item of every publication against the SHA-256 and size frozen in the immutable manifest (not only the media row; app items have no file and are only counted), checks that every thumbnail a media row names was restored as a non-empty file (no thumbnail hash is stored), and also checks that the restored database still hides rows from `tinnox_app` without an organisation context and still refuses a publication update. The manual commands remain as the reference procedure; the script is what was run.

Facts the procedure relies on:

- The host has no `psql`; database tools run inside the `postgres` container.
- Every tenant table has forced row-level security, so a dump must be taken by the PostgreSQL superuser (`postgres`). `pg_dump` run as `tinnox_app` or `tinnox_migrator` is expected to fail or omit rows. This is the database-administrator residual access recorded as T14.
- Media objects are at `<MEDIA_ROOT>/objects/<org uuid>/<object uuid>`; `media.storage_key` is `<org uuid>/<object uuid>`; `media.sha256` is lower-case hex.
- Roles (`tinnox_migrator`, `tinnox_app`, `tinnox_definer`) are cluster-level and are created by `infra/postgres/init/01-roles.sh`, not by the dump.
- Keycloak's development database is inside its container and is rebuilt from the realm import; it is not part of this backup. A hosted identity provider needs its own backup arrangement.

### 2.1 Take the backup

Run from the repository root. Keep backups outside the repository and outside `./data` (which `npm run reset` deletes).

```sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$HOME/tinnox-backups/$STAMP"
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
DC="docker compose --env-file .env -f infra/docker-compose.yml"

# 1. Stop writers so the database and the files agree (stop `npm run dev` and the media worker).

# 2. Database, custom format, as the superuser inside the container.
$DC exec -T postgres pg_dump -U postgres -d tinnox --format=custom > "$BACKUP_DIR/tinnox.dump"

# 3. Media objects (not the .tmp directory).
tar -C ./data/media -cf "$BACKUP_DIR/media-objects.tar" objects

# 4. Integrity record for the backup set itself.
( cd "$BACKUP_DIR" && shasum -a 256 tinnox.dump media-objects.tar > SHA256SUMS )

# 5. Record what was running.
git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt"
```

If `MEDIA_ROOT` in `.env` is not `./data/media`, use its value in step 3.

### 2.2 Restore into a scratch target (never over the working database)

```sh
RESTORE_ROOT="$BACKUP_DIR/restore-check"
mkdir -p "$RESTORE_ROOT"
( cd "$BACKUP_DIR" && shasum -a 256 -c SHA256SUMS )

# Database into a new database in the same cluster.
$DC exec -T postgres dropdb -U postgres --if-exists tinnox_restore
$DC exec -T postgres createdb -U postgres -O tinnox_migrator tinnox_restore
$DC exec -T postgres pg_restore -U postgres -d tinnox_restore --exit-on-error < "$BACKUP_DIR/tinnox.dump"

# Media into a scratch directory.
tar -C "$RESTORE_ROOT" -xf "$BACKUP_DIR/media-objects.tar"
```

### 2.3 Verify

```sh
# a. Row counts match the source for the main tables (run the same query against tinnox and tinnox_restore).
Q="SELECT 'organization', count(*) FROM organization UNION ALL SELECT 'display', count(*) FROM display
   UNION ALL SELECT 'media', count(*) FROM media UNION ALL SELECT 'playlist', count(*) FROM playlist
   UNION ALL SELECT 'publication', count(*) FROM publication UNION ALL SELECT 'publication_asset', count(*) FROM publication_asset
   UNION ALL SELECT 'audit_event', count(*) FROM audit_event ORDER BY 1"
$DC exec -T postgres psql -U postgres -d tinnox         -At -c "$Q" > "$RESTORE_ROOT/counts-source.txt"
$DC exec -T postgres psql -U postgres -d tinnox_restore -At -c "$Q" > "$RESTORE_ROOT/counts-restore.txt"
diff "$RESTORE_ROOT/counts-source.txt" "$RESTORE_ROOT/counts-restore.txt" && echo "counts match"

# b. Every ready media row has its file with the recorded hash and size.
$DC exec -T postgres psql -U postgres -d tinnox_restore -At -F ' ' \
  -c "SELECT sha256, storage_key, bytes FROM media WHERE status = 'ready' AND storage_key IS NOT NULL ORDER BY storage_key" \
  > "$RESTORE_ROOT/media-expected.txt"
FAIL=0
while read -r SHA KEY BYTES; do
  F="$RESTORE_ROOT/objects/$KEY"
  if [ ! -f "$F" ]; then echo "MISSING $KEY"; FAIL=1; continue; fi
  [ "$(shasum -a 256 "$F" | cut -d' ' -f1)" = "$SHA" ] || { echo "HASH MISMATCH $KEY"; FAIL=1; }
  [ "$(wc -c < "$F" | tr -d ' ')" = "$BYTES" ] || { echo "SIZE MISMATCH $KEY"; FAIL=1; }
done < "$RESTORE_ROOT/media-expected.txt"
echo "media check failures: $FAIL; rows checked: $(wc -l < "$RESTORE_ROOT/media-expected.txt")"

# c. Every publication asset points at a media row that is in the restored set (expect 0).
#    Adjust the column name if publication_asset differs from the handoff description.
$DC exec -T postgres psql -U postgres -d tinnox_restore -At \
  -c "SELECT count(*) FROM publication_asset pa LEFT JOIN media m ON m.id = pa.media_id AND m.org_id = pa.org_id WHERE m.id IS NULL"

# d. Controls survived the restore: forced row-level security and the immutability triggers.
$DC exec -T postgres psql -U postgres -d tinnox_restore -At \
  -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity"
$DC exec -T postgres psql -U postgres -d tinnox_restore -At \
  -c "SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2"
```

A fuller check, if time allows: point a second API instance at `tinnox_restore` and the restored media directory and play a publication end to end.

### 2.4 Clean up and record

```sh
$DC exec -T postgres dropdb -U postgres tinnox_restore
rm -rf "$RESTORE_ROOT"
```

| Field | Result of the run on 2026-11-14 (11:26 UTC) |
|---|---|
| Date and operator | 2026-11-14, integration step, local development machine (macOS 26.6.2, PostgreSQL 17.12 container). Data: the development database after a full end-to-end run (synthetic). |
| Command | `BACKUP_ROOT=<scratch directory> npm run backup:verify` with the API stopped (the default `BACKUP_ROOT` is `~/tinnox-backups`) |
| Git commit | `1d3f220` (the M0 code is uncommitted on `feat/prototype-m0`, so the commit does not identify the code) |
| Dump size; media archive size; number of media objects | 123,006 bytes; 193,536 bytes; 8 objects |
| Restore completed without error | Yes: `SHA256SUMS` verified, `pg_restore --exit-on-error` into the new database `tinnox_restore`, media into a new directory |
| Counts match (2.3 a) | Yes, 11 tables: organization 2, membership 2, display 7, player_registration 4, media 9, playlist 6, playlist_item 7, publication 8, publication_asset 18, display_delivery 5, audit_event 78 |
| Media rows checked; missing; hash mismatches; size mismatches (2.3 b) | 8 ready media rows; 0 missing; 0 hash mismatches; 0 size mismatches |
| Unresolved publication assets (2.3 c) | 18 manifest assets of 8 publications checked against the restored files (SHA-256 and size from the manifest): 0 missing, 0 mismatches; 0 manifest assets without a stored object; 0 `publication_asset` rows without media |
| Tables with forced row-level security; triggers present (2.3 d) | 17 of 17 data tables in `public` (all except the migration bookkeeping table); 10 triggers; 16 `sec` functions owned by `tinnox_definer`; `tinnox_app` sees 0 media rows with no organisation context; a publication update is refused |
| Time to back up; time to restore | under 1 s; about 1 s (small synthetic data set) |
| Deviations from this procedure | Restored into a new database in the same PostgreSQL cluster and a new directory, not onto a separate host or volume. The scratch database and directory were removed afterwards; the backup set was kept outside the repository. |

Re-run on 2026-11-14 at 12:48 UTC by the review-fix step, after migration 0004, with the API stopped: `RESULT: restore verified`. 11 table counts matched (organization 2, membership 2, display 28, player_registration 18, media 42, playlist 30, playlist_item 21, publication 33, publication_asset 72, display_delivery 20, audit_event 1,461); 39 ready media rows and 72 publication assets of 33 publications matched by SHA-256 and size, with nothing missing; 17 of 17 tables with forced row-level security, 12 triggers (including the publication-asset guard and the audit time stamp from 0004) and 17 `sec` functions owned by `tinnox_definer`; a publication update was refused. The new insert triggers did not hinder the restore, because `pg_restore` creates triggers after loading data. The backup set was deleted afterwards.

### 2.5 What this exercise does not establish

It is a manual, local, same-machine exercise. It does not establish scheduled backups, off-site or cross-region copies, encryption of backups, point-in-time recovery, recovery-time or recovery-point objectives, or identity-provider recovery. A backup holds every organisation's data and bypasses row-level security; treat backup access as administrator access. Deletion requests and retention limits must also reach backups (section 3).

## 3. Retention

Principles for M0 and for the design of a hosted service:

1. **Configurable.** Each period is a setting, not a constant in code.
2. **Justified.** Each period has a written reason: an operational need, a customer contract term, or a legal requirement identified by TINNOX's advisers. The older documents' proposals of 24 months and 7 years are proposals only; they are not treated as legal obligations (`docs/prototype-m0.md` section 9).
3. **Minimal.** Do not collect what is not needed; keep personal information out of telemetry and audit rows; delete or de-identify when the reason ends. (OAIC's APP 11 guidance describes a destroy-or-de-identify step for personal information that is no longer needed, where APP 11 applies.)

| Data | Personal information? | M0 behaviour (as built, checked 2026-11-14) | Proposed basis for a period | Decision |
|---|---|---|---|---|
| Sessions, login state | Operator identifier (and an ID token without names, for the provider's logout) | Expire by `SESSION_TTL_SECONDS` and idle timeout; the API runs `sessionPurgeExpired` hourly, which removes the stored ID token of every ended session and deletes rows a day after they end | Operational: no need beyond expiry | Engineering default |
| Pairing sessions and claim failures | Hashed client address | 10-minute life; the API runs `pairingPurge` hourly for rows older than 24 hours | Operational | Engineering default |
| Heartbeat log | None intended (device and publication identifiers, states, error codes) | Accepted reports only, at most one per display per 10 s; the hourly housekeeping deletes rows older than `LIMIT_HEARTBEAT_LOG_RETENTION_HOURS` (default 24) in every organisation (changed 2026-11-14; before, pruning depended on the player's `seq`) | Operational troubleshooting; a short window is enough | NEEDS TINNOX INPUT (period) |
| Audit events | Operator identifier | Append-only; no deletion path in M0 | Security investigation and customer accountability | NEEDS TINNOX INPUT (period, and who may purge) |
| Media | Possibly (people in images or video) | Soft delete (`deleted_at`); files referenced by a publication cannot be hard-deleted | Customer's choice while a customer; then contract term | NEEDS TINNOX INPUT |
| Publications | Indirectly (references media) | Immutable; no deletion for any role | Evidence of what was sent to a screen | NEEDS TINNOX INPUT; a migrator-run purge procedure must be designed |
| Organisation, membership | Operator identifier | No deletion path | Life of the customer relationship | NEEDS TINNOX INPUT; off-boarding procedure must be designed |
| Application logs | Addresses, request identifiers | Console only; nothing retained by the application | Short operational window | Decide with the hosting design |
| Identity-provider records | Names, usernames, credentials, events | Held by Keycloak; lost when the development container is removed | Provider configuration | Decide with the production provider |
| Backups | Everything above | None scheduled | Must not outlive the longest period above without reason | NEEDS TINNOX INPUT |
| Player cache | Media | Until replaced, reset or evicted; revocation does not erase an offline device | Operational | Documented limit |

Only the heartbeat-history period is a setting so far; the session and pairing periods are fixed in `sec` functions. Known gap: M0 cannot delete an organisation or a publication, and has no purge job for audit events or soft-deleted media files. These need a designed procedure before external use.

## 4. Data-location inventory

TINNOX prefers Australian hosting; that is a product requirement (D18, `docs/decisions-2026-11.md` DEC-13 as corrected). Two cautions: local development with synthetic data is **not** evidence of hosted data residency, and Australian hosting alone does not discharge privacy or security responsibilities.

The right-hand column describes an intended future deployment. **Nothing in it has been provisioned, reviewed or approved.** Each row needs a provider and data-flow review before use.

| Data | Local prototype now | Intended deployment (described only) |
|---|---|---|
| Application data (organisations, displays, playlists, publications, delivery state, audit) | PostgreSQL 17 container on the developer's machine, bound to 127.0.0.1; Docker volume `tinnox_pgdata`. Synthetic. | Managed PostgreSQL in AWS Asia Pacific (Sydney), `ap-southeast-2`, private subnets, encrypted at rest. |
| Media | Local filesystem under `MEDIA_ROOT` (`./data/media`), gitignored. Synthetic samples. | Private S3 bucket in Sydney behind the `packages/storage` interface; access by short-lived authorised URLs issued by the API; no public bucket. See the CDN note below. |
| Identity (accounts, credentials, MFA secrets, sign-in events) | Keycloak 26 container on the developer's machine; development realm; generated test users. | Not selected. Must be a reviewed provider or self-hosted service whose data location and administrative access are known; the OIDC integration is replaceable (D5). NEEDS TINNOX INPUT. |
| Logs | Process and container output on the developer's machine. | Log service in Sydney with defined retention and restricted access. Redaction (D16) applies before shipping. |
| Backups | None scheduled. The manual exercise (`npm run backup:verify`) writes to `BACKUP_ROOT`, default `~/tinnox-backups` (section 2). | Automated database backups and versioned media in Sydney, with **optional** copies in AWS Asia Pacific (Melbourne), `ap-southeast-4`. Same access restrictions as production; encryption keys held in Australia. |
| Analytics | None. No third-party analytics (D18). | None by default. Any product analytics needs a separate decision and data-flow review. |
| Error reporting | None. No external error-reporting service (D18). | None by default. If added, self-hosted or an Australian-region service after review; no request bodies, tokens or signed URLs. |
| Support access | None. No support impersonation or remote access feature exists. | Not designed. Before any is built: who may access customer data, from where (staff location matters as much as server location), with what approval and audit. NEEDS TINNOX INPUT. |
| Player cache | Browser storage (IndexedDB, Cache Storage) on the device running the player. | On the player device at the customer's site. |
| Vendor clouds (LED controller vendors) | Not used. | Excluded unless separately reviewed (`docs/decisions-2026-11.md` DEC-15). |

**Build-time services, separate from run-time data flows.** Development and CI download packages from the npm registry; container images from Docker Hub (`node`, `postgres`), quay.io (Keycloak) and ghcr.io (the gitleaks image used by `npm run scan:secrets`); Alpine Linux packages from the Alpine package repository while building the worker image (`ffmpeg`, pinned to `8.1.3-r0`; Alpine removes superseded builds, so the pin must be updated deliberately when it stops resolving); and Playwright's Chromium build from Playwright's download host (`npx playwright install chromium`). CI runs on GitHub Actions. Source code and synthetic test data pass through these services; no customer data should. They are not Australian-hosted and are not part of the residency requirement, but they are part of the supply-chain risk (threat model T13).

**Correction: CloudFront price classes.** An earlier decision record said media would be served through "CloudFront limited to the Australia price class". That is wrong. The CloudFront API reference lists the valid `PriceClass` values as `PriceClass_100`, `PriceClass_200`, `PriceClass_All` and `None`, and describes the field as the price class corresponding to the maximum price to pay for the service (AWS, *DistributionConfig*, accessed 2026-11-14). There is no Australia-only price class, and a price class is a pricing and edge-selection setting, not a data-residency control. M0 therefore starts with private local storage and a documented path to regional S3 delivery from Sydney. Any later CDN, or any offshore provider, needs its own data-flow review.

**On APP 8.** OAIC's chapter 8 describes APP 8 as a framework for cross-border *disclosure* of personal information, with accountability for the disclosing entity. It is not a general rule that Australian software must store all data in Australia. Whether a given provider arrangement is a disclosure, and what follows, is a question for TINNOX and its advisers.

## 5. Pre-customer-release checklist

These items gate use by an external customer. They do **not** gate completion of the local prototype.

Status values: **implemented** (exists in the build), **tested** (verified, with evidence in the control matrix), **deferred** (deliberately not in M0), **needs TINNOX input** (a decision or a named owner is required). The right-hand column was filled by the integration step after the test runs recorded in `docs/prototype-validation.md`.

| # | Item | What "done" means | Status as first written | Status after the integration step (2026-11-14) |
|---|---|---|---|---|
| 1 | Applicable obligations | TINNOX has determined, with advice, whether the Privacy Act, the APPs and the NDB scheme apply, plus customer contract terms and any sector or state requirements | needs TINNOX input | needs TINNOX input |
| 2 | Privacy notice and collection practices | A notice covering operator accounts, audit records and customer media; agreed handling of personal information in customer content | needs TINNOX input | needs TINNOX input |
| 3 | Retention | A period and reason for every row in section 3; purge and off-boarding procedures built and tested, including backups | needs TINNOX input (periods); deferred (procedures) | needs TINNOX input (periods); deferred (purge and off-boarding procedures do not exist) |
| 4 | Provider and location review | Every row of section 4 confirmed for the real deployment, including support-staff location and any sub-processors | needs TINNOX input; deferred | needs TINNOX input; deferred |
| 5 | Production identity and MFA | A reviewed identity provider; MFA enforced and verifiable by the API (for example through `acr` or `amr`); account recovery and administrator access defined; no development realm | deferred (design uses a local development provider; MFA not verifiable from claims) | deferred. Implemented and tested: production start-up refuses the development realm and requires `OIDC_MFA_ACR_VALUES` or `OIDC_MFA_AMR_VALUES` (`tests/integration/production-refusal.test.ts`). The development realm cannot prove MFA in claims |
| 6 | TLS | HTTPS everywhere outside loopback development; `Secure` cookies; HSTS; certificate management | deferred (production-mode refusal of HTTP is designed, D19) | deferred. Implemented and tested: production refusal of `http://` origins and issuer; `Secure` and `__Host-` cookies and HSTS when the portal origin is https (implemented, not exercised: no TLS set-up exists) |
| 7 | Infrastructure security | Network design, secret management, least-privilege access, patching, logging and alerting, encryption at rest, rate limiting at the edge; the edge sends `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` and `nosniff` for portal and player pages; `TRUST_PROXY` lists the edge proxies' addresses; the media job directory uses a group shared only by the API user and the worker uid (no world-readable or world-writable modes) | deferred | deferred. The page headers are sent by the local dev and preview servers only; `TRUST_PROXY=true` is refused at start-up (2026-11-14) |
| 8 | Restore testing | Section 2 executed with recorded results, then repeated on the real backup system on a schedule | deferred (procedure written, not executed) | tested once locally (section 2.4, 2026-11-14); deferred for the real backup system and a schedule |
| 9 | Incident ownership | Names in section 1.1; contact route; one rehearsal | needs TINNOX input | needs TINNOX input |
| 10 | Independent security review | Code review and penetration test by a party independent of the builders; findings tracked to closure | deferred | deferred |
| 11 | Application controls verified | Every row of `docs/security/control-matrix.md` section 1 has evidence; open exceptions accepted by a named owner | pending integration evidence | tested: every row of control-matrix section 1 has evidence (B12 partial: CI runs on every change, but its end-to-end job has not been run). Open exceptions still need acceptance by a named owner (needs TINNOX input) |
| 12 | Vulnerability handling | Disclosure contact, `security.txt`, dependency-update process operating, CI running on every change | deferred (process written in section 6; CI never executed) | deferred (process written; CI runs on every push and pull request, end-to-end job not yet run there; no disclosure contact) |
| 13 | Tenant off-boarding and deletion | Organisation deletion and data return designed and tested | deferred | deferred |
| 14 | Malicious-content scanning of uploads | Decision recorded: add scanning, or accept the exception | needs TINNOX input | needs TINNOX input (no scanning in M0; structural inspection only) |
| 15 | Hardware claims | No NovaStar, Huidu or kiosk compatibility claimed without the tests in `docs/hardware-next-step.md` | deferred | deferred (no hardware tested; no compatibility claimed) |

## 6. Dependency-update process

Tooling facts (from `docs/dev-handoff.md`): exact versions, committed `package-lock.json`, `npm ci` for installs; the lockfile must be changed with npm 11 (`npx npm@11.21.2 install <pkg>@<exact version> -w <workspace>`) because the host's npm 10.9.2 fails on `npm install`; container images are pinned by tag in `infra/docker-compose.yml`.

Routine, at least monthly, and whenever an advisory arrives:

1. `npm run audit` and review. High and critical findings in run-time dependencies are fixed or mitigated before the next release; anything left open is recorded in the table below with an owner and a review date. Do not use `npm audit fix --force`.
2. `npm outdated` to list available updates. Group them: security fixes first, then run-time, then development tooling.
3. Update one group at a time with exact versions. Read the changelog for anything touching authentication, sessions, parsing, multipart upload, image or video handling, the database driver or the web framework.
4. Review the lockfile diff: new transitive packages, changed registries or integrity hashes, new install scripts.
5. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm run audit`, `npm run scan:secrets`. All must pass; do not weaken a test to pass an upgrade.
6. Container images (PostgreSQL, Keycloak, gitleaks, the media-worker base image including ffprobe): check for new patch releases on the same schedule; change the tag in one commit; re-run `npm run verify:oidc` after a Keycloak change (import format and token claims can change) and the integration tests after a PostgreSQL change. Consider pinning by digest.
7. Node.js: stay on a supported release line within `engines`; CI uses Node 22.
8. Merge through a reviewed pull request with CI green.

Urgent path: for an actively exploited vulnerability in a run-time dependency, do steps 3 to 5 for that package alone the same day, or apply a mitigation (disable the affected feature) and record it.

Open exceptions (keep current):

| Finding | Where | Severity | Why open | Owner | Review by |
|---|---|---|---|---|---|
| `minimatch` advisory inside the typescript-eslint toolchain (7 moderate findings, as reported by the foundation step on 2026-11-14; not re-run by the author) | Development only | Moderate | Awaiting upstream release; not in run-time code | _to be named_ | _to be set_ |
| Host Node 23.10 is outside the supported engine ranges of eslint 10 and vitest 5 | Development machine | Low | CI uses Node 22 | _to be named_ | _to be set_ |

Not in place: automated update pull requests, a software bill of materials, licence checks, static analysis, image scanning. Add these before external release (checklist items 7 and 12).
