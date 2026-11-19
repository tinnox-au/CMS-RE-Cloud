import { describe, expect, it } from 'vitest';
import { keycloakDirectory } from './idp.ts';
import { UsageError, parseInvocation } from './provision.ts';

const INVITE = '3f9a12c4-1111-4222-8333-444455556666';
const MEMBER = '0b7e1a2c-aaaa-4bbb-8ccc-dddddddddddd';

function usage(argv: string[]): string {
  try {
    parseInvocation(argv);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return (error as Error).message;
  }
  throw new Error(`accepted: ${argv.join(' ')}`);
}

describe('provision-member arguments', () => {
  it('parses every command', () => {
    expect(parseInvocation(['pending', '--executed-by', 'sam.staff'])).toEqual({
      command: 'pending',
      args: { executedBy: 'sam.staff' },
    });
    expect(
      parseInvocation([
        'fulfil',
        INVITE,
        '--username',
        'alex',
        '--confirmed-with',
        'TICKET-12',
        '--executed-by',
        'sam',
      ]),
    ).toEqual({
      command: 'fulfil',
      args: { inviteId: INVITE, username: 'alex', confirmedWith: 'TICKET-12', executedBy: 'sam' },
    });
    expect(
      parseInvocation([
        'org-create',
        '--org-name',
        ' Example Signage ',
        '--timezone',
        'Australia/Sydney',
        '--owner',
        'alex=Alex Example',
        '--owner',
        'kim=Kim Sample',
        '--request-ref',
        'REQ-1',
        '--executed-by',
        'sam',
      ]),
    ).toEqual({
      command: 'org-create',
      args: {
        orgName: 'Example Signage',
        timezone: 'Australia/Sydney',
        siteName: 'Main site',
        owners: [
          { username: 'alex', name: 'Alex Example' },
          { username: 'kim', name: 'Kim Sample' },
        ],
        requestRef: 'REQ-1',
        executedBy: 'sam',
      },
    });
    expect(
      parseInvocation([
        'set-name',
        '--membership',
        MEMBER,
        '--name',
        'Alex Example',
        '--request-ref',
        'REQ-2',
        '--executed-by',
        'sam',
      ]).args,
    ).toEqual({
      target: { membershipId: MEMBER },
      name: 'Alex Example',
      requestRef: 'REQ-2',
      executedBy: 'sam',
    });
    expect(
      parseInvocation([
        'mfa-reset',
        '--username',
        'alex',
        '--request-ref',
        'REQ-3',
        '--executed-by',
        'sam',
      ]).args,
    ).toEqual({ username: 'alex', requestRef: 'REQ-3', executedBy: 'sam', confirmedWith: null });
    const approval = ['--request-ref', 'REQ-4', '--executed-by', 'sam', '--approved-by', 'lee'];
    expect(parseInvocation(['restore-owner', ...approval, '--promote', MEMBER]).args).toEqual({
      requestRef: 'REQ-4',
      executedBy: 'sam',
      approvedBy: 'lee',
      mode: 'promote',
      membershipId: MEMBER,
    });
    expect(
      parseInvocation([
        'restore-owner',
        ...approval,
        '--successor',
        'kim=Kim Sample',
        '--replaces',
        MEMBER,
      ]).args,
    ).toMatchObject({ mode: 'successor', successor: { username: 'kim', name: 'Kim Sample' } });
  });

  it('refuses a staff id that is not a plain id', () => {
    for (const id of ['sam@example.com', 'sam staff', 'Sam', 's', '1sam', 'x'.repeat(41)]) {
      expect(usage(['pending', '--executed-by', id])).toMatch(/--executed-by/);
    }
    expect(usage(['pending'])).toBe('--executed-by is required');
  });

  it('refuses a reference with an "@" or a space, or over 64 characters', () => {
    const base = ['mfa-reset', '--username', 'alex', '--executed-by', 'sam', '--request-ref'];
    expect(parseInvocation([...base, 'ticket:42/a_b.c-d']).command).toBe('mfa-reset');
    for (const ref of ['alex@example.com', 'REQ 1', 'R'.repeat(65), '']) {
      expect(usage([...base, ref])).toMatch(/--request-ref/);
    }
    expect(
      usage([...base.slice(0, -1), '--request-ref', 'REQ-1', '--confirmed-with', 'a b']),
    ).toMatch(/--confirmed-with/);
  });

  it('refuses a name the API would refuse', () => {
    const base = ['set-name', '--username', 'alex', '--request-ref', 'R', '--executed-by', 'sam'];
    for (const name of ['', '   ', 'x'.repeat(121), 'Alex\u0007', 'Alex\u202eExample']) {
      expect(usage([...base, '--name', name])).toMatch(/--name/);
    }
    expect(usage(['set-name', '--membership', MEMBER, ...base.slice(1), '--name', 'A'])).toMatch(
      /exactly one/,
    );
  });

  it('refuses equal --executed-by and --approved-by', () => {
    expect(
      usage([
        'restore-owner',
        '--request-ref',
        'REQ-4',
        '--executed-by',
        'sam',
        '--approved-by',
        'sam',
        '--promote',
        MEMBER,
      ]),
    ).toMatch(/second person/);
  });

  it('refuses an unknown command, an unknown option and a misplaced one', () => {
    expect(usage([])).toBe('name a command');
    expect(usage(['delete-everything', '--executed-by', 'sam'])).toMatch(/unknown command/);
    expect(usage(['--executed-by', 'sam'])).toMatch(/unknown command/);
    expect(usage(['pending', '--executed-by', 'sam', '--force'])).toMatch(/--force/);
    // --approved-by belongs to restore-owner only.
    expect(usage(['pending', '--executed-by', 'sam', '--approved-by', 'lee'])).toMatch(
      /--approved-by/,
    );
    expect(usage(['pending', 'extra', '--executed-by', 'sam'])).toMatch(/positional/);
  });

  it('checks ids, owners, time zones and the restore-owner modes', () => {
    const fulfil = ['--username', 'alex', '--confirmed-with', 'T', '--executed-by', 'sam'];
    expect(usage(['fulfil', ...fulfil])).toMatch(/one invite id/);
    expect(usage(['fulfil', INVITE.toUpperCase(), ...fulfil])).toMatch(/lower-case UUID/);
    const org = ['org-create', '--org-name', 'Org', '--request-ref', 'R', '--executed-by', 'sam'];
    expect(usage([...org, '--timezone', 'Australia/Sydney'])).toMatch(/one or two --owner/);
    expect(usage([...org, '--timezone', 'Mars/Olympus', '--owner', 'a=A'])).toMatch(/--timezone/);
    expect(usage([...org, '--timezone', 'UTC', '--owner', 'alex'])).toMatch(/<username>=<name>/);
    const three = ['--owner', 'a=A', '--owner', 'b=B', '--owner', 'c=C'];
    expect(usage([...org, '--timezone', 'UTC', ...three])).toMatch(/one or two/);
    expect(usage([...org, '--timezone', 'UTC', '--owner', 'a=A', '--owner', 'A=B'])).toMatch(
      /usernames/,
    );
    expect(usage([...org, '--timezone', 'UTC', '--owner', 'a=Kim', '--owner', 'b=KIM'])).toMatch(
      /names/,
    );
    const approval = ['--request-ref', 'R', '--executed-by', 'sam', '--approved-by', 'lee'];
    expect(usage(['restore-owner', ...approval])).toMatch(/either --promote/);
    expect(
      usage(['restore-owner', ...approval, '--promote', MEMBER, '--replaces', MEMBER]),
    ).toMatch(/either --promote/);
    expect(usage(['restore-owner', ...approval, '--successor', 'kim=Kim'])).toMatch(
      /either --promote/,
    );
  });
});

describe('the identity-provider reader', () => {
  const options = { clientId: 'tinnox-provisioning', clientSecret: 'reader-secret' };

  it('reads exactly one account by username with a client_credentials token', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fake: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      return Promise.resolve(
        url.endsWith('/token')
          ? Response.json({ access_token: 'reader-token' })
          : Response.json([
              { id: 'sub-alex', username: 'alex', email: 'alex@example.com', enabled: true },
              { id: 'sub-alexis', username: 'alexis', email: 'alexis@example.com', enabled: false },
            ]),
      );
    };
    const idp = keycloakDirectory({
      ...options,
      issuer: 'http://localhost:8080/realms/tinnox-dev',
      fetch: fake,
    });
    expect(await idp.findByUsername('Alex')).toEqual({
      subject: 'sub-alex',
      email: 'alex@example.com',
      enabled: true,
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://localhost:8080/realms/tinnox-dev/protocol/openid-connect/token',
      'http://localhost:8080/admin/realms/tinnox-dev/users?username=Alex&exact=true',
    ]);
    expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer reader-token');
    // The search answers prefixes too; only an exact username counts.
    expect(await idp.findByUsername('ale')).toBeNull();
  });

  it('refuses an issuer that would send the secret in clear text to another machine', () => {
    expect(() =>
      keycloakDirectory({ ...options, issuer: 'http://idp.example.com/realms/tinnox' }),
    ).toThrow(/https/);
    expect(() => keycloakDirectory({ ...options, issuer: 'https://idp.example.com/' })).toThrow(
      /realm URL/,
    );
  });
});
