// Decides whether `npm audit` results pass the CI gate (scripts/audit.ts).
// High and critical advisories block, except an advisory listed in scripts/audit-exceptions.json
// with an owner, a reason and a review date. An exception:
//   - applies to development dependencies only: any high or critical advisory reported by
//     `npm audit --omit=dev` blocks, listed or not;
//   - holds until the end of its review date (UTC), and may be set at most 90 days ahead;
//   - must still match a reported advisory, so a fixed one is removed from the list.

export interface AuditException {
  id: string;
  package: string;
  reason: string;
  owner: string;
  reviewBy: string;
}

export interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
  url: string;
}

export interface AuditVerdict {
  blocking: string[];
  allowed: string[];
  counts: Record<string, number>;
}

const BLOCKING = new Set(['high', 'critical']);
const MAX_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AuditVia {
  source?: number;
  name?: string;
  severity?: string;
  title?: string;
  url?: string;
}

interface AuditReport {
  error?: unknown;
  vulnerabilities?: Record<string, { via?: (string | AuditVia)[] }>;
  metadata?: { vulnerabilities?: Record<string, number> };
}

/** The distinct advisories in an `npm audit --json` report (npm 7 and later). */
export function advisories(report: unknown): Advisory[] {
  const parsed = report as AuditReport;
  if (parsed === null || typeof parsed !== 'object' || parsed.error !== undefined) {
    throw new Error(`npm audit did not return a report: ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  if (parsed.vulnerabilities === undefined) {
    throw new Error('npm audit report has no "vulnerabilities" object (npm 7 or later needed)');
  }
  const found = new Map<string, Advisory>();
  for (const vulnerability of Object.values(parsed.vulnerabilities)) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === 'string') continue;
      const url = via.url ?? '';
      const id = /GHSA(-[0-9a-z]{4}){3}/i.exec(url)?.[0] ?? String(via.source ?? url);
      const pkg = via.name ?? '';
      found.set(`${id} ${pkg}`, {
        id,
        package: pkg,
        severity: via.severity ?? 'unknown',
        title: via.title ?? '',
        url,
      });
    }
  }
  return [...found.values()];
}

function parseDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value
    ? undefined
    : time;
}

function describe(a: Advisory): string {
  return `${a.severity} ${a.package} ${a.id}: ${a.title} (${a.url})`;
}

/**
 * @param full `npm audit --json`
 * @param runtime `npm audit --omit=dev --json`
 * @param today YYYY-MM-DD in UTC
 */
export function evaluate(
  full: unknown,
  runtime: unknown,
  exceptions: AuditException[],
  today: string,
): AuditVerdict {
  const blocking: string[] = [];
  const allowed: string[] = [];
  const todayTime = parseDay(today);
  if (todayTime === undefined) throw new Error(`today must be YYYY-MM-DD, got "${today}"`);

  const valid: AuditException[] = [];
  const seen = new Set<string>();
  for (const e of exceptions) {
    const label = `audit exception ${e.id || '(no id)'}`;
    const reviewTime = parseDay(e.reviewBy);
    if (!/^GHSA(-[0-9a-z]{4}){3}$/.test(e.id)) {
      blocking.push(`${label}: id must be a GHSA id such as GHSA-xxxx-xxxx-xxxx`);
    } else if (!e.package || !e.reason?.trim() || !e.owner?.trim()) {
      blocking.push(`${label}: package, reason and owner are required`);
    } else if (reviewTime === undefined) {
      blocking.push(`${label}: reviewBy must be a date as YYYY-MM-DD, got "${e.reviewBy}"`);
    } else if (seen.has(`${e.id} ${e.package}`)) {
      blocking.push(`${label}: listed twice for ${e.package}`);
    } else if (reviewTime < todayTime) {
      blocking.push(
        `${label} (${e.package}) passed its review date ${e.reviewBy}: upgrade, or renew it with a new date in scripts/audit-exceptions.json and docs/security/operations-and-release-checklist.md section 6`,
      );
    } else if (reviewTime - todayTime > MAX_WINDOW_DAYS * DAY_MS) {
      blocking.push(
        `${label} (${e.package}): reviewBy ${e.reviewBy} is more than ${MAX_WINDOW_DAYS} days ahead`,
      );
    } else {
      valid.push(e);
    }
    seen.add(`${e.id} ${e.package}`);
  }

  for (const a of advisories(runtime)) {
    if (BLOCKING.has(a.severity)) {
      blocking.push(`run-time dependency: ${describe(a)} (exceptions never apply here)`);
    }
  }

  const reported = advisories(full);
  for (const a of reported) {
    if (!BLOCKING.has(a.severity)) continue;
    const exception = valid.find((e) => e.id === a.id && e.package === a.package);
    if (exception === undefined) {
      blocking.push(describe(a));
    } else {
      allowed.push(
        `${describe(a)}; allowed until ${exception.reviewBy}, owner ${exception.owner}: ${exception.reason}`,
      );
    }
  }

  for (const e of valid) {
    if (!reported.some((a) => a.id === e.id && a.package === e.package)) {
      blocking.push(
        `audit exception ${e.id} (${e.package}) no longer matches a reported advisory: remove it from scripts/audit-exceptions.json and section 6`,
      );
    }
  }

  const counts = (full as AuditReport).metadata?.vulnerabilities ?? {};
  return { blocking, allowed, counts };
}
