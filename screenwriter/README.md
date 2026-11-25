# Reelwright

Screenwriting and pre-production in the browser, modeled on the Celtx workflow: write the script, break it down, plan shots and storyboards, schedule the shoot, then generate call sheets and a budget. It works offline and installs like an app. No account or server is involved, so your scripts stay on your device.

## Running it

It is a static site with no build step.

- **GitHub Pages:** once this folder is on the branch Pages serves, open `https://<user>.github.io/<repo>/screenwriter/`.
- **Locally:** from this folder run `python3 -m http.server 8000` and open `http://localhost:8000`. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.
- **Install:** use "Add to Home Screen" (iOS/Android) or "Install app" (Chrome/Edge desktop) to get an app icon and offline use.

## What it does

**Projects and scripts**
- Unlimited projects, each holding any number of scripts and documents: drafts, TV episodes, treatments, bibles, notes.
- Project types: Film, TV Series (numbered episodes sharing one catalog, schedule and budget), Stage Play, Audio Drama/Podcast, AV two-column, and Comic Book.
- Convert a copy of a script to another format (for example screenplay to stage play or AV).

**Script editor**
- Industry formatting: Courier 12pt, standard margins, 54 lines per page.
- Enter and Tab element flow like Final Draft and Celtx; Alt+1…9 picks an element type.
- Autocomplete for characters, locations, times of day, extensions and transitions.
- Typing `INT. ` or `EXT. ` on an action line turns it into a scene heading.
- Bold, italic and underline; dual dialogue; automatic (CONT'D).
- Undo and redo; find and replace; spell check; comments with replies and resolve.
- Focus mode, typewriter scrolling, dark mode, and an exact-page or fit-to-screen layout.
- On phones, a bar above the keyboard switches element types.
- Scene navigator with synopses, colors, omit and delete.
- Title page.
- Revisions: colored revision sets, asterisks in the margin, revision header on changed pages, optional page tint, and lockable scene numbers (new scenes become 12A, 12B).
- Version history: named and daily automatic snapshots, with compare, view and restore.
- Writing stats, a daily word goal and sprint timer.

**Pagination and output**
- A real pagination engine: (MORE)/(CONT'D) across pages, sentence-boundary breaks, headings kept with the following text, and scene lengths in eighths.
- Native PDF export, plus print or save-as-PDF from the browser.
- Final Draft `.fdx` and Fountain import and export, and formatted plain text.
- Sides: just the pages for chosen scenes, with other scenes grayed out.

**Story tools**
- Index cards and outline: dragging a card reorders the scenes in the script.
- Beat board: free-form cards that can be sent to the script as scenes.

**Prep**
- Catalog of characters, locations and 18 breakdown categories, with photos and profile fields. It fills itself from the scripts.
- Breakdown: tag text in the script by category, then work from per-scene breakdown sheets (printable, CSV).
- Shot list with size, angle, movement, lens, duration and sound.
- Storyboard frames on the same shots: upload, take a photo, or draw a sketch.

**Production**
- Stripboard schedule: drag-and-drop strips, day breaks, banners, a boneyard and auto-schedule. Strips are colored INT/EXT by day/night, and CONTINUOUS scenes inherit day/night from the scene before.
- Day Out of Days report.
- Call sheets generated from the schedule, cast and crew.
- Budget with a chart of accounts, fringes, contingency and a top sheet. It can fill line items from the breakdown and schedule.
- Cast and crew directory.
- Reports covering scenes, characters, locations and elements, exportable to CSV or print.

## Your data

Everything is saved automatically in the browser's IndexedDB on the device you're using. Back up from **Projects → Back up all** or from a project's menu (**Export project backup**), and restore with **Import**. Backups include versions and images.

- Clearing the browser's site data deletes your projects.
- Two different browsers, or two devices, don't share projects. Move them with a backup file.
- **iPhone/iPad Safari:** Safari can erase a website's stored data after 7 days without a visit. Add Reelwright to the Home Screen (Home Screen apps are exempt) and keep backups.

## Known limitations

- No real-time collaboration and no cloud sync, because both need a server and accounts. Sharing is by exporting PDF, FDX, Fountain or backup files.
- Revision marks are per element, not per changed line. Deleting whole elements leaves no mark.
- Page locking (A/B pages) is not implemented; scene number locking is.
- The native PDF uses the standard Courier font, which covers Western European characters only; other scripts show as `?`. For those, use **Print → Save as PDF**, which uses the on-screen font.
- No import from PDF or from Celtx's own format. Export FDX or Fountain from Celtx and import that.
- Mobile typing has been tested in phone-sized Chromium emulation, not on physical iOS or Android keyboards.

## Code layout

| Path | Purpose |
| --- | --- |
| `js/formats.js` | Element definitions and page geometry for every script format |
| `js/editor.js` | The contenteditable block editor |
| `js/paginate.js` | Pagination engine (shared by editor markers, preview, PDF) |
| `js/pdf.js` | PDF writer |
| `js/io.js` | Fountain and Final Draft import/export |
| `js/model.js` | Data model, scene analysis, catalog |
| `js/production.js` | Shoot days, Day Out of Days |
| `js/store.js` | IndexedDB storage and backups |
| `js/views/*` | One file per screen |

The editor font is [Courier Prime](https://github.com/quoteunquoteapps/CourierPrime), used under the SIL Open Font License (`fonts/OFL.txt`).
