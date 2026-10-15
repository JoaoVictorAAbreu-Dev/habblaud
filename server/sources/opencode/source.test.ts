import { describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { OpenCodeSource } from './source';

function fixture() {
  const accounts = new AccountsService({ dirs: [], home: '/tmp', env: {}, onChange: () => undefined });
  const office = new Office({ names: new NameStore(null), version: 'test', startedAt: 0,
    accounts: (sessions) => accounts.list(sessions), sources: () => [], accountName: () => undefined });
  return { accounts, office };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OpenCodeSource (v2)', () => {
  it('shows only process-owned active sessions, keeps their project and closes them when inactive', async () => {
    const { accounts, office } = fixture();
    let active = true;
    const paths: string[] = [];
    const request: typeof fetch = async (input, init) => {
      paths.push(String(input));
      expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('opencode:secret').toString('base64')}`);
      if (String(input).endsWith('/api/session/active')) return json({ data: active ? { ses_123: { status: 'busy' } } : {} });
      if (String(input).endsWith('/api/session/ses_123')) return json({ data: {
        id: 'ses_123', title: 'Trabalhando no fork', time: { created: 1000 },
        location: { directory: '/work/habblaud' },
      } });
      throw new Error('unexpected URL');
    };
    const source = new OpenCodeSource({ url: 'http://127.0.0.1:4767', password: 'secret', accounts, office, fetch: request, pollMs: 60_000 });
    await source.start();
    expect(source.sources()).toMatchObject([{ provider: 'opencode', sessions: 1, ok: true }]);
    expect(office.get('.opencode:ses_123')).toMatchObject({ provider: 'opencode', status: 'working', roomId: '/work/habblaud' });
    active = false;
    await source.poll();
    expect(source.sources()).toMatchObject([{ sessions: 0, ok: true }]);
    expect(office.get('.opencode:ses_123')?.status).toBe('offline');
    expect(paths).toEqual([
      'http://127.0.0.1:4767/api/session/active',
      'http://127.0.0.1:4767/api/session/ses_123',
      'http://127.0.0.1:4767/api/session/active',
    ]);
    source.stop();
  });

  it('reports authentication failure without exposing the password or retaining stale presence', async () => {
    const { accounts, office } = fixture();
    const source = new OpenCodeSource({ url: 'http://127.0.0.1:4767', password: 'secret', accounts, office,
      fetch: async () => json({ error: 'no' }, 401), pollMs: 60_000 });
    await source.start();
    expect(source.sources()).toMatchObject([{ ok: false, sessions: 0, error: 'autenticação recusada' }]);
    expect(JSON.stringify(source.sources())).not.toContain('secret');
    source.stop();
  });
});
