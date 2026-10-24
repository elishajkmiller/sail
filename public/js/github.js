// Everything asked of api.github.com, from the browser, with the player's own token (kept in this browser only, never sent anywhere else).
// Reading needs no permissions; the token raises the limits (60 to 5000 requests an hour, 10 to 30 searches a minute) and GraphQL needs one.
// Writes (star, comment, close an issue, merge) are only ever sent when the player presses the button for them.

import { valid, clean, cleanText, enc, parseIso } from './util.js';

const API = 'https://api.github.com';
export const MAX_TREE_CALLS = 40;
export const SAILING_DAYS = 90;
export const ANCHORED_DAYS = 365;
export const PEOPLE = 40;
export const STARS_EACH = 50;
export const NEIGHBOURS = 14;
const PER_QUERY = 10;
const MAX_FILES = 150000;
const MAX_ISSUE_FILES = 6;

export class GhError extends Error {
  /** kind: 'notfound' | 'limited' | 'status' | 'net' | 'shape' | 'token' */
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** How a ship is doing, from her last push; an archived repo is a wreck whatever its date. */
export function condition(repo, now) {
  if (repo.archived) return 'wreck';
  if (!repo.pushedAt) return 'derelict';
  const days = Math.floor(Math.max(0, now - repo.pushedAt) / 86400);
  return days > ANCHORED_DAYS ? 'derelict' : days > SAILING_DAYS ? 'anchored' : 'sailing';
}

/** A repo as GitHub describes it (the same shape in a search hit and in GET /repos/{owner}/{repo}). */
export function parseRepo(v) {
  const owner = v?.owner?.login, name = v?.name;
  if (!valid(owner) || !valid(name)) return null;
  const avatar = typeof v.owner.avatar_url === 'string' && v.owner.avatar_url.startsWith('https://avatars.githubusercontent.com/') ? v.owner.avatar_url : '';
  return {
    id: Number(v.id) || 0,
    owner, name,
    fullName: `${owner}/${name}`,
    description: clean(v.description, 400),
    stars: Number(v.stargazers_count) || 0,
    language: clean(v.language, 40),
    pushedAt: parseIso(v.pushed_at),
    archived: !!v.archived,
    fork: !!v.fork,
    openIssues: Number(v.open_issues_count) || 0,
    defaultBranch: typeof v.default_branch === 'string' && v.default_branch.length < 200 ? v.default_branch : 'main',
    avatar,
    parent: v.parent?.full_name ? clean(v.parent.full_name, 140) : null,
    hasDiscussions: !!v.has_discussions,
    // what the signed-in player may do here (absent without a token)
    can: v.permissions ? { admin: !!v.permissions.admin, push: !!v.permissions.push, triage: !!v.permissions.triage } : { admin: false, push: false, triage: false },
  };
}

const AVATAR = 'https://avatars.githubusercontent.com/';
const avatarOf = (u) => (typeof u === 'string' && u.startsWith(AVATAR) ? u : '');

/** The owner of a repo (a person or an organisation) as GitHub describes them. */
export function parseOwner(v) {
  if (!valid(v?.login)) return null;
  return {
    login: v.login, type: v.type === 'Organization' ? 'Organization' : 'User', name: clean(v.name, 80), bio: clean(v.bio, 300), company: clean(v.company, 80),
    location: clean(v.location, 80), followers: Number(v.followers) || 0, following: Number(v.following) || 0, publicRepos: Number(v.public_repos) || 0,
    createdAt: parseIso(v.created_at), avatar: avatarOf(v.avatar_url),
  };
}

/** Which files of a tree a piece of text is talking about. */
export class PathIndex {
  constructor(paths) {
    this.all = new Set(paths);
    this.byBase = new Map();
    for (const p of paths) {
      const base = p.slice(p.lastIndexOf('/') + 1);
      if (!this.byBase.has(base)) this.byBase.set(base, []);
      this.byBase.get(base).push(p);
    }
  }

  /** Words that are paths of the tree: the whole path, a path that ends the way the word does, or a bare file name that only one file has. */
  filesIn(text) {
    const found = [];
    for (const raw of String(text).split(/[^\p{L}\p{N}_\-./+@]+/u)) {
      const word = raw.replace(/^\.+|\.+$/g, '').replace(/^\/+/, '');
      if (word.length < 3 || !word.includes('.')) continue;
      const base = word.slice(word.lastIndexOf('/') + 1);
      let hit = [];
      if (this.all.has(word)) hit = [word];
      else if (this.byBase.has(base)) {
        const cands = this.byBase.get(base);
        const slashed = word.includes('/');
        const ok = cands.filter((c) => slashed && (c.endsWith('/' + word) || word.endsWith('/' + c)));
        hit = ok.length ? ok : !slashed && cands.length === 1 ? [cands[0]] : [];
      }
      for (const p of hit) if (!found.includes(p)) found.push(p);
      if (found.length >= MAX_ISSUE_FILES) { found.length = MAX_ISSUE_FILES; break; }
    }
    return found;
  }
}

/**
 * The repos that the same people starred, closest first. A repo counts by how many of the people starred it (at least two), less if they
 * have starred very many things, less the more popular the repo is (a repo everyone stars is near everything), and a score backed by
 * only a few people is held back.
 */
export function scoreNeighbours(target, people, top = NEIGHBOURS) {
  const n = people.filter((p) => p.stars.length).length;
  if (!n) return [];
  const t = target.toLowerCase();
  const acc = new Map();
  for (const p of people) {
    const w = 1 / Math.log(2 + p.total);
    const seen = new Set();
    for (const s of p.stars) {
      const key = s.name.toLowerCase();
      if (key === t || seen.has(key)) continue;
      seen.add(key);
      const a = acc.get(key) || { weight: 0, shared: 0, meta: s };
      a.weight += w; a.shared += 1;
      acc.set(key, a);
    }
  }
  const found = [];
  for (const a of acc.values()) {
    if (a.shared < 2) continue;
    const backed = a.shared / (a.shared + 2);
    const score = (10 * a.weight / Math.sqrt(n * (a.meta.stars + 100))) * backed;
    found.push({ name: a.meta.name, score, shared: a.shared, stars: a.meta.stars, language: a.meta.language, pushedAt: a.meta.pushedAt, archived: a.meta.archived });
  }
  found.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  return found.slice(0, top);
}

export class Github {
  constructor({ fetch = (...a) => globalThis.fetch(...a), token = '', retryMs = 800, now = () => Date.now() } = {}) {
    this.fetch = fetch;
    this.token = token;
    this.retryMs = retryMs;
    this.now = now;
    this.remaining = null;
    this.limit = null;
    this.blockedUntil = 0;
    this.searches = [];
  }

  setToken(t) { this.token = (t || '').trim(); }
  get hasToken() { return !!this.token; }

  rateLine() {
    return this.remaining == null ? '' : `${this.remaining} of ${this.limit} requests left this hour`;
  }

  /** Seconds a search has to wait to stay inside GitHub's limit (0 if it can go now). */
  searchWait() {
    const per = this.token ? 30 : 10, t = this.now();
    this.searches = this.searches.filter((s) => t - s < 60000);
    const window = this.searches.length >= per ? (this.searches[0] + 60000 - t) / 1000 : 0;
    return Math.max(window, (this.blockedUntil - t) / 1000, 0);
  }

  async send(url, { method = 'GET', accept = 'application/vnd.github+json', body, headers = {} } = {}) {
    const wait = this.blockedUntil - this.now();
    if (wait > 0) throw new GhError('limited', `GitHub's limit is reached; try again in ${Math.ceil(wait / 1000)} seconds (a token raises the limit)`, { seconds: Math.ceil(wait / 1000) });
    const h = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...headers };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const init = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) };
    let res;
    try {
      res = await this.fetch(url, init);
    } catch (e1) {
      // a dropped connection or a name that would not resolve for a moment is tried once more
      await new Promise((r) => setTimeout(r, this.retryMs));
      try { res = await this.fetch(url, init); } catch (e2) { throw new GhError('net', `no answer: ${e2.message || e2} (check the connection and try again)`); }
    }
    const get = (k) => res.headers?.get?.(k) ?? null;
    const rem = Number(get('x-ratelimit-remaining')), lim = Number(get('x-ratelimit-limit'));
    if (get('x-ratelimit-remaining') != null && get('x-ratelimit-resource') !== 'search') { this.remaining = rem; if (lim) this.limit = lim; }
    const text = res.status === 204 || res.status === 304 ? '' : await res.text();
    return { status: res.status, get, text };
  }

  /** The answer of a read, or an error that says what happened. */
  async read(path, opts) {
    const r = await this.send(path.startsWith('http') ? path : API + path, opts);
    if (r.status >= 200 && r.status < 300) return r;
    this.fail(r);
  }

  fail(r) {
    if (r.status === 404) throw new GhError('notfound', 'not found (it may be private, renamed or deleted)');
    if (r.status === 401) throw new GhError('token', 'GitHub does not accept that token');
    if (r.status === 403 || r.status === 429) {
      const retry = Number(r.get('retry-after')), reset = Number(r.get('x-ratelimit-reset'));
      const secs = retry || (r.get('x-ratelimit-remaining') === '0' && reset ? Math.max(1, reset - Math.floor(this.now() / 1000)) : 0);
      if (secs) {
        this.blockedUntil = this.now() + secs * 1000;
        throw new GhError('limited', `GitHub's limit is reached; try again in ${secs} seconds (a token raises the limit)`, { seconds: secs });
      }
    }
    let why = '';
    try { why = clean(JSON.parse(r.text).message, 160); } catch { /* not json */ }
    throw new GhError('status', `GitHub said ${r.status}${why ? ': ' + why : ''}`, { status: r.status });
  }

  async json(path, opts) {
    const r = await this.read(path, opts);
    try { return { v: JSON.parse(r.text), get: r.get }; } catch { throw new GhError('shape', "GitHub's answer could not be read"); }
  }

  async repo(owner, name) {
    if (!valid(owner) || !valid(name)) throw new GhError('notfound', 'not found');
    const repo = parseRepo((await this.json(`/repos/${owner}/${name}`)).v);
    if (!repo) throw new GhError('shape', "GitHub's answer could not be read");
    return repo;
  }

  /** The owner's public profile (a person or an organisation). */
  async owner(login) {
    if (!valid(login)) throw new GhError('notfound', 'not found');
    const o = parseOwner((await this.json(`/users/${login}`)).v);
    if (!o) throw new GhError('shape', "GitHub's answer could not be read");
    return o;
  }

  /** The people who have contributed most to the repo (ten at most, most first). An empty repo has none. */
  async contributors(owner, name) {
    if (!valid(owner) || !valid(name)) throw new GhError('notfound', 'not found');
    const r = await this.read(`/repos/${owner}/${name}/contributors?per_page=10`);
    if (!r.text.trim()) return [];
    let v;
    try { v = JSON.parse(r.text); } catch { throw new GhError('shape', "GitHub's answer could not be read"); }
    return (Array.isArray(v) ? v : []).filter((c) => valid(c?.login)).map((c) => ({ login: c.login, contributions: Number(c.contributions) || 0, avatar: avatarOf(c.avatar_url), bot: c.type === 'Bot' }));
  }

  /** Repos matching some words, most starred first. */
  async search(query) {
    const wait = this.searchWait();
    if (wait > 0) throw new GhError('limited', `GitHub allows only so many searches a minute: wait ${Math.ceil(wait)} seconds`, { seconds: Math.ceil(wait) });
    this.searches.push(this.now());
    const { v } = await this.json(`/search/repositories?q=${enc(query)}&sort=stars&order=desc&per_page=20`);
    if (!Array.isArray(v.items)) throw new GhError('shape', "GitHub's answer could not be read");
    return v.items.map(parseRepo).filter(Boolean);
  }

  /** Every file with its size. A tree too big for one call is read folder by folder, MAX_TREE_CALLS calls at most. */
  async tree(owner, name, branch) {
    const base = `/repos/${owner}/${name}/git/trees/`;
    const add = (v, prefix, out) => {
      for (const e of v.tree || []) if (e.type === 'blob' && out.length < MAX_FILES && typeof e.path === 'string') out.push([clean(prefix + e.path, 400), Number(e.size) || 0]);
    };
    const subs = (v, prefix) => (v.tree || []).filter((e) => e.type === 'tree' && /^[0-9a-f]+$/i.test(e.sha || '')).map((e) => [e.sha, `${prefix}${e.path}/`]);
    const files = [];
    let { v } = await this.json(`${base}${enc(branch)}?recursive=1`);
    add(v, '', files);
    if (v.truncated !== true) return { files, partial: null };
    files.length = 0;
    ({ v } = await this.json(`${base}${enc(branch)}`));
    add(v, '', files);
    const queue = subs(v, '');
    let calls = 0;
    while (queue.length && calls < MAX_TREE_CALLS && files.length < MAX_FILES) {
      const [sha, prefix] = queue.shift();
      calls++;
      let sub;
      try { sub = (await this.json(base + sha)).v; } catch { continue; }
      add(sub, prefix, files);
      queue.push(...subs(sub, prefix));
    }
    return { files, partial: queue.length ? `only part of the repo is shown: ${queue.length} folders were not opened (the tree is too big)` : 'the repo is too big for one call, so it was read folder by folder' };
  }

  /** The open issues (one page of 100; `more` says there are more) with the files each one names. Pull requests are not issues. */
  async issues(owner, name, index) {
    const { v, get } = await this.json(`/repos/${owner}/${name}/issues?state=open&per_page=100&sort=updated`);
    if (!Array.isArray(v)) throw new GhError('shape', "GitHub's answer could not be read");
    const issues = [];
    for (const i of v) {
      if (i.pull_request || !Number.isFinite(i.number) || typeof i.title !== 'string') continue;
      const body = String(i.body ?? '').slice(0, 6000);
      issues.push({
        number: i.number,
        title: clean(i.title, 200),
        files: index.filesIn(`${i.title}\n${body}`),
        body: cleanText(body, 1500),
        author: valid(i.user?.login) ? i.user.login : '',
        createdAt: parseIso(i.created_at),
        comments: Number(i.comments) || 0,
        labels: (i.labels || []).map((l) => clean(l?.name ?? l, 40)).filter(Boolean).slice(0, 6),
      });
    }
    return { issues, more: /rel="next"/.test(get('link') || '') };
  }

  /** Check runs of the newest commit on the branch. */
  async checks(owner, name, branch) {
    const { v } = await this.json(`/repos/${owner}/${name}/commits/${enc(branch)}/check-runs?per_page=100`);
    const bad = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);
    const failed = (v.check_runs || []).filter((r) => bad.has(r.conclusion)).map((r) => clean(r.name, 80));
    return { total: Number(v.total_count) || 0, failed };
  }

  /** The text of one file (up to a megabyte). Not for binary files. */
  async file(owner, name, branch, path) {
    if (!valid(owner) || !valid(name)) throw new GhError('notfound', 'not found');
    const r = await this.read(`/repos/${owner}/${name}/contents/${path.split('/').map(enc).join('/')}?ref=${enc(branch)}`, { accept: 'application/vnd.github.raw+json' });
    if (r.text.includes('\0')) throw new GhError('status', 'that is not a text file', { status: 415 });
    return r.text;
  }

  // ---- GraphQL (needs a token) ----

  async graphql(query) {
    if (!this.token) throw new GhError('token', 'this needs a token (the left bar has a box for one)');
    const r = await this.send(`${API}/graphql`, { method: 'POST', body: { query } });
    if (r.status !== 200) this.fail(r);
    let v;
    try { v = JSON.parse(r.text); } catch { throw new GhError('shape', "GitHub's answer could not be read"); }
    const rate = v.data?.rateLimit;
    if (rate) { this.remaining = rate.remaining ?? this.remaining; this.limit = rate.limit ?? this.limit; }
    if (!v.data) throw new GhError('status', clean(v.errors?.[0]?.message ?? 'GitHub refused the question', 160));
    return v;
  }

  /** A repo's newest stargazers (their names) and its star count. */
  async newestStargazers(owner, name, count = PEOPLE) {
    if (!valid(owner) || !valid(name)) throw new GhError('notfound', 'not found');
    const v = await this.graphql(`query { rateLimit { remaining limit } repository(owner: "${owner}", name: "${name}") { stargazerCount stargazers(first: ${count}, orderBy: {field: STARRED_AT, direction: DESC}) { nodes { login } } } }`);
    const repo = v.data.repository;
    if (!repo) throw new GhError('notfound', 'not found');
    return { stars: repo.stargazerCount || 0, logins: (repo.stargazers?.nodes || []).map((u) => u.login).filter(valid) };
  }

  /** What each of these people starred most recently, a few people to a query. */
  async recentStars(logins, each = STARS_EACH) {
    const out = [];
    for (let at = 0; at < logins.length; at += PER_QUERY) {
      const group = logins.slice(at, at + PER_QUERY).filter(valid);
      if (!group.length) continue;
      const people = group.map((l, i) => `u${i}: user(login: "${l}") { login starredRepositories(first: ${each}, orderBy: {field: STARRED_AT, direction: DESC}) { totalCount nodes { nameWithOwner stargazerCount isArchived pushedAt primaryLanguage { name } } } }`);
      const v = await this.graphql(`query { rateLimit { remaining limit } ${people.join(' ')} }`);
      group.forEach((_, i) => {
        const u = v.data[`u${i}`];
        if (!u?.login) return;
        const stars = (u.starredRepositories?.nodes || [])
          .filter((r) => { const [o, n] = String(r.nameWithOwner).split('/'); return valid(o) && valid(n); })
          .map((r) => ({ name: r.nameWithOwner, stars: r.stargazerCount || 0, language: clean(r.primaryLanguage?.name, 40), pushedAt: parseIso(r.pushedAt), archived: !!r.isArchived }));
        out.push({ login: u.login, total: u.starredRepositories?.totalCount || 0, stars });
      });
    }
    return out;
  }

  /** The repos that the people who starred this one most recently also starred, closest first (about 20 points of the hour's 5000). */
  async neighbours(owner, name) {
    const { logins } = await this.newestStargazers(owner, name, PEOPLE);
    return scoreNeighbours(`${owner}/${name}`, await this.recentStars(logins, STARS_EACH), NEIGHBOURS);
  }

  // ---- the live feed of one repo ----

  /** The repo's own recent events (stars, forks, pushes, issues), newest first. Asked with the last ETag; an unchanged feed costs nothing. */
  async events(owner, name, etag = '') {
    const r = await this.send(`${API}/repos/${owner}/${name}/events?per_page=100`, { headers: etag ? { 'If-None-Match': etag } : {} });
    if (r.status === 304) return { notModified: true, etag, interval: Number(r.get('x-poll-interval')) || 60, events: [] };
    if (r.status !== 200) this.fail(r);
    let v;
    try { v = JSON.parse(r.text); } catch { throw new GhError('shape', "GitHub's answer could not be read"); }
    const events = (Array.isArray(v) ? v : []).map((e) => ({
      id: String(e.id), type: String(e.type), actor: valid(e.actor?.login) ? e.actor.login : '', at: parseIso(e.created_at),
      action: e.payload?.action ? clean(e.payload.action, 20) : '', number: e.payload?.issue?.number ?? e.payload?.pull_request?.number ?? null,
    }));
    return { notModified: false, etag: r.get('etag') || '', interval: Number(r.get('x-poll-interval')) || 60, events };
  }

  // ---- stars ----

  /** Whether the signed-in player has starred the repo (null without a token). */
  async isStarred(owner, name) {
    if (!this.token) return null;
    const r = await this.send(`${API}/user/starred/${owner}/${name}`);
    if (r.status === 204) return true;
    if (r.status === 404) return false;
    this.fail(r);
  }

  async setStar(owner, name, on) {
    if (!this.token) throw new GhError('token', 'starring needs a token (with the Starring permission)');
    const r = await this.send(`${API}/user/starred/${owner}/${name}`, { method: on ? 'PUT' : 'DELETE', headers: { 'Content-Length': '0' } });
    if (r.status !== 204) this.fail(r);
    return on;
  }

  // ---- discussions ----

  /** The newest discussions of a repo (empty when it has none). */
  async discussions(owner, name) {
    const v = await this.graphql(`query { rateLimit { remaining limit } repository(owner: "${owner}", name: "${name}") { hasDiscussionsEnabled discussions(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { id number title createdAt upvoteCount category { name } author { login } comments { totalCount } answer { id } } } } }`);
    const repo = v.data.repository;
    if (!repo) throw new GhError('notfound', 'not found');
    return {
      enabled: !!repo.hasDiscussionsEnabled,
      list: (repo.discussions?.nodes || []).map((d) => ({
        id: String(d.id), number: d.number, title: clean(d.title, 200), at: parseIso(d.createdAt), votes: d.upvoteCount || 0,
        category: clean(d.category?.name, 40), author: valid(d.author?.login) ? d.author.login : '', comments: d.comments?.totalCount || 0, answered: !!d.answer,
      })),
    };
  }

  /** One discussion with its first comments. */
  async discussion(owner, name, number) {
    if (!Number.isInteger(number)) throw new GhError('shape', 'bad discussion number');
    const v = await this.graphql(`query { rateLimit { remaining limit } repository(owner: "${owner}", name: "${name}") { discussion(number: ${number}) { id title body createdAt author { login } comments(first: 30) { nodes { id body createdAt author { login } replies { totalCount } } } } } }`);
    const d = v.data.repository?.discussion;
    if (!d) throw new GhError('notfound', 'not found');
    return {
      id: String(d.id), title: clean(d.title, 200), body: cleanText(d.body, 3000), at: parseIso(d.createdAt), author: valid(d.author?.login) ? d.author.login : '',
      comments: (d.comments?.nodes || []).map((c) => ({ id: String(c.id), body: cleanText(c.body, 1500), at: parseIso(c.createdAt), author: valid(c.author?.login) ? c.author.login : '', replies: c.replies?.totalCount || 0 })),
    };
  }

  /** Posts a comment on a discussion (what the token may do decides if GitHub allows it). */
  async commentOnDiscussion(discussionId, text) {
    if (!/^[A-Za-z0-9_=-]+$/.test(discussionId)) throw new GhError('shape', 'bad discussion id');
    const v = await this.graphql(`mutation { addDiscussionComment(input: {discussionId: "${discussionId}", body: ${JSON.stringify(String(text).slice(0, 6000))}}) { comment { id } } }`);
    return v.data.addDiscussionComment?.comment?.id ?? null;
  }

  // ---- managing a repo (for repos the player may write to) ----

  async commentOnIssue(owner, name, number, text) {
    const r = await this.send(`${API}/repos/${owner}/${name}/issues/${Number(number)}/comments`, { method: 'POST', body: { body: String(text).slice(0, 6000) } });
    if (r.status !== 201) this.fail(r);
  }

  /** Closes or reopens an issue. */
  async setIssueState(owner, name, number, state) {
    if (state !== 'open' && state !== 'closed') throw new GhError('shape', 'bad state');
    const body = state === 'closed' ? { state, state_reason: 'completed' } : { state };
    const r = await this.send(`${API}/repos/${owner}/${name}/issues/${Number(number)}`, { method: 'PATCH', body });
    if (r.status !== 200) this.fail(r);
  }

  /** The open pull requests (a page of 30). */
  async pulls(owner, name) {
    const { v } = await this.json(`/repos/${owner}/${name}/pulls?state=open&per_page=30`);
    return (Array.isArray(v) ? v : []).map((p) => ({
      number: p.number, title: clean(p.title, 200), author: valid(p.user?.login) ? p.user.login : '', draft: !!p.draft, at: parseIso(p.created_at), head: clean(p.head?.ref, 60),
    }));
  }

  async mergePull(owner, name, number) {
    const r = await this.send(`${API}/repos/${owner}/${name}/pulls/${Number(number)}/merge`, { method: 'PUT', body: { merge_method: 'merge' } });
    if (r.status !== 200) this.fail(r);
  }
}
