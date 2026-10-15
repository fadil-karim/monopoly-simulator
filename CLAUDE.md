# CLAUDE.md

Standing policy for this repository. Read it before making any change here.

## What this repo is

A Cloudflare Workers static-assets site: a browser Monopoly simulator (London
and Mega editions) in which every player is an AI model called through its API.
Everything served lives in `public/` and there is no build step - the files in
that directory are the site. The repo is connected to Cloudflare Workers
Builds, so **every push to `main` deploys to production**.

```
public/            everything served
  index.html
  404.html
  assets/css|js|fonts   fonts: Jost (OFL) self-hosted, the only font file; js/stats.js derives the live match, player and property statistics from the event log
  _headers         security + caching headers
  robots.txt
scripts/           headless engine checks (node scripts/simulate.mjs)
wrangler.jsonc     assets-only config, no Worker script
package.json       wrangler devDependency + dev/deploy/check/simulate scripts
prompt text/       the AI-instruction archive for the version in service
```

The game engine (`public/assets/js/engine.js`) is pure logic shared by the
browser and the Node check script; keep it free of DOM references.

## Local development

```bash
npm install
npm run dev          # wrangler dev
npm run simulate     # rule-based games in Node: invariants and illegal-action count
```

## Verification - before every push to main

1. `npx wrangler deploy --dry-run`
2. `npm run simulate` - must report `illegal: 0` and no thrown invariant.
3. Serve `public/`, render it with headless Chromium, and inspect the
   screenshots: styles applied, board drawn, layout intact at desktop and
   phone widths.

Never leave pushed work unverified or half-finished. Work in small, complete
batches: implement, verify, commit, push.

## Git and release workflow

- Before committing: `git config user.name "Fid" && git config user.email "fid_kk@proton.me"`
- Develop on the working branch and push there first. Release verified work by
  fast-forwarding `main` onto it and pushing `main`.
- Every push to `main` is a release. Versions are an ascending `vMAJOR.MINOR`
  sequence starting at `v1.0`; every push bumps the minor regardless of size. A
  major bump is reserved for a ground-up overhaul.
- With every push to `main`, provide release-tag text in the reply, in exactly
  this shape. The owner creates the GitHub release manually - **never push tags**:

  ```
  Tag: v<next>  —  Title: <five to nine words, plain and evocative>
  Description: <one to three sentences of editorial prose describing what changed
  from the owner's point of view — outcomes, not implementation. No bullet lists,
  no jargon, no file names.>
  ```

- Append the release line to the ledger below as part of the same push.
- Commit messages: descriptive imperative first line (what the change does, not
  "update X"), then a short prose body; dash bullets are fine there. One commit
  per coherent piece of work; several may share a push, but each push gets
  exactly one version entry.
- Never include model names, AI attribution trailers, session links, or other
  tooling identifiers in commit messages, titles, or code.

## AI-instruction archive

`prompt text/` holds the records for the version currently in service -
nothing else. Shipping version N replaces the folder's contents wholesale, in
the same push that releases the version: remove the previous version's
folder(s) and add `prompt text/N/` containing `input.txt` (the prompt, byte for
byte), `output.txt` (the reply that shipped it, byte for byte), `ai model.txt`
(three lines: Anthropic / Claude / Fable 5 Max unless the owner directs
otherwise) and every input image and file the owner provided, each under its
own name. The files are owner-supplied records: never edit, reformat, trim or
regenerate them. N counts shipped prompts, not release tags: a push that ships
no new prompt leaves the archive untouched.

## Release ledger

| Version | Title | Description |
| --- | --- | --- |
| v1.0 | Every seat at the Monopoly table is an AI | A complete browser Monopoly simulator for the London board, with the Mega edition as an option, where each player is an AI model you choose and brief, every game is logged in full, and results are analysed across games. |
| v1.1 | The players start talking to each other | Players now behave like people at a real table: they chat publicly, whisper to one opponent, answer when addressed and haggle over trades with counter-offers. The speed-die switches and all the pacing limits are gone, so everyone acts before every roll, trades freely and plays until the last player stands. |
| v1.2 | The board fills the window, in Monopoly's own colours | The live board now fits the window whole, dressed in Monopoly's palette and lettering, with the match in its centre: the goes, purchases, trades, the cash on the table, the money moving to and from the bank and between players, and how the dice have fallen, with the dice and the last event boxed beneath. Hovering any property shows who owns it, what rent it has brought in and to whom, how often it has been landed on and its history of purchases, trades and mortgages, and a click keeps it there; beneath the board every player is laid out with their properties, their takings by source and property, and their own roll distribution. |
