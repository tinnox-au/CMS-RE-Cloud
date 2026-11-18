// The CI dependency audit: fails on high or critical advisories, apart from the dated
// development-only exceptions in scripts/audit-exceptions.json (rules in scripts/lib/audit-check.ts).
// Lower-severity findings are printed and tracked in docs/security/operations-and-release-checklist.md
// section 6.
//   npm run audit
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AuditException, evaluate } from './lib/audit-check.ts';
import { repoRoot } from './lib/env.ts';

function npmAudit(extra: string[]): unknown {
  const result = spawnSync('npm', ['audit', '--json', ...extra], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  // npm audit exits 1 whenever it finds anything; the JSON report decides.
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`npm audit ${extra.join(' ')} gave no JSON report:\n${result.stderr}`);
  }
}

const exceptions = JSON.parse(
  readFileSync(join(repoRoot, 'scripts', 'audit-exceptions.json'), 'utf8'),
) as { exceptions: AuditException[] };

const verdict = evaluate(
  npmAudit([]),
  npmAudit(['--omit=dev']),
  exceptions.exceptions,
  new Date().toISOString().slice(0, 10),
);

const counts = Object.entries(verdict.counts)
  .filter(([severity, n]) => severity !== 'total' && n > 0)
  .map(([severity, n]) => `${n} ${severity}`);
console.log(
  `npm audit: ${counts.join(', ') || 'no findings'} (packages affected, all dependencies)`,
);
for (const line of verdict.allowed) console.log(`allowed by exception: ${line}`);
for (const line of verdict.blocking) console.error(`BLOCKING: ${line}`);
if (verdict.blocking.length > 0) process.exit(1);
console.log('audit passed: no high or critical advisory outside the dated exceptions');
