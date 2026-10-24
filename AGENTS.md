# ships

Browser game: every public GitHub repo is a ship (three.js, no backend, GitHub API from the browser). See README.md.

- Plain ES modules, no build step. Tests: `node --test test/*.test.mjs` (no dependencies). The rules (game.js, deck.js, atlas.js, github.js) are tested without a browser; scene.js builds in Node too.
- Nothing from GitHub is ever put in as HTML: use textContent / el() in ui.js, and links only from validated owner/repo (ghLink).
- Writes to GitHub only behind twoStep() buttons.
- Browser checks: `tools/cdp.mjs` drives the Chrome that is already installed with a throwaway profile; never test through the real browser profile. Do not install browsers.
- Test server: `PORT=4199 node server.js`, then stop it with `pkill -f '^node server.js$'` (anchored: a looser pattern kills the shell running it).

## How I want things written
- No em-dashes. Short, plain replies. No real names or addresses in code, tests or comments. No Co-Authored-By lines. Never run sudo.
