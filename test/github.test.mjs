import test from 'node:test';
import assert from 'node:assert/strict';
import { Github, GhError, condition, parseRepo, PathIndex, scoreNeighbours } from '../public/js/github.js';
import { res, fakeFetch } from './helpers.mjs';

const gh = (answer, opts = {}) => new Github({ fetch: fakeFetch(answer), retryMs: 1, ...opts });

test('condition comes from the last push, and an archived repo is a wreck', () => {
  const day = 86400, t = 1_800_000_000;
  assert.equal(condition({ pushedAt: t - 10 * day }, t), 'sailing');
  assert.equal(condition({ pushedAt: t - 91 * day }, t), 'anchored');
  assert.equal(condition({ pushedAt: t - 366 * day }, t), 'derelict');
  assert.equal(condition({ pushedAt: t, archived: true }, t), 'wreck');
  assert.equal(condition({ pushedAt: 0 }, t), 'derelict');
});

test('a repo is read, a strange one refused, and the flag can only come from GitHub', () => {
  const r = parseRepo({ id: 7, name: 'mast', owner: { login: 'deck', avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4' }, description: null, stargazers_count: 12, language: 'Rust', pushed_at: '2025-01-02T03:04:05Z', archived: false, fork: true, open_issues_count: 3, default_branch: 'trunk', parent: { full_name: 'keel/mast' }, permissions: { admin: false, push: true, triage: true }, has_discussions: true });
  assert.deepEqual([r.stars, r.language, r.defaultBranch, r.fork, r.description], [12, 'Rust', 'trunk', true, '']);
  assert.equal(r.parent, 'keel/mast');
  assert.deepEqual(r.can, { admin: false, push: true, triage: true });
  assert.equal(parseRepo({ name: '../x', owner: { login: 'deck' } }), null);
  assert.equal(parseRepo({ name: 'x', owner: { login: 'deck', avatar_url: 'https://evil.example/a.png' } }).avatar, '');
  assert.deepEqual(parseRepo({ name: 'x', owner: { login: 'd' } }).can, { admin: false, push: false, triage: false });
});

test('issues name the files they touch', () => {
  const idx = new PathIndex(['src/main.rs', 'src/net/http.rs', 'docs/http.rs', 'README.md', 'Cargo.toml']);
  assert.deepEqual(idx.filesIn('crash in `src/main.rs:42` when run'), ['src/main.rs']);
  assert.deepEqual(idx.filesIn('see README.md.'), ['README.md']);
  assert.deepEqual(idx.filesIn('diff a/src/main.rs b/src/main.rs'), ['src/main.rs']);
  assert.deepEqual(idx.filesIn('net/http.rs is wrong'), ['src/net/http.rs']);
  assert.deepEqual(idx.filesIn('http.rs is wrong'), [], 'two files are called that, so a bare name guesses nothing');
  assert.deepEqual(idx.filesIn('Cargo.toml is odd'), ['Cargo.toml']);
  assert.deepEqual(idx.filesIn('version 1.2.3 and example.com'), []);
});

const person = (login, total, stars) => ({ login, total, stars: stars.map(([name, n]) => ({ name, stars: n, language: 'Rust', pushedAt: 0, archived: false })) });

test('neighbours are what the same people starred, less the popular and less the thinly backed', () => {
  const people = [
    person('a', 30, [['deck/mast', 100], ['big/hype', 50000], ['small/kin', 200], ['one/off', 40]]),
    person('b', 30, [['big/hype', 50000], ['small/kin', 200], ['deck/mast', 100]]),
    person('c', 30, [['big/hype', 50000], ['small/kin', 200], ['other/kin', 150]]),
    person('d', 30, [['big/hype', 50000], ['other/kin', 150]]),
    person('e', 4000, [['big/hype', 50000], ['small/kin', 200], ['other/kin', 150]]),
  ];
  const found = scoreNeighbours('deck/mast', people, 10);
  const names = found.map((f) => f.name);
  assert.equal(names[0], 'small/kin', 'a small repo most of them starred beats the one everyone starred');
  assert.ok(names.includes('big/hype') && !names.includes('one/off') && !names.includes('deck/mast'));
  assert.deepEqual([found[0].shared, found[0].stars], [4, 200]);
  const weighted = (total) => scoreNeighbours('x/y', [person('p', total, [['a/b', 10]]), person('q', 10, [['a/b', 10]])], 5)[0].score;
  assert.ok(weighted(4000) < weighted(10), 'someone who starred 4000 things says less');
  assert.deepEqual(scoreNeighbours('x/y', [], 5), []);
  assert.equal(scoreNeighbours('x/y', [person('p', 5, [['a/b', 1], ['A/B', 1]]), person('q', 5, [['a/b', 1]])], 5)[0].shared, 2, 'the same repo twice counts once');
});

test('a request carries the token, the version and the right headers; the limit is shown', async () => {
  const f = fakeFetch(() => res(200, { id: 1, name: 'mast', owner: { login: 'deck' } }, { 'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60' }));
  const g = new Github({ fetch: f, token: 'tok123456' });
  await g.repo('deck', 'mast');
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/deck/mast');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer tok123456');
  assert.equal(f.calls[0].headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(g.rateLine(), '59 of 60 requests left this hour');
  await assert.rejects(g.repo('../x', 'mast'), (e) => e.kind === 'notfound');
  assert.equal(f.calls.length, 1, 'a bad name is refused before anything is sent');
});

test('not found, other failures and the limit are told, and the limit is remembered', async () => {
  await assert.rejects(gh(() => res(404, '{}')).repo('deck', 'mast'), (e) => e.kind === 'notfound');
  await assert.rejects(gh(() => res(500, { message: 'boom' })).repo('deck', 'mast'), (e) => e.kind === 'status' && e.message === 'GitHub said 500: boom');
  await assert.rejects(gh(() => res(401, '{}')).repo('deck', 'mast'), (e) => e.kind === 'token');
  let calls = 0;
  const g = gh(() => { calls++; return res(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 120) }); });
  await assert.rejects(g.repo('deck', 'mast'), (e) => e.kind === 'limited' && e.seconds >= 100);
  await assert.rejects(g.repo('deck', 'mast'), (e) => e.kind === 'limited');
  assert.equal(calls, 1, 'once told to wait, nothing more is sent');
  await assert.rejects(gh(() => res(403, { message: 'Repository access blocked' })).repo('deck', 'mast'), (e) => e.kind === 'status');
});

test('a request that gets no answer is tried once more', async () => {
  let n = 0;
  const g = new Github({ retryMs: 1, fetch: async () => { if (++n === 1) throw new TypeError('Failed to fetch'); return res(200, { id: 1, name: 'mast', owner: { login: 'deck' } }); } });
  assert.ok(await g.repo('deck', 'mast'));
  assert.equal(n, 2);
  const down = new Github({ retryMs: 1, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(down.repo('deck', 'mast'), (e) => e.kind === 'net' && /try again/.test(e.message));
});

test('searches wait their turn: ten a minute without a token, thirty with one', async () => {
  let t = 1_000_000;
  const mk = (token) => new Github({ token, now: () => t, fetch: async () => res(200, { items: [{ id: 1, name: 'mast', owner: { login: 'deck' }, stargazers_count: 5 }] }) });
  const g = mk('');
  for (let i = 0; i < 10; i++) assert.equal((await g.search('boats')).length, 1);
  assert.ok(g.searchWait() > 50);
  await assert.rejects(g.search('boats'), (e) => e.kind === 'limited');
  t += 61000;
  assert.equal(g.searchWait(), 0);
  const k = mk('tok');
  for (let i = 0; i < 30; i++) await k.search('boats');
  assert.ok(k.searchWait() > 0);
});

test('a tree too big for one call is read folder by folder', async () => {
  const g = gh((url) => {
    if (url.endsWith('?recursive=1')) return res(200, { truncated: true, tree: [] });
    if (url.endsWith('/trunk')) return res(200, { tree: [{ type: 'blob', path: 'README.md', size: 10 }, { type: 'tree', path: 'src', sha: 'aaa111' }, { type: 'commit', path: 'vendor', sha: 'bbb222' }] });
    if (url.endsWith('/aaa111')) return res(200, { tree: [{ type: 'blob', path: 'main.rs', size: 500 }, { type: 'tree', path: 'deep', sha: 'ccc333' }] });
    return res(200, { tree: [{ type: 'blob', path: 'x.rs', size: 7 }] });
  });
  const t = await g.tree('deck', 'mast', 'trunk');
  assert.deepEqual(t.files.map((f) => f[0]).sort(), ['README.md', 'src/deep/x.rs', 'src/main.rs']);
  assert.ok(t.partial);
  const whole = await gh(() => res(200, { truncated: false, tree: [{ type: 'blob', path: 'a.rs', size: 1 }] })).tree('deck', 'mast', 'trunk');
  assert.deepEqual([whole.files.length, whole.partial], [1, null]);
});

test('issues skip pull requests, say there are more, and checks name the failures', async () => {
  const g = gh((url) => url.includes('/issues')
    ? res(200, [{ number: 1, title: 'leak in src/a.rs', body: null, user: { login: 'gull' }, created_at: '2025-05-01T00:00:00Z', comments: 3, labels: [{ name: 'bug' }] }, { number: 2, title: 'a pull', pull_request: {} }], { link: '<https://api.github.com/x?page=2>; rel="next"' })
    : res(200, { total_count: 3, check_runs: [{ name: 'build', conclusion: 'success' }, { name: 'test', conclusion: 'failure' }, { name: 'lint', conclusion: 'timed_out' }] }));
  const { issues, more } = await g.issues('deck', 'mast', new PathIndex(['src/a.rs']));
  assert.ok(more);
  assert.equal(issues.length, 1);
  assert.deepEqual([issues[0].files, issues[0].author, issues[0].comments, issues[0].labels], [['src/a.rs'], 'gull', 3, ['bug']]);
  const c = await g.checks('deck', 'mast', 'trunk');
  assert.deepEqual([c.total, c.failed], [3, ['test', 'lint']]);
});

test('a file is asked for as raw text and a binary one is refused', async () => {
  const f = fakeFetch((url) => (url.includes('logo.png') ? res(200, 'PNG\0data') : res(200, 'fn main() {}\n')));
  const g = new Github({ fetch: f });
  assert.equal(await g.file('deck', 'mast', 'trunk', 'src/a b.rs'), 'fn main() {}\n');
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/deck/mast/contents/src/a%20b.rs?ref=trunk');
  assert.equal(f.calls[0].headers.Accept, 'application/vnd.github.raw+json');
  await assert.rejects(g.file('deck', 'mast', 'trunk', 'logo.png'), (e) => e.status === 415);
});

test('GraphQL needs a token, and reads stargazers and what they starred', async () => {
  await assert.rejects(gh(() => res(200, '{}')).graphql('query { x }'), (e) => e.kind === 'token');
  const f = fakeFetch((url, init) => {
    const q = JSON.parse(init.body).query;
    return q.includes('stargazers(')
      ? res(200, { data: { rateLimit: { remaining: 4990, limit: 5000 }, repository: { stargazerCount: 77, stargazers: { nodes: [{ login: 'ann' }, { login: 'bob' }, { login: 'bad name' }] } } } })
      : res(200, { data: { rateLimit: { remaining: 4980, limit: 5000 }, u0: { login: 'ann', starredRepositories: { totalCount: 12, nodes: [{ nameWithOwner: 'small/kin', stargazerCount: 200, isArchived: false, pushedAt: '2026-01-02T03:04:05Z', primaryLanguage: { name: 'Rust' } }, { nameWithOwner: '../evil', stargazerCount: 1 }] } }, u1: null } });
  });
  const g = new Github({ fetch: f, token: 'tok123456' });
  const { stars, logins } = await g.newestStargazers('deck', 'mast', 40);
  assert.deepEqual([stars, logins], [77, ['ann', 'bob']]);
  const people = await g.recentStars(logins, 50);
  assert.equal(people.length, 1, 'a person GitHub does not know is skipped');
  assert.deepEqual([people[0].login, people[0].total, people[0].stars.length, people[0].stars[0].language], ['ann', 12, 1, 'Rust']);
  assert.equal(g.rateLine(), '4980 of 5000 requests left this hour');
  const q1 = JSON.parse(f.calls[1].body).query;
  assert.ok(q1.includes('u0: user(login: "ann")') && q1.includes('u1: user(login: "bob")'));
  assert.equal(f.calls[0].url, 'https://api.github.com/graphql');
  await assert.rejects(g.newestStargazers('../x', 'mast'), (e) => e.kind === 'notfound');
  await assert.rejects(new Github({ token: 't', fetch: async () => res(200, { errors: [{ message: 'Field x does not exist' }], data: null }) }).graphql('q'), /does not exist/);
});

test('the repo feed is asked with its ETag and an unchanged one is not read', async () => {
  const f = fakeFetch((url, init) => (init.headers['If-None-Match'] === 'W/"a"'
    ? res(304, '', { 'x-poll-interval': '60' })
    : res(200, [{ id: '9', type: 'WatchEvent', actor: { login: 'ann' }, created_at: '2026-10-24T15:42:01Z', payload: { action: 'started' } }, { id: '8', type: 'IssuesEvent', actor: { login: 'bob' }, created_at: '2026-10-24T15:40:00Z', payload: { action: 'opened', issue: { number: 12 } } }], { etag: 'W/"a"', 'x-poll-interval': '60' })));
  const g = new Github({ fetch: f });
  const first = await g.events('deck', 'mast');
  assert.deepEqual([first.notModified, first.etag, first.interval, first.events.length], [false, 'W/"a"', 60, 2]);
  assert.deepEqual([first.events[0].type, first.events[0].actor, first.events[1].number], ['WatchEvent', 'ann', 12]);
  const again = await g.events('deck', 'mast', first.etag);
  assert.deepEqual([again.notModified, again.events.length], [true, 0]);
});

test('stars: asked, set and taken back, only with a token', async () => {
  assert.equal(await gh(() => res(204)).isStarred('deck', 'mast'), null, 'no token, no answer');
  await assert.rejects(gh(() => res(204)).setStar('deck', 'mast', true), (e) => e.kind === 'token');
  const f = fakeFetch((url, init) => (init.method === 'GET' ? res(404) : res(204)));
  const g = new Github({ fetch: f, token: 'tok123456' });
  assert.equal(await g.isStarred('deck', 'mast'), false);
  await g.setStar('deck', 'mast', true);
  await g.setStar('deck', 'mast', false);
  assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'PUT', 'DELETE']);
  assert.ok(f.calls.every((c) => c.url === 'https://api.github.com/user/starred/deck/mast'));
  await assert.rejects(new Github({ token: 't', fetch: async () => res(403, { message: 'Resource not accessible by personal access token' }) }).setStar('deck', 'mast', true), /not accessible/);
});

test('discussions are listed, read and answered through GraphQL', async () => {
  const f = fakeFetch((url, init) => {
    const q = JSON.parse(init.body).query;
    if (q.startsWith('mutation')) return res(200, { data: { addDiscussionComment: { comment: { id: 'DC_1' } } } });
    if (q.includes('discussion(number')) return res(200, { data: { repository: { discussion: { id: 'D_1', title: 'How do I?', body: 'Help\r\n\r\n\r\nplease', createdAt: '2026-10-01T00:00:00Z', author: { login: 'ann' }, comments: { nodes: [{ id: 'C_1', body: 'Try this', createdAt: '2026-10-02T00:00:00Z', author: { login: 'bob' }, replies: { totalCount: 2 } }] } } } } });
    return res(200, { data: { repository: { hasDiscussionsEnabled: true, discussions: { nodes: [{ id: 'D_1', number: 5, title: 'How do I?', createdAt: '2026-10-01T00:00:00Z', upvoteCount: 3, category: { name: 'Q&A' }, author: { login: 'ann' }, comments: { totalCount: 4 }, answer: null }] } } } });
  });
  const g = new Github({ fetch: f, token: 'tok123456' });
  const list = await g.discussions('deck', 'mast');
  assert.deepEqual([list.enabled, list.list[0].number, list.list[0].category, list.list[0].comments, list.list[0].answered], [true, 5, 'Q&A', 4, false]);
  const d = await g.discussion('deck', 'mast', 5);
  assert.deepEqual([d.id, d.body, d.comments[0].author, d.comments[0].replies], ['D_1', 'Help\n\nplease', 'bob', 2]);
  assert.equal(await g.commentOnDiscussion('D_1', 'Thanks "all"'), 'DC_1');
  const mutation = JSON.parse(f.calls.at(-1).body).query;
  assert.ok(mutation.includes('discussionId: "D_1"') && mutation.includes('body: "Thanks \\"all\\""'), mutation);
  await assert.rejects(g.commentOnDiscussion('D_1"; evil', 'x'), (e) => e.kind === 'shape');
  await assert.rejects(g.discussion('deck', 'mast', '5; drop'), (e) => e.kind === 'shape');
});

test('managing a repo: comment, close, reopen, list and merge pull requests', async () => {
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/comments')) return res(201, '{}');
    if (url.endsWith('/merge')) return res(200, '{}');
    if (init.method === 'PATCH') return res(200, '{}');
    return res(200, [{ number: 7, title: 'Fix it', user: { login: 'ann' }, draft: false, created_at: '2026-10-01T00:00:00Z', head: { ref: 'fix' } }]);
  });
  const g = new Github({ fetch: f, token: 'tok123456' });
  await g.commentOnIssue('deck', 'mast', 12, 'On it');
  await g.setIssueState('deck', 'mast', 12, 'closed');
  await g.setIssueState('deck', 'mast', 12, 'open');
  assert.deepEqual((await g.pulls('deck', 'mast')).map((p) => [p.number, p.author, p.head]), [[7, 'ann', 'fix']]);
  await g.mergePull('deck', 'mast', 7);
  const [c, close, reopen, , merge] = f.calls;
  assert.equal(c.url, 'https://api.github.com/repos/deck/mast/issues/12/comments');
  assert.deepEqual(JSON.parse(close.body), { state: 'closed', state_reason: 'completed' });
  assert.deepEqual(JSON.parse(reopen.body), { state: 'open' });
  assert.equal(merge.method, 'PUT');
  await assert.rejects(g.setIssueState('deck', 'mast', 12, 'deleted'), (e) => e.kind === 'shape');
  await assert.rejects(new Github({ token: 't', fetch: async () => res(403, { message: 'Must have push access' }) }).setIssueState('deck', 'mast', 1, 'closed'), /push access/);
});

test('the owner and the top contributors are read for the captain\'s quarters', async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith('/users/deck')) return res(200, { login: 'deck', type: 'Organization', name: 'Deck & Co‮', bio: 'We build\nmasts', company: null, location: 'Ithaca', followers: 120, following: 3, public_repos: 41, created_at: '2015-05-01T00:00:00Z', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' });
    if (url.endsWith('/users/gone')) return res(404, {});
    if (url.includes('/contributors')) return res(200, [{ login: 'ann', contributions: 90, avatar_url: 'https://avatars.githubusercontent.com/u/2', type: 'User' }, { login: 'ci-bot', contributions: 40, avatar_url: 'https://evil.example/a.png', type: 'Bot' }, { login: '../x', contributions: 1 }]);
    return res(404, {});
  });
  const g = new Github({ fetch: f });
  const o = await g.owner('deck');
  assert.deepEqual([o.type, o.name, o.bio, o.location, o.followers, o.publicRepos, o.company], ['Organization', 'Deck & Co', 'We build masts', 'Ithaca', 120, 41, '']);
  assert.equal(o.avatar, 'https://avatars.githubusercontent.com/u/1?v=4');
  await assert.rejects(g.owner('gone'), (e) => e.kind === 'notfound');
  await assert.rejects(g.owner('../x'), (e) => e.kind === 'notfound');
  const c = await g.contributors('deck', 'mast');
  assert.deepEqual(c.map((x) => [x.login, x.contributions, x.bot]), [['ann', 90, false], ['ci-bot', 40, true]], 'a name that is not a login is dropped');
  assert.equal(c[1].avatar, '', 'a picture can only come from GitHub');
  assert.deepEqual(await new Github({ fetch: fakeFetch(() => res(204)) }).contributors('deck', 'empty'), [], 'an empty repo has no contributors');
});
