# Ships

Every public GitHub repo is a ship on a dusk sea. Sail your boat over a ship and you land on her main deck as a sailor. She has three storeys:

- **the main deck** has the flag (star the repo), the tavern table (read and join her Discussions), the hatch down to the hold, the door of the captain's quarters and the stairs up to the helm
- **the helm**, a raised platform at the stern, has the wheel: manage issues and pull requests, when you may write to the repo
- **the captain's quarters**, under the helm, show the owner's profile and the top contributors (a desk, and their pictures in frames on the wall)
- **the hold**, below deck, has her files as rooms and her folders as walls, and every open issue is a glowing crack in the room it names (or in the hull, when it names no file). The deck lifts away when you go down so you see the hold from above

The ships around a ship are found live from the GitHub API: the people who starred her most recently, and what else they starred. The sea grows from where you have been, and it is kept in this browser. The ship you are standing on is kept live from her own event feed (stars, forks, issues, pushes), asked for once a minute.

Open source only (three.js is vendored in `public/vendor/`, MIT). No backend: the page calls api.github.com straight from the browser, and a token, if you add one, stays in this browser's local storage.

## Run it

    node server.js            # http://127.0.0.1:4177/  (PORT=... to change)
    node --test test/*.test.mjs

`?open=owner/repo` brings a ship in at start. Behind Odysseus's gate it is meant to be served at `/ships/`.

## Keys

Sailing: W S throttle, A D steer, Shift boost. Aboard: W A S D walk (the way the camera faces), Shift run, click to walk, E to use what is beside you (a station, a hatch, a ladder, stairs, a door, a crack to read, a room's file), Space to take off from any storey. Mouse: drag with either button to look, or press C (or the Free look button) and just move the mouse (Esc to stop); the wheel zooms; Z and X turn the camera from the keyboard; R puts the camera behind you again. The camera stays where you put it while you sail (it only drifts back behind the boat after eight idle seconds), so you can move and look about together.

## Tokens

Reading needs nothing. A token raises the limits (60 to 5000 requests an hour) and is needed to see the ships around a ship (GraphQL). A fine-grained token with no extra permissions is enough for that. Add **Starring** to star, **Discussions** to join one, **Issues** and **Pull requests** to manage a repo you can write to. Every write is a two-step button that says what it will do.

## Layout

    public/js/util.js     small helpers, cleaning of text from GitHub
    public/js/github.js   everything asked of the API, scoring of neighbours
    public/js/treemap.js  the deck plan from file sizes
    public/js/deck.js     the storeys: hull, quarters, helm, rooms, cracks, stations (metres)
    public/js/atlas.js    the sea as found so far, placement of neighbours
    public/js/game.js     the rules (sail, land, walk, read)
    public/js/scene.js    three.js: sea, sky, ships, sailor
    public/js/ui.js       the panels (DOM, text nodes only)
    public/js/main.js     the page
    server.js             static server, strict CSP
    tools/cdp.mjs         dev only: drives the installed Chrome for screenshots
