// The page's panels. Built only with createElement and text nodes (nothing from GitHub is ever put in as HTML), and links are only made from
// validated owner/repo names. Every action that writes to GitHub is a two-step button: it names exactly what it will do, and does it on the second press.

import { condition } from './github.js';
import { ago, humanBytes, valid } from './util.js';

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

/** A link to a page of GitHub, made from an owner and a repo that have been checked. */
export function ghLink(m, suffix, text) {
  const { owner, name } = m.repo;
  if (!valid(owner) || !valid(name)) return el('span', { text });
  return el('a', { href: `https://github.com/${owner}/${name}${suffix}`, target: '_blank', rel: 'noopener noreferrer', text });
}

/** A button that does its thing on the second press, within a few seconds, and says what it will do. */
export function twoStep(label, armedLabel, run, cls = '') {
  let timer = 0;
  const b = el('button', { class: cls, text: label });
  b.addEventListener('click', async () => {
    if (!b.classList.contains('armed')) {
      b.classList.add('armed'); b.textContent = armedLabel;
      timer = setTimeout(() => { b.classList.remove('armed'); b.textContent = label; }, 5000);
      return;
    }
    clearTimeout(timer);
    b.classList.remove('armed'); b.disabled = true; b.textContent = 'working...';
    try { await run(); } finally { b.disabled = false; b.textContent = label; }
  });
  return b;
}

const canManage = (m) => !!(m.repo.can.push || m.repo.can.triage || m.repo.can.admin);

/**
 * app: { game, atlas, github, starred: Map, openShip(name), flyTo(i), walkToIssue(n), refreshShip(i), setStarred(key, on), saveToken(t), clearToken(),
 *        loadFile(ship, file), say(text, bad), ticker(line) }
 */
export class Panels {
  constructor(app) {
    this.app = app;
    this.side = document.getElementById('side');
    this.card = document.getElementById('card');
    this.promptEl = document.getElementById('prompt');
    this.statusEl = document.getElementById('status');
    this.hitsEl = document.getElementById('hits');
    this.tickerEl = document.getElementById('ticker');
    this.cardState = null;
    this.tokenNote = '';
  }

  status(text, bad = false) { this.statusEl.textContent = text; this.statusEl.className = bad ? 'bad' : ''; }

  prompt(text) {
    this.promptEl.hidden = !text;
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
  }

  ticker(line, cls = '') {
    this.tickerEl.append(el('li', { class: cls, text: line }));
    while (this.tickerEl.children.length > 6) this.tickerEl.firstChild.remove();
    setTimeout(() => line && this.tickerEl.firstChild?.remove(), 20000);
  }

  hits(list, now) {
    this.hitsEl.replaceChildren(...list.map((r) => el('li', { onclick: () => { this.hitsEl.hidden = true; this.app.openShip(r.fullName); } },
      `${r.fullName}  `, el('span', { class: condition(r, now) }, condition(r, now)), `  ${r.stars} stars  ${r.language || '-'}`, r.description ? el('small', { text: r.description }) : null)));
    this.hitsEl.hidden = !list.length;
  }

  // ---- the bar on the left ----

  renderSide() {
    const { game, atlas, github } = this.app;
    const now = game.now();
    const kids = [];
    const m = game.focus !== null ? game.sea[game.focus] : null;
    if (!m) {
      kids.push(el('h2', { text: 'Ships' }),
        el('p', { text: 'Every public GitHub repo is a ship. Bring one in by name (owner/repo, or its address) or search for words, then sail to her.' }),
        el('p', { class: 'muted', text: 'A ship\'s condition comes from her last push: sailing (90 days), anchored (a year), derelict (older). An archived repo is a wreck. Below her deck, in the hold, her open issues are cracks. On deck is the tavern table (discussions); the helm is where she is managed; under the helm are the captain\'s quarters. Repos that the same people starred lie near each other.' }));
    } else {
      const cond = condition(m.repo, now), r = m.repo;
      kids.push(el('h2', { text: r.fullName }),
        el('p', {}, el('span', { class: cond, text: cond }), `  ${r.stars} stars  ${r.language || 'no language'}`),
        el('p', { class: 'muted', text: `last pushed ${ago(r.pushedAt, now)}${r.parent ? '  -  a fork of ' + r.parent : ''}` }));
      if (r.description) kids.push(el('p', { text: r.description }));
      kids.push(el('p', {}, ghLink(m, '', 'open on GitHub')));
      if (m.partial) kids.push(el('p', { class: 'gold', text: m.partial }));
      for (const n of m.notes) kids.push(el('p', { class: 'gold', text: n }));
      kids.push(el('h3', { text: `Cracks in the hold (${m.issues.length}${m.moreIssues ? '+' : ''} open issues)` }));
      if (!m.issues.length) kids.push(el('p', { class: 'good', text: 'none: she is sound.' }));
      else kids.push(el('p', { class: 'muted', text: 'Click one to go down to it.' }), el('ul', {}, ...m.issues.map((i) => el('li', { class: 'pick' + (game.reading?.ship === game.focus && game.reading?.issue === m.issues.indexOf(i) ? ' on' : ''), title: i.files.join('\n') || 'names no file: a crack in the hull', onclick: () => this.app.walkToIssue(m.issues.indexOf(i)) }, `#${i.number} ${i.title}`))));
      kids.push(el('h3', { text: 'Checks' }),
        !m.checks.total ? el('p', { class: 'muted', text: 'no check runs on the latest commit' })
          : !m.checks.failed.length ? el('p', { class: 'good', text: `all ${m.checks.total} passed` })
            : el('ul', {}, ...m.checks.failed.map((f) => el('li', { class: 'bad', text: `failed: ${f}` }))));
      const entry = atlas.get(r.fullName);
      if (entry?.neighbours?.length) {
        kids.push(el('h3', { text: 'Nearby (starred by the same people)' }), el('ul', {}, ...entry.neighbours.slice(0, 10).map((n) => el('li', { class: 'pick', title: `${n.shared} of her newest stargazers also starred it`, onclick: () => this.app.openShip(n.name) }, `${n.name}  `, el('span', { class: 'muted', text: `${n.shared} shared` })))));
      } else if (!github.hasToken) {
        kids.push(el('h3', { text: 'Nearby' }), el('p', { class: 'muted', text: 'Add a token below to see the ships around her: they are found from the people who starred her.' }));
      }
    }
    if (game.sea.length > 1) {
      kids.push(el('h3', { text: 'In the sea' }), el('ul', {}, ...game.sea.map((s, i) => el('li', { class: 'pick' + (i === game.focus ? ' on' : ''), title: 'sail there', onclick: () => this.app.flyTo(i) }, s.repo.fullName))));
    }
    kids.push(this.tokenBox());
    this.side.replaceChildren(...kids);
  }

  tokenBox() {
    const { github } = this.app;
    const input = el('input', { type: 'password', placeholder: 'paste a token', autocomplete: 'off', spellcheck: 'false' });
    const save = el('button', { text: 'Save', onclick: () => { this.tokenNote = this.app.saveToken(input.value); input.value = ''; this.renderSide(); } });
    return el('div', {},
      el('h3', { text: 'GitHub token' }),
      el('p', { class: github.hasToken ? 'good' : 'muted', text: github.hasToken ? 'a token is set (kept in this browser only)' : 'no token: 60 requests an hour, 10 searches a minute' }),
      el('p', { class: 'muted', text: github.rateLine() }),
      el('div', { class: 'row' }, input, save, github.hasToken ? el('button', { text: 'Remove', onclick: () => { this.tokenNote = this.app.clearToken(); this.renderSide(); } }) : null),
      el('p', { class: 'muted' }, 'Reading needs no permissions. To see the ships around a ship, to star, to join discussions or to manage your repos you need a token: ',
        el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener noreferrer', text: 'make a fine-grained one' }),
        ' (public repositories; add Starring, Issues, Pull requests or Discussions only for what you want to do).'),
      this.tokenNote ? el('p', { text: this.tokenNote }) : null);
  }

  // ---- the card on the right ----

  show(kind, ...kids) {
    this.cardState = kind;
    this.card.hidden = false;
    this.card.replaceChildren(el('button', { class: 'close', text: 'x', title: 'close (Esc)', onclick: () => this.hide() }), ...kids);
  }

  hide() { this.cardState = null; this.card.hidden = true; this.card.replaceChildren(); this.app.cardClosed?.(); }

  /** Runs `fn`, showing its error in `note` instead of throwing. */
  async guard(note, fn) {
    note.textContent = '';
    note.className = '';
    try { return await fn(); } catch (e) { note.textContent = e.message || String(e); note.className = 'bad'; return undefined; }
  }

  // an issue, read at its crack
  issueCard(shipIndex, issueIndex) {
    const m = this.app.game.sea[shipIndex], i = m?.issues[issueIndex];
    if (!i) return;
    const now = this.app.game.now(), note = el('p');
    const kids = [el('h2', { text: `Crack #${i.number}` }), el('p', { text: i.title }),
      el('p', { class: 'muted', text: `opened ${ago(i.createdAt, now)} by ${i.author || 'someone'}, ${i.comments} comment${i.comments === 1 ? '' : 's'}${i.labels.length ? '  -  ' + i.labels.join(', ') : ''}` }),
      el('p', { class: 'muted', text: i.files.length ? `It runs through: ${i.files.join(', ')}` : 'It names no file: the crack is in the hull.' }),
      el('pre', { text: i.body || '(no description)' }), el('p', {}, ghLink(m, `/issues/${i.number}`, 'open this issue on GitHub'))];
    if (canManage(m)) kids.push(this.issueActions(m, i, note));
    else kids.push(el('p', { class: 'muted', text: 'To comment or close issues here you need write access to the repo (her wheel shows what you can do).' }));
    kids.push(note);
    this.show('issue', ...kids);
  }

  issueActions(m, i, note) {
    const box = el('textarea', { placeholder: 'write a comment', rows: 3 });
    const { github } = this.app;
    return el('div', {}, box,
      el('div', { class: 'row' },
        twoStep('Comment', `Confirm: post this on #${i.number}`, () => this.guard(note, async () => {
          if (!box.value.trim()) throw new Error('write something first');
          await github.commentOnIssue(m.repo.owner, m.repo.name, i.number, box.value);
          box.value = '';
          note.textContent = 'posted'; note.className = 'good';
        })),
        twoStep('Repair the crack (close)', `Confirm: close #${i.number}`, () => this.guard(note, async () => {
          await github.setIssueState(m.repo.owner, m.repo.name, i.number, 'closed');
          this.app.ticker(`you closed #${i.number}`, 'good');
          await this.app.refreshShip(this.app.game.find(m.repo.fullName));
          this.hide();
        }), 'danger')));
  }

  // the flag: star the repo
  async flagCard(shipIndex) {
    const m = this.app.game.sea[shipIndex], { github } = this.app, note = el('p'), body = el('div');
    this.show('flag', el('h2', { text: 'The flag' }), el('p', { text: `Raise it to star ${m.repo.fullName} on your GitHub account.` }), body, note);
    if (!github.hasToken) { body.append(el('p', { class: 'muted', text: 'Starring needs a token with the Starring permission (a fine-grained token has it under account permissions).' })); return; }
    const on = await this.guard(note, () => github.isStarred(m.repo.owner, m.repo.name));
    if (on === undefined) return;
    this.app.setStarred(m.key, on);
    body.append(el('p', {}, on ? el('span', { class: 'good', text: 'You have starred her: her flag flies high.' }) : el('span', { class: 'muted', text: 'You have not starred her.' })),
      twoStep(on ? 'Lower the flag (unstar)' : 'Raise the flag (star)', `Confirm: ${on ? 'unstar' : 'star'} ${m.repo.fullName}`, () => this.guard(note, async () => {
        await github.setStar(m.repo.owner, m.repo.name, !on);
        this.app.setStarred(m.key, !on);
        this.app.ticker(`${on ? 'you unstarred' : 'you starred'} ${m.repo.fullName}`, 'good');
        this.flagCard(shipIndex);
      })));
  }

  // the tavern table: her discussions
  async tavernCard(shipIndex) {
    const m = this.app.game.sea[shipIndex], { github } = this.app, note = el('p'), body = el('div');
    this.show('tavern', el('h2', { text: 'The tavern table' }), el('p', { class: 'muted', text: `Discussions of ${m.repo.fullName}` }), body, note);
    if (!github.hasToken) { body.append(el('p', { class: 'muted', text: 'Reading discussions needs a token (GitHub only answers GraphQL for signed-in callers). Any token will do; it needs no permissions.' })); return; }
    body.append(el('p', { class: 'muted', text: 'asking the tavern...' }));
    const found = await this.guard(note, () => github.discussions(m.repo.owner, m.repo.name));
    if (!found) { body.replaceChildren(); return; }
    if (!found.enabled || !found.list.length) {
      body.replaceChildren(el('p', { text: found.enabled ? 'Nobody has sat down here yet: no discussions.' : 'This repo has not opened a tavern: Discussions are off.' }), el('p', {}, ghLink(m, '/discussions', 'open on GitHub')));
      return;
    }
    const now = this.app.game.now();
    body.replaceChildren(el('ul', {}, ...found.list.map((d) => el('li', { class: 'pick', onclick: () => this.threadCard(shipIndex, d.number) },
      el('span', { class: 'gold', text: d.category ? `[${d.category}] ` : '' }), d.title, el('br'), el('span', { class: 'muted', text: `${d.author || 'someone'}, ${ago(d.at, now)}, ${d.comments} comments${d.answered ? ', answered' : ''}${d.votes ? ', ' + d.votes + ' votes' : ''}` })))),
      el('p', {}, ghLink(m, '/discussions', 'open on GitHub')));
  }

  async threadCard(shipIndex, number) {
    const m = this.app.game.sea[shipIndex], { github } = this.app, note = el('p'), body = el('div');
    this.show('thread', el('button', { text: '< back to the table', onclick: () => this.tavernCard(shipIndex) }), body, note);
    body.append(el('p', { class: 'muted', text: 'listening...' }));
    const d = await this.guard(note, () => github.discussion(m.repo.owner, m.repo.name, number));
    if (!d) return;
    const now = this.app.game.now(), box = el('textarea', { placeholder: 'say something', rows: 3 });
    body.replaceChildren(el('h2', { text: d.title }), el('p', { class: 'muted', text: `${d.author || 'someone'}, ${ago(d.at, now)}` }), el('pre', { text: d.body || '(nothing said)' }),
      el('ul', {}, ...d.comments.map((c) => el('li', {}, el('span', { class: 'gold', text: `${c.author || 'someone'} ` }), el('span', { class: 'muted', text: `${ago(c.at, now)}${c.replies ? ', ' + c.replies + ' replies' : ''}` }), el('pre', { text: c.body })))),
      box,
      twoStep('Join the talk', `Confirm: post this in "${d.title.slice(0, 40)}"`, () => this.guard(note, async () => {
        if (!box.value.trim()) throw new Error('say something first');
        await github.commentOnDiscussion(d.id, box.value);
        this.app.ticker('you joined a discussion', 'good');
        await this.threadCard(shipIndex, number);
      })));
  }

  // the wheel: manage the repo
  async wheelCard(shipIndex) {
    const m = this.app.game.sea[shipIndex], { github } = this.app, note = el('p'), body = el('div');
    const r = m.repo;
    this.show('wheel', el('h2', { text: 'The wheel' }), el('p', { class: 'muted', text: `Managing ${r.fullName}` }), body, note);
    if (!github.hasToken) { body.append(el('p', { class: 'muted', text: 'Managing a repo needs a token (with Issues and Pull requests write access to it).' })); return; }
    if (!canManage(m)) {
      body.append(el('p', { text: 'You can read this ship but not steer her: managing needs push or triage access to the repo, and GitHub says you have neither here.' }), el('p', { class: 'muted', text: 'On your own repos the wheel closes issues, comments and merges pull requests.' }));
      return;
    }
    const tabs = el('div', { class: 'tabs' }), list = el('div');
    const show = async (tab) => {
      tabs.replaceChildren(...['Issues', 'Pull requests'].map((t) => el('button', { class: t === tab ? 'on' : '', text: t, onclick: () => show(t) })));
      list.replaceChildren(el('p', { class: 'muted', text: 'reading...' }));
      if (tab === 'Issues') {
        list.replaceChildren(!m.issues.length ? el('p', { class: 'good', text: 'No open issues.' }) : el('ul', {}, ...m.issues.map((i) => el('li', {}, `#${i.number} ${i.title}`, el('div', { class: 'row' },
          el('button', { text: 'Read', onclick: () => this.issueCard(shipIndex, m.issues.indexOf(i)) }),
          twoStep('Close', `Confirm: close #${i.number}`, () => this.guard(note, async () => {
            await github.setIssueState(r.owner, r.name, i.number, 'closed');
            this.app.ticker(`you closed #${i.number}`, 'good');
            await this.app.refreshShip(shipIndex);
            this.wheelCard(shipIndex);
          }), 'danger'))))));
      } else {
        const prs = await this.guard(note, () => github.pulls(r.owner, r.name));
        if (!prs) { list.replaceChildren(); return; }
        const now = this.app.game.now();
        list.replaceChildren(!prs.length ? el('p', { class: 'good', text: 'No open pull requests.' }) : el('ul', {}, ...prs.map((p) => el('li', {}, `#${p.number} ${p.title}`, el('br'), el('span', { class: 'muted', text: `${p.author || 'someone'}, ${ago(p.at, now)}${p.draft ? ', draft' : ''}, from ${p.head}` }),
          el('div', { class: 'row' }, ghLink(m, `/pull/${p.number}`, 'open on GitHub'),
            r.can.push && !p.draft ? twoStep('Merge', `Confirm: merge #${p.number} into ${r.defaultBranch}`, () => this.guard(note, async () => { await github.mergePull(r.owner, r.name, p.number); this.app.ticker(`you merged #${p.number}`, 'good'); show('Pull requests'); }), 'danger') : null)))));
      }
    };
    body.append(tabs, list);
    show('Issues');
  }

  // the captain's desk: who owns her, and who has done the most work on her
  async deskCard(shipIndex) {
    const m = this.app.game.sea[shipIndex], { github } = this.app, note = el('p'), body = el('div');
    this.show('desk', el('h2', { text: "The captain's quarters" }), el('p', { class: 'muted', text: `The owner and the top contributors of ${m.repo.fullName}` }), body, note);
    body.append(el('p', { class: 'muted', text: 'opening the logbook...' }));
    const [owner, people] = await Promise.all([this.guard(note, () => github.owner(m.repo.owner)), this.guard(note, () => github.contributors(m.repo.owner, m.repo.name))]);
    if (this.cardState !== 'desk') return;
    const now = this.app.game.now(), kids = [];
    const picture = (url, cls) => (url ? el('img', { class: cls, src: url, alt: '', width: 48, height: 48, referrerpolicy: 'no-referrer' }) : null);
    const who = (login) => el('a', { href: `https://github.com/${login}`, target: '_blank', rel: 'noopener noreferrer', text: login });
    if (owner) {
      kids.push(el('div', { class: 'profile' }, picture(owner.avatar, 'avatar'), el('div', {},
        el('h2', { text: owner.name || owner.login }), el('p', { class: 'muted' }, who(owner.login), `  ${owner.type === 'Organization' ? 'organisation' : 'person'}, on GitHub ${ago(owner.createdAt, now).replace(' ago', '')}`))),
      owner.bio ? el('p', { text: owner.bio }) : null,
      el('p', { class: 'muted', text: [owner.company, owner.location].filter(Boolean).join('  -  ') }),
      el('p', {}, el('span', { class: 'gold', text: `${owner.followers}` }), ' followers   ', el('span', { class: 'gold', text: `${owner.publicRepos}` }), ' public repos', owner.type === 'User' ? el('span', {}, '   ', el('span', { class: 'gold', text: `${owner.following}` }), ' following') : null));
    }
    kids.push(el('h3', { text: 'Top contributors' }));
    if (people) {
      if (!people.length) kids.push(el('p', { class: 'muted', text: 'Nobody has signed the log yet.' }));
      else kids.push(el('ul', { class: 'people' }, ...people.map((c) => el('li', {}, picture(c.avatar, 'avatar small'), who(c.login), el('span', { class: 'muted', text: `  ${c.contributions} commits${c.bot ? '  (a bot)' : ''}` })))));
      this.app.setPortraits(shipIndex, people.filter((c) => !c.bot).map((c) => c.avatar));
    }
    body.replaceChildren(...kids);
  }

  // a file of a room
  async fileCard(shipIndex, file) {
    const m = this.app.game.sea[shipIndex], path = m.files[file][0], note = el('p'), body = el('div');
    this.show('file', el('h2', { text: path }), el('p', { class: 'muted', text: humanBytes(m.files[file][1]) }), body, note);
    body.append(el('p', { class: 'muted', text: 'fetching...' }));
    const text = await this.guard(note, () => this.app.github.file(m.repo.owner, m.repo.name, m.repo.defaultBranch, path));
    if (text === undefined) { body.replaceChildren(); return; }
    body.replaceChildren(el('pre', { text: text.length > 60000 ? text.slice(0, 60000) + '\n... (cut)' : text }),
      el('p', {}, ghLink(m, `/blob/${encodeURIComponent(m.repo.defaultBranch)}/${path.split('/').map(encodeURIComponent).join('/')}`, 'open on GitHub'),
        window.parent !== window ? [' ', el('button', { text: 'Open in the Odysseus editor', onclick: () => window.parent.postMessage({ type: 'ships:open-file', repo: m.repo.fullName, branch: m.repo.defaultBranch, path, text }, location.origin) })] : null));
  }
}
