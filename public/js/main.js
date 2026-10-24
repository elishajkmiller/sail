// The page: loads ships from GitHub, grows the sea around them, runs the camera and the keys, draws, and keeps the ship you are on live.
// The rules are in game.js, the pictures in scene.js, the panels in ui.js, GitHub in github.js. The token lives in this browser only.

import * as THREE from '../vendor/three.module.min.js';
import { Github } from './github.js';
import { Atlas } from './atlas.js';
import { Game } from './game.js';
import { PathIndex, condition } from './github.js';
import * as treemap from './treemap.js';
import { parseTarget, hash32 } from './util.js';
import { Crew, peopleOf, rosterOf, isCrewEvent } from './crew.js';
import { look, turn, follow, shouldFollow, recenter, DRAG, FREE } from './camera.js';
import { Panels } from './ui.js';
import { CrewView, makeSea, makeSky, makeLights, buildShipView, DotFleet, makeCraft, LabelPool, RoomLabels, waveHeight, setSeaHole, updateSea, PixelPass, PIXEL, PALETTE } from './scene.js';
import { levelY, HOLD_Y } from './deck.js';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: nothing is kept */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nothing to do */ } },
};

const github = new Github({ token: store.get('ships:token') || '' });
const atlas = (() => { try { return Atlas.fromJSON(JSON.parse(store.get('ships:atlas') || 'null')); } catch { return new Atlas(); } })();
const game = new Game({ atlas });
const views = new Map();
let busy = false;
let saveTimer = 0;

// ---- the renderer and the world ----

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const DUSK = new THREE.Color(PALETTE.zenith), CAVE = new THREE.Color(0x0c0a08);
scene.background = DUSK;
scene.fog = new THREE.Fog(0x2a3238, 500, 2600);
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 5000);
// the picture is drawn in big pixels (add ?crisp to the address for the smooth one)
const crisp = new URLSearchParams(location.search).has('crisp');
const pixels = new PixelPass(renderer);
if (crisp) camera.layers.enableAll();
const sea = makeSea(), sky = makeSky();
scene.add(sky, sea, makeLights());
const fleet = new DotFleet(3000);
scene.add(fleet.mesh);
const craft = makeCraft();
scene.add(craft.boat, craft.person);
const shipLabels = new LabelPool(scene, 12);
const roomLabels = new RoomLabels();

// ---- the panels ----

const app = {
  game, atlas, github,
  starred: new Map(),
  openShip,
  walkToIssue: (n) => game.walkToIssue(n),
  flyTo: (i) => { game.flyTo(i); },
  refreshShip,
  setStarred(key, on) { app.starred.set(key, on); },
  setPortraits(i, urls) { const m = game.sea[i]; if (m) views.get(m.key)?.setPortraits(urls); },
  ticker: (line, cls) => panels.ticker(line, cls),
  crewOf: (i) => { const c = crews.get(game.sea[i]?.key); return c ? [...c.crew.members].sort((a, b) => b.at - a.at) : []; },
  saveToken(t) {
    t = (t || '').trim();
    if (!/^[A-Za-z0-9_\-]{8,255}$/.test(t)) return 'that does not look like a GitHub token';
    github.setToken(t); store.set('ships:token', t);
    return 'token saved: it stays in this browser';
  },
  clearToken() { github.setToken(''); store.del('ships:token'); return 'token removed'; },
  cardClosed: () => { if (game.reading) game.reading = null; shownReading = null; },
};
/** The people of each opened ship (see crew.js): key -> { crew, view } */
const crews = new Map();
const panels = new Panels(app);
const say = (t, bad = false) => panels.status(t, bad);

function saveAtlasSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { store.set('ships:atlas', JSON.stringify(atlas)); } catch { /* too big: the next one is tried later */ } }, 800);
}

// ---- opening a ship ----

function loadFlag(view, url) {
  if (!url) return;
  new THREE.TextureLoader().setCrossOrigin('anonymous').load(`${url}${url.includes('?') ? '&' : '?'}s=128`, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    view.state.flag.material.map = tex;
    view.state.flag.material.color.set(0xffffff);
    view.state.flag.material.needsUpdate = true;
  }, undefined, () => { /* no picture: the flag stays a plain colour */ });
}

function makeView(i) {
  const m = game.sea[i];
  const old = views.get(m.key);
  if (old) { scene.remove(old.group); old.dispose(); }
  const view = buildShipView(m, game.conditionOf(i));
  loadFlag(view, m.repo.avatar);
  scene.add(view.group);
  views.set(m.key, view);
}

/** Reads a ship from GitHub and brings her into the sea. `arrival`: 'fly' (asked for by name), 'land' (the boat is over her), 'near' (looking ahead). */
async function openShip(fullName, arrival = 'fly') {
  const t = parseTarget(fullName);
  if (!t.repo) return;
  const [owner, name] = t.repo;
  const have = game.find(`${owner}/${name}`);
  if (have >= 0 && arrival === 'fly') { game.flyTo(have); return; }
  if (busy) { say('one thing at a time: wait for the last one'); return; }
  busy = true;
  document.getElementById('go').disabled = true;
  try {
    say(`reading ${owner}/${name}`);
    const repo = await github.repo(owner, name);
    say('drawing the deck plan');
    let tree;
    try { tree = await github.tree(owner, name, repo.defaultBranch); } catch (e) { if (e.kind === 'notfound' || e.status === 409) tree = { files: [], partial: null }; else throw e; }
    const index = new PathIndex(tree.files.map((f) => f[0]));
    const notes = [];
    say('looking for cracks');
    const found = await github.issues(owner, name, index).catch((e) => { notes.push(`issues: ${e.message}`); return { issues: [], more: false }; });
    say('checking the hull');
    const checks = await github.checks(owner, name, repo.defaultBranch).catch((e) => { notes.push(`checks: ${e.message}`); return { total: 0, failed: [] }; });
    if (github.hasToken) github.isStarred(owner, name).then((on) => on !== null && app.setStarred(`${owner}/${name}`.toLowerCase(), on)).catch(() => {});
    const i = game.moor({ repo, files: tree.files, partial: tree.partial, item: treemap.build(tree.files), issues: found.issues, moreIssues: found.more, checks, notes }, arrival);
    makeView(i);
    loadTalk(i);
    say(`${repo.fullName} is in the sea`);
    panels.renderSide();
  } catch (e) {
    game.wantLand = null;
    say(e.message || String(e), true);
  } finally {
    busy = false;
    document.getElementById('go').disabled = false;
  }
  if (github.hasToken && game.find(`${owner}/${name}`) >= 0) expand(`${owner}/${name}`);
}
game.canOpen = () => !busy;

/** Finds the ships around a ship from the people who starred her, and puts them on the map. */
async function expand(fullName) {
  const entry = atlas.get(fullName);
  if (entry && entry.neighbours.length && game.now() - entry.expandedAt < 86400) return;
  if (busy) return;
  busy = true;
  try {
    say('asking the people who starred her what else they starred...');
    const [owner, name] = fullName.split('/');
    const found = await github.neighbours(owner, name);
    const m = game.sea[game.find(fullName)];
    atlas.addExpansion({ name: fullName, stars: m.repo.stars, language: m.repo.language, pushedAt: m.repo.pushedAt }, found, game.now());
    saveAtlasSoon();
    say(found.length ? `${found.length} ships lie around ${fullName}` : `nobody who starred ${fullName} has starred much else`);
    panels.renderSide();
  } catch (e) {
    say(`no neighbours: ${e.message}`, true);
  } finally {
    busy = false;
  }
}

/** With a token, her discussions are read and a table is put on her deck for each. */
async function loadTalk(i) {
  const m = game.sea[i];
  if (!m || !github.hasToken) return;
  const key = m.key;
  try {
    const found = await github.discussions(m.repo.owner, m.repo.name);
    if (game.sea[i]?.key !== key) return;
    game.setTalk(i, found);
    makeView(i);
  } catch { /* the tables stay as they were: a single empty one */ }
}

/** The people of a ship: those behind her open issues and open pull requests come aboard (the pull requests cost one more request). */
async function seedCrew(i) {
  const m = game.sea[i];
  if (!m) return;
  if (!crews.has(m.key)) crews.set(m.key, { crew: new Crew(m.deck, hash32(m.key)), view: new CrewView() });
  const pulls = await github.pulls(m.repo.owner, m.repo.name).catch(() => []);
  if (game.sea[i]?.key !== m.key) return;
  crews.get(m.key).crew.setPeople(rosterOf({ issues: m.issues, pulls }));
  panels.renderSide();
}

/** Her issues have changed: asked for again, and her cracks made again. */
async function refreshShip(i) {
  const m = game.sea[i];
  if (!m) return;
  const index = new PathIndex(m.files.map((f) => f[0]));
  const [found, checks] = await Promise.all([github.issues(m.repo.owner, m.repo.name, index), github.checks(m.repo.owner, m.repo.name, m.repo.defaultBranch).catch(() => null)]);
  game.setIssues(i, found.issues, found.more, checks);
  makeView(i);
  panels.renderSide();
}

// ---- the search box ----

const q = document.getElementById('q');
document.getElementById('search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = parseTarget(q.value);
  panels.hitsEl.hidden = true;
  if (t.repo) { openShip(`${t.repo[0]}/${t.repo[1]}`); q.blur(); return; }
  if (t.text.length < 2) { say('type at least two letters, owner/repo, or a GitHub address', true); return; }
  try {
    say(`searching for "${t.text}"`);
    const hits = await github.search(t.text);
    say(hits.length ? `${hits.length} ships for "${t.text}", most starred first` : `no ship is called anything like "${t.text}"`, !hits.length);
    panels.hits(hits, game.now());
  } catch (err) { say(err.message, true); }
});
setInterval(() => {
  const w = github.searchWait();
  document.getElementById('cool').textContent = w > 0 ? `search cooldown ${Math.ceil(w)}s` : '';
}, 500);

// ---- keys and the mouse ----

const down = new Set(), pressed = new Set();
const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Escape') document.activeElement.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyC' && !e.repeat) { toggleFreeLook(); return; }
  if (!down.has(e.code)) pressed.add(e.code);
  down.add(e.code);
});
addEventListener('keyup', (e) => down.delete(e.code));
addEventListener('blur', () => down.clear());

const cam = { yaw: 0, pitch: 0.42, zoom: 1, lastDrag: -10, x: 0, y: 0, z: 0 };
const nowS = () => performance.now() / 1000;
let drag = null;
// the mouse turns the camera three ways: drag with either button, free look (the pointer is held by the page: move the mouse, nothing pressed;
// C or the button, Esc to stop), and Q and E from the keyboard
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === canvas) { look(cam, e.movementX, e.movementY, FREE, nowS()); return; }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.moved > 4) look(cam, dx, dy, DRAG, nowS());
});
canvas.addEventListener('pointerup', (e) => {
  const was = drag; drag = null;
  canvas.classList.remove('dragging');
  if (!was || was.moved > 4 || was.button !== 0 || document.pointerLockElement === canvas) return;
  const p = pickWorld(e.clientX, e.clientY);
  if (p) game.click(p, e.detail >= 2);
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = Math.min(5, Math.max(0.35, cam.zoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
const lookButton = document.getElementById('look');
function toggleFreeLook() {
  if (document.pointerLockElement === canvas) { document.exitPointerLock(); return; }
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => say('the browser did not allow free look here', true)); } catch { say('the browser did not allow free look here', true); }
}
lookButton.addEventListener('click', toggleFreeLook);
document.addEventListener('pointerlockchange', () => {
  const on = document.pointerLockElement === canvas;
  lookButton.textContent = on ? 'Free look: on (Esc)' : 'Free look (C)';
  canvas.classList.toggle('freelook', on);
});

const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickWorld(cx, cy) {
  ray.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  plane.constant = game.aboard !== null ? -(levelY(game.level) + 0.1) : 0;
  const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
  return hit ? { x: hit.x, y: hit.z } : null;
}

function readInput() {
  const k = (c) => down.has(c) ? 1 : 0;
  const fwd = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'), side = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
  const fx = Math.cos(cam.yaw), fy = Math.sin(cam.yaw), rx = -Math.sin(cam.yaw), ry = Math.cos(cam.yaw);
  const input = {
    move: { x: fx * fwd + rx * side, y: fy * fwd + ry * side }, throttle: Math.max(-1, Math.min(1, fwd)), steer: Math.max(-1, Math.min(1, side)),
    boost: down.has('ShiftLeft') || down.has('ShiftRight'),
    leave: pressed.has('Space'), interact: pressed.has('KeyE'), esc: pressed.has('Escape'), recenter: pressed.has('KeyR'),
  };
  if (pressed.has('Escape') && panels.cardState) { panels.hide(); input.esc = false; }
  pressed.clear();
  return input;
}

// ---- one frame ----

const eye = new THREE.Vector3();
const drawSize = new THREE.Vector2();
let last = performance.now() / 1000;
let shownReading = null;
const feed = { key: null, etag: '', seen: null, next: 0, busy: false };

function handleEvents() {
  for (const ev of game.events.splice(0)) {
    if (ev.type === 'arrived') { cam.yaw = 0; cam.zoom = 1; panels.renderSide(); }
    else if (ev.type === 'boarded') { cam.zoom = 0.7; cam.pitch = 0.5; panels.renderSide(); }
    else if (ev.type === 'level') { cam.pitch = ev.level === 'hold' ? 0.75 : ev.level === 'quarters' ? 0.8 : 0.5; cam.zoom = ev.level === 'quarters' ? 0.7 : 0.8; panels.hide(); panels.renderSide(); }
    else if (ev.type === 'left') { cam.zoom = 1.4; panels.renderSide(); panels.hide(); }
    else if (ev.type === 'open') openShip(ev.name, 'land');
    else if (ev.type === 'station') ({ flag: () => panels.flagCard(ev.ship), table: () => panels.tableCard(ev.ship, ev.index), wheel: () => panels.wheelCard(ev.ship), desk: () => panels.deskCard(ev.ship) })[ev.id]?.();
    else if (ev.type === 'file') panels.fileCard(ev.ship, ev.file);
  }
  const r = game.reading;
  const key = r ? `${r.ship}:${r.issue}` : null;
  if (key !== shownReading) {
    shownReading = key;
    if (r) panels.issueCard(r.ship, r.issue);
    else if (panels.cardState === 'issue') panels.hide();
    panels.renderSide();
  }
}

/** The ship he is on is kept live: her own feed is asked for once a minute, and what happened shows up on her. */
async function pollFeed(t) {
  if (game.aboard === null || feed.busy || t < feed.next || document.hidden) return;
  const i = game.aboard, m = game.sea[i];
  if (feed.key !== m.key) Object.assign(feed, { key: m.key, etag: '', seen: null });
  feed.busy = true;
  try {
    const r = await github.events(m.repo.owner, m.repo.name, feed.etag);
    feed.next = t + Math.max(60, r.interval);
    if (r.notModified) return;
    feed.etag = r.etag;
    const first = feed.seen === null;
    feed.seen = feed.seen || new Set();
    let reissue = false, push = false;
    const fresh = r.events.filter((e) => !feed.seen.has(e.id));
    for (const e of fresh) feed.seen.add(e.id);
    if (!crews.has(m.key)) crews.set(m.key, { crew: new Crew(m.deck, hash32(m.key)), view: new CrewView() });
    const people = crews.get(m.key).crew;
    if (first) {
      people.setPeople(peopleOf(r.events));
      panels.renderSide();
      fresh.slice(0, 3).reverse().forEach((e) => panels.ticker(`${describe(e)} ${agoShort(e.at, game.now())}`));
      return;
    }
    for (const e of fresh.reverse()) {
      if (isCrewEvent(e)) { people.event(e); panels.renderSide(); }
      panels.ticker(describe(e), e.type === 'WatchEvent' ? 'gold' : '');
      if (e.type === 'WatchEvent') { m.repo.stars += 1; views.get(m.key)?.state.pulse?.(); }
      if (e.type === 'IssuesEvent' && ['opened', 'closed', 'reopened'].includes(e.action)) reissue = true;
      if (e.type === 'PushEvent') push = true;
    }
    if (reissue) await refreshShip(i);
    if (push) { const repo = await github.repo(m.repo.owner, m.repo.name); Object.assign(m.repo, { pushedAt: repo.pushedAt, stars: repo.stars }); makeView(i); }
    panels.renderSide();
  } catch (e) {
    feed.next = t + 120;
  } finally { feed.busy = false; }
}
const describe = (e) => {
  const who = e.actor || 'someone';
  switch (e.type) {
    case 'WatchEvent': return `${who} starred her`;
    case 'ForkEvent': return `${who} forked her`;
    case 'IssuesEvent': return `${who} ${e.action} #${e.number}`;
    case 'PullRequestEvent': return `${who} ${e.action} a pull request #${e.number}`;
    case 'PushEvent': return `${who} pushed`;
    case 'IssueCommentEvent': return `${who} commented on #${e.number}`;
    default: return `${who}: ${e.type.replace(/Event$/, '').toLowerCase()}`;
  }
};
const agoShort = (at, now) => { const s = Math.max(0, now - at); return s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

function frame() {
  const t = performance.now() / 1000, dt = Math.min(0.1, t - last);
  last = t;
  const input = readInput();
  game.step(dt, input);
  if (input.recenter) recenter(cam, game.human ? game.human.face : game.boat.heading, t);
  handleEvents();

  // the player
  const h = game.human, b = game.boat;
  craft.boat.visible = !h;
  craft.person.visible = !!h;
  let tx, ty, tz;
  if (h) {
    // he stands IN the ship's rocking group, in her own coordinates, so that he heaves and tilts with her deck and never clips into it
    const m = game.sea[game.aboard], host = views.get(m.key)?.floating;
    const walking = !!(game.walkTo || down.has('KeyW') || down.has('KeyA') || down.has('KeyS') || down.has('KeyD'));
    if (host && craft.person.parent !== host) host.add(craft.person);
    craft.person.position.set(h.x - m.x, levelY(h.level) + (walking ? Math.abs(Math.sin(t * 10)) * 0.06 : 0), h.y - m.y);
    craft.person.rotation.y = -h.face;
    craft.person.updateWorldMatrix(true, false);
    craft.person.getWorldPosition(eye);
    [tx, ty, tz] = [eye.x, eye.y + 1.6, eye.z];
  } else {
    if (craft.person.parent !== scene) scene.add(craft.person);
    const wy = waveHeight(b.x, b.y, t) * 0.6;
    craft.boat.position.set(b.x, wy + 0.1, b.y);
    craft.boat.rotation.set(0.04 * Math.sin(t * 1.3), -b.heading, 0.05 * Math.sin(t * 0.9), 'YXZ');
    [tx, ty, tz] = [b.x, wy + 1.5, b.y];
  }
  // the camera follows from behind, higher up the further out it is
  turn(cam, (down.has('KeyX') ? 1 : 0) - (down.has('KeyZ') ? 1 : 0), dt, t);
  if (shouldFollow(cam, t, { onFoot: !!h, freeLook: document.pointerLockElement === canvas })) follow(cam, b.heading, dt);
  const dist = (h ? (h.level === 'quarters' ? 6.5 : 9) : 26) * cam.zoom;
  cam.x += (tx - cam.x) * (1 - Math.exp(-8 * dt)); cam.y += (ty - cam.y) * (1 - Math.exp(-8 * dt)); cam.z += (tz - cam.z) * (1 - Math.exp(-8 * dt));
  camera.position.set(cam.x - Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist, cam.y + Math.sin(cam.pitch) * dist, cam.z - Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist);
  camera.lookAt(cam.x, cam.y + 0.5, cam.z);

  // the world
  sea.position.set(Math.round(camera.position.x / 12.5) * 12.5, 0, Math.round(camera.position.z / 12.5) * 12.5);
  sea.material.uniforms.uTime.value = t;
  if (crisp) updateSea(sea, camera, renderer.getDrawingBufferSize(drawSize), Math.max(2, Math.round(PIXEL * renderer.getPixelRatio())));
  else updateSea(sea, camera, pixels.size, 1);
  // aboard, the sea does not run through the ship (through the hatch, from the deck, she has a hold and not water under her); below deck and in
  // the quarters the near side of the hull is not drawn, and with it the sea and sky would show past the edge, so there the ship hangs in the dark
  const inside = game.aboard !== null && (game.level === 'hold' || game.level === 'quarters');
  setSeaHole(sea, game.aboard !== null ? game.sea[game.aboard] : null);
  sea.visible = sky.visible = fleet.mesh.visible = !inside;
  scene.background = inside ? CAVE : DUSK;
  sky.position.copy(camera.position);
  const loaded = new Set(game.sea.map((m) => m.key));
  const around = { x: cam.x, y: cam.z };
  fleet.update(atlas.dotsIn(around.x - 1500, around.y - 1500, around.x + 1500, around.y + 1500), loaded, around, t);
  shipLabels.update(inside ? [] : fleet.entries.slice(0, 12), t);
  game.sea.forEach((m, i) => {
    const near = game.aboard === i;
    const view = views.get(m.key);
    if (!view) return;
    view.group.visible = near || !inside;
    const want = near ? game.level : null;
    if (view.level !== want) view.setLevel(want);
    const people = crews.get(m.key);
    if (people) {
      people.crew.deck = m.deck;
      people.crew.step(dt);
      people.view.attach(view.floating);
      people.view.group.visible = !near || (game.level !== 'hold' && game.level !== 'quarters');
      people.view.sync(people.crew, t, near);
    }
    view.update(t, near && game.level === 'hold' ? game.nearCrack : -1, game.reading?.ship === i ? game.reading.issue : null, !!app.starred.get(m.key));
  });
  if (game.aboard !== null && game.level === 'hold') {
    const m = game.sea[game.aboard];
    roomLabels.attach(views.get(m.key)?.floating, m.key);
    roomLabels.update(m, { x: game.human.x - m.x, y: game.human.y - m.y }, HOLD_Y);
  } else roomLabels.detach();

  panels.prompt(game.prompt);
  const levelHint = { deck: 'the main deck: the flag, a table for every discussion, the hatch down to the hold, the door under the helm, the stairs to the helm', hold: 'the hold: the cracks are here, and the files', helm: 'the helm: the wheel', quarters: "the captain's quarters" }[game.level];
  document.getElementById('hint').textContent = game.aboard !== null
    ? `${levelHint}  -  W A S D walk, Shift run, click to walk, E to use what is beside you, Space back to your boat, look with the mouse (drag, or C for free look) while you move; R puts the camera behind you; Z X turn it; wheel zooms`
    : 'W S sail  -  A D steer  -  Shift boost  -  sail over a ship to land on her  -  double-click a ship to board  -  look with the mouse (drag, or C for free look) while you sail; R puts the camera behind the boat; Z X turn it; wheel zooms';
  pollFeed(t);
  if (crisp) renderer.render(scene, camera); else pixels.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  pixels.resize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
panels.renderSide();
setInterval(() => { if (!document.getElementById('side').contains(document.activeElement)) panels.renderSide(); }, 10000);
// framed inside Odysseus: a way back (the page around it closes the frame and leaves full screen)
if (window.parent !== window) {
  const back = document.getElementById('back');
  back.hidden = false;
  back.addEventListener('click', () => window.parent.postMessage({ type: 'ships:back' }, location.origin));
}
const start = new URLSearchParams(location.search).get('open');
if (start) openShip(start);
if (new URLSearchParams(location.search).has('debug')) window.__ships = { game, camera, scene, renderer, atlas, github, cam, THREE, openShip, views, makeView, crews, Crew, CrewView, peopleOf };
requestAnimationFrame(frame);
