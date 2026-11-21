# CanBot SAVE Editor

A save editor for *The Battle Cats* (にゃんこ大戦争), in two parts:

- **`src/canbot-engine/`** — a self-contained JavaScript engine that parses, edits and
  re-serializes Battle Cats save files byte-for-byte, and speaks the PONOS account /
  transfer-code protocol. No native code, no Python, no external services — just Node.
- **`tools/local/` + `web/local/`** — **canbot.js**, a command-line local editor built
  from the engine that runs on a PC or on Android (Termux).

## Layout

```
src/canbot-engine/     the SAVE engine (parse / edit / serialize / PONOS client)
src/edit-labels.js   shared feature labels
src/feature-policy.js   shared feature switches
tools/local/         the local editor source (cli.js, menus.js, i18n, build)
web/local/           the local editor page and the built canbot.js bundle
tests/               engine tests
```

## The engine

```js
const engine = require('./src/canbot-engine');

const raw = require('node:fs').readFileSync('SAVE_DATA');   // a Battle Cats save
const save = engine.parse(raw, 'kr');                       // region: kr | en | jp | tw
engine.set(save, 'catfood', 45000);                         // edit a field
const out = engine.serialize(save);                         // byte-exact save bytes
```

`engine.parse` reads every field the game stores; `engine.serialize` writes a save the
game reads back unchanged. The detailed editors (cats, stages, items, Gamatoto, …) and
the PONOS transfer-code client live under `src/canbot-engine/`.

## The local editor (canbot.js)

**Install** (Termux, Linux, macOS — needs Node.js 18+ and curl):

```sh
curl -fsSL https://canbot.dev/local/install.sh | sh
canbot
```

This puts `canbot.js` in `~/.canbot` and a `canbot` command on your PATH; the command
refreshes the editor at most every 6 hours and works offline with the copy it has. On
Windows, download [canbot.js](https://canbot.dev/local/canbot.js) and run `node canbot.js`.

**Build from source:** `canbot.js` is a bundled, single-file version of the local editor
built from the source in `tools/local/`:

```sh
node tools/local/build.js      # writes web/local/canbot.js
node web/local/canbot.js       # run it
```

It can load a save from transfer codes or from a rooted device's `SAVE_DATA`, edit it,
and upload it back for new transfer codes.

Languages: Korean, English, Japanese, Traditional Chinese, Spanish, French, German, Italian
and Thai (chosen on first start, changeable in Settings). Translations live in
`tools/local/translations.txt` and `tools/local/translations-extra.json`; `node tools/local/i18n.js`
adds them to the source. Corrections from native players are welcome.

> **Note:** the local editor is the client of a hosted CanBot service — it asks a server
> for sign-in, game data and a save quota. Running it against your own server requires a
> compatible backend, which is **not** included in this repository. The **engine**
> (`src/canbot-engine`) has no such dependency and is usable on its own.

## Build & test

```sh
node tools/local/build.js        # build web/local/canbot.js
node tools/local/build.js --check   # verify the built bundle is up to date
node --test tests/*.test.js      # run the engine tests
```

No dependencies are needed to build or run the readable editor. (Obfuscated builds are a
possible future addition and would need dev dependencies; they are not part of this
release.)

## License

This project is licensed under the **GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later)** — see [LICENSE](LICENSE).

In short: you may use, study, modify and share this software freely, **but** if you
distribute it or run a modified version as a network service, you must make your source
code available under the same license. Attribution must be kept.

## Disclaimer

*The Battle Cats* is a product of **PONOS Corporation**. This project is not affiliated
with, authorized, or endorsed by PONOS, and is intended for editing your own save data.
