# Ships

Every public GitHub repo is a ship on a dusk sea. Sail your boat over a ship and you land on her deck as a sailor. Her files are the rooms of the deck, her folders are the walls, and every open issue is a glowing crack in the room it names (or in the hull, when it names no file). Three stations on every deck are the things developers do:

- **the flag** stars the repo
- **the tavern table** reads and joins her Discussions
- **the wheel** manages issues and pull requests, when you may write to the repo

The ships around a ship are found live from the GitHub API: the people who starred her most recently, and what else they starred. The sea grows from where you have been, and it is kept in this browser. The ship you are standing on is kept live from her own event feed (stars, forks, issues, pushes), asked for once a minute.

Open source only (three.js is vendored in `public/vendor/`, MIT). No backend: the page calls api.github.com straight from the browser, and a token, if you add one, stays in this browser's local storage.

## Run it

    node server.js            # http://127.0.0.1:4177/  (PORT=... to change)
    node --test test/*.test.mjs

`?open=owner/repo` brings a ship in at start. Behind Odysseus's gate it is meant to be served at `/ships/`.

## Keys

Sailing: W S throttle, A D steer, Shift boost. On deck: W A S D walk (the way the camera faces), Shift run, click to walk, E to read a crack / use a station / open a file, Space to take off. Drag to look, wheel to zoom.

## Tokens

Reading needs nothing. A token raises the limits (60 to 5000 requests an hour) and is needed to see the ships around a ship (GraphQL). A fine-grained token with no extra permissions is enough for that. Add **Starring** to star, **Discussions** to join one, **Issues** and **Pull requests** to manage a repo you can write to. Every write is a two-step button that says what it will do.

## Layout

    public/js/util.js     small helpers, cleaning of text from GitHub
    public/js/github.js   everything asked of the API, scoring of neighbours
    public/js/treemap.js  the deck plan from file sizes
    public/js/deck.js     hull, rooms, cracks, stations (metres)
    public/js/atlas.js    the sea as found so far, placement of neighbours
    public/js/game.js     the rules (sail, land, walk, read)
    public/js/scene.js    three.js: sea, sky, ships, sailor
    public/js/ui.js       the panels (DOM, text nodes only)
    public/js/main.js     the page
    server.js             static server, strict CSP
    tools/cdp.mjs         dev only: drives the installed Chrome for screenshots
