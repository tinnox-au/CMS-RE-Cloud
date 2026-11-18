import { describe, expect, it } from 'vitest';
import { type AuditException, advisories, evaluate } from './audit-check.ts';

function advisory(name: string, ghsa: string, severity: string) {
  return {
    source: 1,
    name,
    dependency: name,
    title: `${name} issue`,
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    range: '<=4.0.7',
  };
}

function report(...vias: ReturnType<typeof advisory>[]) {
  const vulnerabilities: Record<string, unknown> = {};
  for (const via of vias) {
    vulnerabilities[via.name] = { name: via.name, severity: via.severity, via: [via] };
    // A package that is affected only through the advisory above, as npm reports it.
    vulnerabilities[`uses-${via.name}`] = { severity: via.severity, via: [via.name] };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {} } };
}

const empty = report();
const picomatch = advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high');
const exception: AuditException = {
  id: 'GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  reason: 'no fixed release; development tooling only',
  owner: 'Michael Fu',
  reviewBy: '2026-12-18',
};

describe('advisories', () => {
  it('lists each advisory once and skips packages affected only through another', () => {
    const found = advisories(
      report(picomatch, advisory('minimatch', 'GHSA-g3hv-75wg-m249', 'moderate')),
    );
    expect(found.map((a) => `${a.package} ${a.id} ${a.severity}`)).toEqual([
      'picomatch GHSA-fc5q-39xc-vjpf high',
      'minimatch GHSA-g3hv-75wg-m249 moderate',
    ]);
  });

  it('refuses an error report, such as no network', () => {
    expect(() => advisories({ error: { code: 'ENOTFOUND' } })).toThrow(/did not return a report/);
  });
});

describe('evaluate', () => {
  it('passes a listed development-only advisory before its review date', () => {
    const verdict = evaluate(report(picomatch), empty, [exception], '2026-11-18');
    expect(verdict.blocking).toEqual([]);
    expect(verdict.allowed).toHaveLength(1);
  });

  it('still passes on the review date itself', () => {
    expect(evaluate(report(picomatch), empty, [exception], '2026-12-18').blocking).toEqual([]);
  });

  it('blocks once the review date has passed', () => {
    const { blocking } = evaluate(report(picomatch), empty, [exception], '2026-12-19');
    expect(blocking.join('\n')).toMatch(/passed its review date 2026-12-18/);
    expect(blocking.join('\n')).toMatch(/high picomatch GHSA-fc5q-39xc-vjpf/);
  });

  it('blocks any other high or critical advisory', () => {
    const other = advisory('vite', 'GHSA-aaaa-bbbb-cccc', 'critical');
    const { blocking } = evaluate(report(picomatch, other), empty, [exception], '2026-11-18');
    expect(blocking).toEqual([expect.stringMatching(/^critical vite GHSA-aaaa-bbbb-cccc/)]);
  });

  it('does not block moderate or low advisories', () => {
    const moderate = advisory('minimatch', 'GHSA-g3hv-75wg-m249', 'moderate');
    expect(evaluate(report(moderate), empty, [], '2026-11-18').blocking).toEqual([]);
  });

  it('never applies an exception to run-time dependencies', () => {
    const { blocking } = evaluate(report(picomatch), report(picomatch), [exception], '2026-11-18');
    expect(blocking).toEqual([expect.stringMatching(/^run-time dependency: high picomatch/)]);
  });

  it('matches the package as well as the advisory id', () => {
    const elsewhere = { ...exception, package: 'micromatch' };
    const { blocking } = evaluate(report(picomatch), empty, [elsewhere], '2026-11-18');
    expect(blocking.join('\n')).toMatch(/high picomatch GHSA-fc5q-39xc-vjpf/);
  });

  it('blocks an exception that no longer matches a reported advisory', () => {
    const { blocking } = evaluate(empty, empty, [exception], '2026-11-18');
    expect(blocking).toEqual([expect.stringMatching(/no longer matches a reported advisory/)]);
  });

  it('blocks a review date more than 90 days ahead', () => {
    const far = { ...exception, reviewBy: '2027-03-01' };
    const { blocking } = evaluate(report(picomatch), empty, [far], '2026-11-18');
    expect(blocking.join('\n')).toMatch(/more than 90 days ahead/);
  });

  it('blocks incomplete or malformed exceptions', () => {
    const cases: AuditException[] = [
      { ...exception, id: 'CVE-2026-1' },
      { ...exception, owner: ' ' },
      { ...exception, reason: '' },
      { ...exception, reviewBy: '2026-02-30' },
      { ...exception, reviewBy: '18 Dec 2026' },
    ];
    for (const bad of cases) {
      const { blocking } = evaluate(report(picomatch), empty, [bad], '2026-11-18');
      expect(blocking.length, JSON.stringify(bad)).toBeGreaterThanOrEqual(2);
    }
  });
});
