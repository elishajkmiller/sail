// Small helpers shared by everything: cleaning text from GitHub, names, dates, a repeatable random source.

/** A name GitHub allows for an owner, a repo or a login: letters, digits, - _ . and nothing else. */
export function valid(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 100 && s !== '.' && s !== '..' && /^[A-Za-z0-9._-]+$/.test(s);
}

const HIDDEN = /[​-‏‪-‮⁠-⁩﻿]/g;

/** Text from GitHub made safe to show as text: control and invisible direction characters dropped, white space made single spaces, cut at `max` characters. */
export function clean(text, max) {
  let t = String(text ?? '').replace(HIDDEN, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > max ? chars.slice(0, Math.max(0, max - 3)).join('') + '...' : t;
}

/** Longer text (an issue's words): paragraphs stay, at most one blank line in a row. */
export function cleanText(text, max) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n').replace(HIDDEN, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  t = t.replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chars = [...t];
  return chars.length > max ? chars.slice(0, Math.max(0, max - 3)).join('') + '...' : t;
}

/** A query part as it goes into an address. */
export const enc = (s) => encodeURIComponent(s);

/** `2025-03-04T05:06:07Z` as seconds since 1970 (0 when it is not a date). */
export function parseIso(s) {
  const ms = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** "3 days ago". */
export function ago(secs, now) {
  if (!secs) return 'never';
  const s = Math.max(0, now - secs);
  const [n, unit] = s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : s < 2592000 ? [Math.floor(s / 86400), 'day'] : s < 31536000 ? [Math.floor(s / 2592000), 'month'] : [Math.floor(s / 31536000), 'year'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** What a user typed in the search box: `owner/repo` or a github.com address is a repo, anything else is words to search for. */
export function parseTarget(input) {
  const text = String(input ?? '').trim();
  let rest = text;
  for (const p of ['https://', 'http://', 'ssh://git@', 'git@']) {
    if (rest.startsWith(p)) { rest = rest.slice(p.length); break; }
  }
  let hadHost = false;
  for (const h of ['www.github.com', 'github.com']) {
    if (rest.startsWith(h)) { rest = rest.slice(h.length).replace(/^[:/]+/, ''); hadHost = true; break; }
  }
  rest = rest.split(/[?#]/)[0];
  const parts = rest.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/, '');
    // without a host only exactly owner/repo counts, so that "tetris clone" and "a/b/c" stay searches
    const exact = hadHost || ((rest.match(/\//g) || []).length === 1 && !/\s/.test(rest));
    if (exact && valid(owner) && valid(name)) return { repo: [owner, name] };
  }
  return { text };
}

/** A small number from a string, always the same. */
export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A repeatable random source (mulberry32): `rng()` is 0 up to 1. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** "12.3 KB". */
export function humanBytes(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}
