# New Eden: Warfront

A single-player RISK-inspired EVE Online fan game on the complete Caldari–Gallente faction warfare map. Choose Calmil or Galmil, deploy fleets, and fight three local computer commanders.

[Play on GitHub Pages](https://cyberbalsa.github.io/eveonline-risk/) · [Research and credits](https://cyberbalsa.github.io/eveonline-risk/research.html)

## Play

```sh
npm run serve
# Open http://localhost:8090
```

No build step, backend, account, API key, or package install is required to play. Any static server works. All game assets and rules are local; Google Fonts are optional.

- **FW sovereignty:** you and one allied bot against two enemy bots. Six connected home systems per commander and at least two held frontline systems per militia anchor the starting map. Additional original-faction territory is filled, with a variable mix of neutral garrisons and militia-held systems near the border. Neutral garrisons retain a militia occupancy claim. Allies share victory but command their own fleets and cards.
- **Total conquest:** you against three bots, with militia identity cosmetic. Take all 90 systems to win.
- Reinforce → attack → fortify. Select a system, then issue commands in Fleet Command. During attacks or fortification, select the source first and destination second.
- Classic dice comparisons, defender wins ties, garrisons, territory income, constellation bonuses, cards, progressive exchanges, elimination transfers, and one connected fortification per turn.
- In FW, run offensive plexes until an enemy system reaches 100% contested, then assault its vulnerable hub. Defensive plexes reduce friendly contested progress. A defeated hub stays lost and locked until the next round’s downtime, when occupancy flips. Clearing a neutral garrison in friendly militia space leaves its claim unchanged.
- Each turn supplies 4–8 plex operations; Frontline / Command Operations / Rearguard sites change progress by 25 / 15 / 5 points. Operation budgets, VP scaling, and round-based downtime are board adaptations. LP, advantage objectives, and ship-class restrictions are not simulated.
- Roll individual volleys or blitz a battle; choose occupation movement after a capture. Blitz can be stopped between rolls.
- Fifteen real constellations replace continents. Each commander begins with 55 fleets. Only classic conquest uses fully random initial ownership. The field manual describes adaptations in full.
- Search, constellation focus, pan, pinch, zoom, fit, keyboard selection, and labels toggle. Desktop panels scroll independently to keep command controls visible. Small screens use a stacked layout.
- Automatic save after every rules action, including pending occupations and downtime flips. Version-one campaigns migrate without altering their fleets and retain classic capture rules. Export/Import moves saves between browsers. Import pauses bots and keeps a recovery copy of the prior campaign when storage permits.
- Pause bots, speed up their turns, or open the manual to pause. Hidden tabs stop simulation and sounds. Elimination allows spectating through the final result.
- The latest 1,200 log entries persist; the log dialog displays the latest 150 matching events and exports all retained events.

## Map and bots

The September 22, 2026 ESI snapshot contains **90 systems, 110 direct stargate connections, and 15 constellations**. All are playable; no connections were invented. Positions exactly follow CCP’s in-game 2D star map from SDE build 3528119, using a uniform scale and the documented orientation. No per-system offsets or distorted proportions are applied. [Layout provenance](research/map-layout.json). Labels avoid collisions without moving the stars. Starting ownership is a board-game deal, not live sovereignty. [Snapshot and source method](research/warzone.json).

Three original heuristic styles use visible fleet counts, exact dice probabilities, constellation incentives, elimination opportunities, and border pressure. The planner does not receive future RNG state, deck order, or opponents' card identities. No machine-learning service or online inference is involved. Recruit/Veteran/Elite change risk thresholds; the labels are not a proven strength ranking. Fictional commander names are not real EVE pilots.

[Research notes](research.html) link the Hasbro rulebook, CCP data, and primary bot research. [Benchmark results](research/bot-benchmark.json) record a rotating-seat baseline comparison with reproducible seeds and limitations.

The initial **classic conquest** benchmark won 87 of 96 games against three simple fixed policies (90.6%); nine remained unfinished at the 600-turn horizon. This is a narrow baseline result, not a benchmark of FW mode or a claim about expert-human strength. FW bots also manage offensive/defensive plexing, downtime locks, and defensive occupation fleets.

## Assets

This project follows the static architecture and publishing pattern of `../eveonline-monopoly` (the existing directory spelling). Its icons, portraits, and prepared MP3 clips are reused with provenance preserved. The original colored icons are from CCP's **2014 Phoebe** pack. The requested media mount was empty in this environment; the bundled sounds are the helper project's existing credited EVE recordings, plus Kenney CC0 dice and thruster effects.

See [icon manifest](assets/icons/provenance.json), [sound manifest](assets/sounds/provenance.json), and [research/credits](research.html#assets). Sound begins after user input, defaults to 28%, and has persisted mute and volume settings.

## Development and checks

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run benchmark -- 96 820000
```

Node tests cover engine rules, illegal-action atomicity, saved-state validation, exact graph fidelity, combat probabilities, complete card accounting, asset hashes, 96 complete seeded classic bot campaigns, twelve full FW campaigns, and 96 FW setup seeds. FW tests cover minimum fronts, connected home areas, neutral accounting, plexing, hub vulnerability, downtime flips, and old-save migration. Playwright covers desktop/mobile interactions, combat, occupancy restore, cards, bot pauses, save import/export, sound decoding, GitHub Pages subpaths, neutral system inspection, and the complete offensive-plex-to-hub flow.

```sh
# Public ESI import, cached, with four workers and retries:
python3 scripts/import-warzone.py
python3 scripts/import-map-layout.py --build 3528119
python3 scripts/build-map.py
```

To fetch fresh geography, remove `.cache/esi/` before importing. Review changed map size, balances, copy, and tests together before publishing. These scripts are not needed to serve or deploy the checked-in game. Geographic refresh scripts use only Python's standard library.

Core files: `engine.js` (rules and seeded dice), `bots.js` (public-board decisions), `warfare.js` (FW setup and operational states), `map-data.js` (frozen playable graph and official 2D coordinates), `map.js` (SVG map/camera), `game.js` (UI and persistence), `audio.js` (sound), `styles.css` (layout).

## Publishing

The target is the public repository `cyberbalsa/eveonline-risk`, with GitHub Pages from `main` at `/ (root)`, matching the helper project. Pushes update the static site; `.nojekyll` and relative paths support project URLs and forks. `.github/workflows/tests.yml` runs rule and browser checks on pushes and pull requests.

EVE assets remain CCP intellectual property. RISK belongs to Hasbro. This is an unofficial, non-commercial fan project. This material is used with limited permission of CCP Games. No official affiliation or endorsement by CCP Games is stated or implied. See the linked source terms; third-party assets are not relicensed as project source code.
