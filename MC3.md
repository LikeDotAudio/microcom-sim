# MicroCOM III Assignment Software (`mc3.html`, `bin/mc3.mjs`)

MicroCOM III is the configuration program for the emulated 2048-port Ward-Beck matrix
(`mcom-tui/mcommatrix`). It looks and works like the 1993 DOS program MicroCOM II (MCOM.EXE v3.20):
the TCXL text UI, the title screen, the bottom status panel, the menu bar with pulldowns and hot keys,
F1 help, F10 save, ESC abort, Shift-F7 print, pick-lists, input fields, row-24 messages and the blue,
grey and white CP437 screens. It is extended to the virtual system's 32 productions × 64 ports.

One TypeScript core runs in two front ends: a browser page and a Linux terminal.

## Run

```sh
# the matrix engine must be running (HTTP + WebSocket on 127.0.0.1:8048)
cd mcom-tui && .venv/bin/python -m mcommatrix serve --demo

# Web: the engine serves dist/mc3.html at /mc3 (operator only, i.e. local connections)
cd mcom-web && npm run build        # then open http://127.0.0.1:8048/mc3   (?prod=30 picks PROD30)
npm run dev                         # dev server: http://localhost:5173/mc3.html (/ws proxied)

# Terminal (80x25 or larger, truecolor): runs the .ts sources directly with Node 24, no build
npm run mc3 -- --prod 30            # or: node bin/mc3.mjs [--url ws://127.0.0.1:8048/ws] [--prod N] [--print-dir DIR]
```

- **Ctrl-]** quits the terminal version at any time. Menu ▸ Quit ▸ Yes quits normally.
- If the browser or terminal takes the function keys, use **Alt-1 … Alt-0** for F1 … F10.
  Ctrl-Enter is "save and stay"; in the terminal, Ctrl-J also sends it.
- **Alt-P** selects the production from the main menu. **Alt-V** shows the about box. **F1** shows help everywhere.
- The web page needs a click to get keyboard focus. Emoji can be typed or pasted into fields.
- Printouts (Shift-F7) become text files. The browser downloads them; the terminal writes them to
  `--print-dir`, which defaults to the current directory. Utilities ▸ Printer Setup chooses plain text,
  Epson or LaserJet control codes.

## How MicroCOM III maps onto MCOM II

| MCOM II | MicroCOM III |
|---|---|
| Setup files on disk (`.MTX .OVA .TMA .EPC`) | The active production's configuration in the engine (`getcfg`), plus its extended keys and panel models |
| F10 in an editor writes the file | F10 saves into a **working copy** of the production. The status panel shows "Pending: YES" |
| Data Transfer uploads over the serial port | Data Transfer **applies to the matrix**: `setcfg` / `extkeys` / `panelmodel`, with the MCOM upload window. Only changed fields are sent; maps are diffed per bus |
| Active Matrix / Systems ID / Size | Production `PRODnn`, its name and site (`facMeta`), `064 of 2048` |
| Select Definition (terminal files A..H) | Selects the production. The engine has one key definition per production |
| Switch Setup / Copy Setup / Initialize / DOS Shell | Select Production / Copy Production / Production Setup / – |
| Data Link Test | Engine connection test (round trip of a `getcfg`) |

Each production you touch keeps its own working copy, so switching productions loses nothing. Quit
warns about unapplied changes. Editors reload from the engine on entry unless the working copy has
pending edits (MCOM also re-read its files on entry).

### What's new in III
- **Production selector**: Alt-P, Utilities ▸ Select Production, or Terminal Assignments ▸ Select
  Definition. It is a two-column pick list of PROD01..PROD32 with their names; `*` marks unapplied changes.
- **Matrix Index Table**: covers the 64 ports. F2 lists the MCOM terminal types plus the matrix panel
  models M7832, M7864, M2026 and M2026P (`panelmodel`). IFB/Mic ports 25-32 without a terminal show as `Talent`.
- **Assignment Edit**: the MCOM panel-art editor, laid out in banks of up to 12 keys with two banks per page (PgUp/PgDn).
  - Classic 7800 terminals keep their MCOM key slots (own production plus phantom codes GRP/CA/CMA/CNF/EV/IS).
    They also get a page of **matrix keys** X1..X24 (engine extended keys).
  - M7832/M7864/M2026 panels show all 32 or 64 keys in the same order as the engine: MCOM-programmed keys first, then matrix keys.
  - Any key that can hold a matrix key can target **any of the 2048 ports**. F5 chooses the target production, then you type
    that production's mnemonic. F2 opens the code picker, where LEFT/RIGHT browse productions. OVLY shows `Pnn` for
    another production and `+nn` for a multi-target key.
  - F3 sets the attribute (Talk / Listen / Talk & Listen / Listen-Mute). F9 applies just this station.
- **Talent positions** (IFB/Mic 25-32): Enter shows the turret info (IFB number, program source, MIC ON/OFF + cough,
  listen-only mic) instead of a key editor.
- **People & Places** (Utilities): edits each port's name, role, emoji and location (site, building, floor, room,
  row, seat, x, y, lat, lon). These go straight to the engine with `meta`; no Data Transfer is needed.
  **Production Setup** edits the production's name, site, building and coordinates (`facmeta`).
- **Copy Production**: copies the working copy onto another production, replacing its config, extended keys
  (own-production targets remapped) and panel models.

## Architecture

```
src/mc3/core/          platform independent (no DOM, no Node APIs)
  cp437.ts             CP437 <-> Unicode, CGA palette
  screen.ts            80x25 cells (grapheme + attribute byte), cursor, save/restore, text dump
  keys.ts              key tokens ({F1} {SF7} {UP} … or one printable grapheme), script parser
  runtime.ts           the "PC": key queue with TCXL getxch semantics (global hot keys F1/Alt-V/Alt-P),
                       waitkeyt timeouts, idle clock, beep/print/quit host hooks, timeScale for tests
  boxes.ts             box types and line joining (whline/wvline junctions)
  tcxl.ts              widgets: Win (wopen + shadow), message line, pick list, input field + forms,
                       menu bar/pulldowns, vertical menu, help window
  engine.ts            EngineClient: injected WebSocket factory, snapshot/meta tracking, getcfg barrier
  model.ts             Production working copy (diffs -> setcfg/extkeys/panelmodel), Workspace
  ctx.ts, printer.ts, help.ts, app.ts   status panel, printouts, help texts, title screen + main menu
  screens/             indexTable, keypad, overlay, assign (bus list, key editor, group editor,
                       transfers, talent), people (+ production setup), prodsel, transfer,
                       ifb, camera, call, relay, epc (spec 03 editors), arrays (re-exports)
src/mc3/web.ts         browser front end (canvas renderer in canvas.ts, key map in webkeys.ts)
src/mc3/ansi.ts        terminal front end helpers: ANSI truecolor renderer (row diff), input parser
bin/mc3.mjs            Node 24 entry: raw tty, global WebSocket, registers a resolve hook so the
                       extensionless .ts imports load with Node's built-in type stripping
```

Screens are written as sequential `async` code: `await rt.getKey()` takes the place of the DOS key
loop, and windows save and restore the cells under them like TCXL. Front ends only feed keys and
draw the cell buffer. The canvas renderer draws box-drawing and block characters as rectangles, so
lines join seamlessly whatever monospace font is available. It looks for a VGA font first (`Perfect DOS VGA 437`,
`Px437 IBM VGA8`); none is downloaded. Core code uses only erasable TypeScript (no enums or parameter
properties) so Node can strip the types.

## Tests

`npx vitest run test/mc3` covers:
- CP437, the screen, line joins and shadows, input fields, forms, pick lists, ANSI output, terminal and browser key maps.
- The title screen as a text snapshot.
- Menu navigation, help, Alt-P.
- Matrix Index edit and apply: the exact `setcfg` sent.
- F3/F2/ESC, talent rows, F4 increment.
- Assignment Edit with a cross-production matrix key and F9: the exact `extkeys` sent.
- Phantom keys, the M7832 panel and the talent info.
- People & Places `meta`, Group Edit and Transfer Group, keypad, phantom overlay, the printout.
- The spec 03 editors (`arrays.test.ts`).

`test/mc3/harness.ts` has an in-memory engine that speaks the WebSocket protocol.

## Status / not done
- Done:
  - Shell, title, status panel, menus, help.
  - Production selector.
  - Matrix Index Table, Keypad Prefix Codes, Overlay Definition (matrix and phantom codes).
  - IFB/PGM Sound, Camera Array, Call Array, Relay Control, Electronic Pegboard.
  - Terminal Assignments: Select, Assignment Edit, Group Edit, Transfer Assignment, Transfer Group.
  - Data Transfer (all items plus Whole Production).
  - People & Places, Production Setup, Copy Production, Printer Setup, Data Link Test, printouts.
- Deviations:
  - Several from MCOM II, deliberately:
    - Classic 16-key panels are split into banks of 12 + 4 instead of MCOM's narrow-cell horizontal scrolling.
    - Overlay "Select" only reports that there is one overlay per production.
    - No DOS shell or drive selection.
    - Empty values are 0 (engine), not 0xFF.
  - The spec 03 editors deviate in small ways:
    - IFB does not clamp out-of-range program sources just because the editor was opened, only on rows you edit.
      The upper-limit toggle uses 64 ports.
    - Camera array numbering has no off-by-one. F7 ISO Assign only changes the working copy.
    - A new relay's output field starts blank.
    - EPC reloads the table compacted after Ctrl-Enter.
- Matrix keys are stored as engine extended keys. Their label is the target mnemonic, or the original label if
  untouched. On matrix panels, a phantom key placed after a matrix key moves forward on save; the engine
  always lists MCOM keys first.
- Extended keys and panel models arrive in the engine snapshot shortly after an apply (the engine
  broadcasts ~0.15 s later). MicroCOM III trusts its own copy in the meantime.
