# UX conventions (Phase 3)

How MENA One's screens are meant to behave, as implemented. Use these when adding or changing a screen.

## Window

- macOS main window: native title bar in **Overlay** style with the title hidden (`tauri.conf.json`). The page runs to the top edge, so the sidebar and location bar form one surface with no separate title strip.
- The traffic lights stay at the system position. `main.ts` adds `mac-window-chrome` to `<html>` only inside the macOS app; the CSS moves the sidebar header onto the traffic-light line and leaves room for them when the sidebar is collapsed.
- Dragging: the sidebar header and location bar carry `data-tauri-drag-region="deep"` (buttons and links inside stay clickable), and a transparent 44px strip (`#window-drag-strip`) keeps the whole top edge draggable. Double-click zooms. Needs `core:window:allow-start-dragging`.
- A custom traffic-light position was tried and dropped: tao applies `trafficLightPosition` from a view that never redraws under the web view, and repositioning the buttons natively wasn't worth the fragility.

## Scrolling

- Record pages and lists scroll the **page** (the sidebar is fixed; the location bar and record section tabs are sticky).
- Tasks and Notes are workspaces (`main.workspace`): the page itself doesn't scroll; each pane (`.ws-side-scroll`, `.ws-scroll`, `.notes-list`, `.notes-doc-scroll`, the task panel) owns its own scrolling.
- The record rail list scrolls on its own inside its sticky card.
- Floating lists (company picker, context menus) scroll on their own with `overscroll-behavior: contain`. They close when anything *else* scrolls, never when they scroll themselves. (That was the mouse-wheel bug: a capture-phase `scroll` listener closed the list on its own scroll.)
- There are no wheel event handlers; scrolling is native everywhere.

## Pages and records

- List pages: `page-header` with the title, a subtitle, and actions on the right. The primary action is `btn-primary` with a plus icon and "New <record>" (sentence case).
- Record pages share `rec-header`: an icon or avatar, an eyebrow with the record type, the title, and badges (status first). Actions sit on the right: **New** (a menu), Edit, and "…" for the rest.
- Status colours have one meaning everywhere, and `src/lib/statusTone.ts` is their only source: green done (won, signed, completed, active service), red ended badly (lost, cancelled), amber waiting or at risk (with the client, on hold, at risk), accent moving (in progress, being prepared), muted not started or ended. `ST`, `AGR_ST`, project dots and status charts all take the status's tone, so a status has the same colour in every list, header and chart. The project header shows status only in its editable field.
- Record headers: the title is in `--text`; the eyebrow, meta line and every badge after the first are muted. The header's primary status (the first toned badge in `.rec-badges`) is the only pill; elsewhere a status is a coloured dot and plain text (`.rec-badge` in a list, `statusDot()`).
- Relationships are links: the location bar shows the record's company ("in Globex"); record details list Company, Project, Opportunity and Note (meeting), or the origin chain (project) as links.
- Company 360 overview tiles answer "what's happening": contacts, open opportunities, active proposals, active projects, signed agreements, meetings (last date), and open tasks (with overdue). Each jumps to its section; commercial facts (MRR, retainer, agreement end) are in Key facts.

## Lists

- List pages share one toolbar (`.toolbar` / `.fbar`): segmented view filter where it helps, selects, search (placeholders end in "…"), and a count on the right. Meetings has All / Upcoming / Past plus search by title, company or attendee.
- The opportunity board collapses empty stages into slim labelled strips so stages with opportunities fit without scrolling sideways; while a card is dragged, the strips widen again as drop targets.
- At the minimum window size (1080×680) no page scrolls sideways, and every creation dialog fits or scrolls with its Create button reachable.

## Colour and contrast

- Colours are written only as tokens. Raw hex values live in `:root` and the `[data-theme]` blocks of `styles.css`, nowhere else (`styleTokens.test.ts` fails on any other). Components use tokens: `--on-accent` for text on a filled colour, `--hover` for every hover tint, the five tones for status, file-kind and WhatsApp colours for those marks.
- There is no orange: waiting and at-risk are amber. The violet `--accent-2` is for charts only.
- `--muted` (dates, captions, secondary details) is at least 4.5:1 against `--bg`, `--surface`, `--surface-2`, `--surface-flat` and the sidebar in every theme (the test checks it); `--sub` stays darker than `--muted` so the two text levels remain distinct.

## Surfaces

- One page surface: `--bg` equals `--surface`, and the tint belongs to the sidebar (`--sidebar-bg`).
- A section of a page is `.sec`: a top hairline (`--hairline`) and a heading, with no box, shadow or radius. Sections side by side (`.rec-grid-2`, the overview, Analytics) sit in columns with a wide gutter; the right-hand column of a record page and My Day's rail are separated by a hairline.
- `.card` is only for things that float above the page: popovers, menus, dialogs. The record rail keeps its own floating panel.
- No card inside a card: figures (record stats, My Day's Business) sit on the page without tiles and highlight with `--hover`.

## Buttons

- Four variants: `btn-primary` (one per view), `btn-secondary` (outlined), `btn-ghost` (no border, quiet row actions), `btn-danger` (red outline, fills on hover). `.btn-sm` is the only size modifier and combines with any of them. Disabled buttons fade.
- One primary per view: row actions in lists are secondary. On a meeting, Join Teams is the primary action.

## Themes

- Light, Dark, Auto and Graphite. Auto follows the Mac's appearance and switches with it (`src/core/theme.ts` sets `data-theme` to light or dark). Sepia, Ocean and Forest were retired; anyone on one moved to Light. The View → Theme menu lists the same four.

## Creating records

- One list of create actions per open record (`src/core/contextActions.ts`) feeds three places: the record header's **New** menu, the sidebar **+ New** menu, and the command palette.
- Dialogs: titles read "New meeting" / "Edit meeting"; the submit button reads "Create meeting" / "Save changes"; Cancel is always the secondary button.
- Required fields end in `*`; optional fields carry no marker. Hints stay only where they explain the format.
- Context prefills the dialog (see `docs/work-graph.md`) and can always be changed. After creating from a record, the new record opens through the router.

## Company fields

- Every field that names a company uses the shared picker (`attachCompanySelector`), never a `<datalist>`. It lists every matching company (names starting with the query first) plus "+ Create", and works with ↑ ↓ Enter Esc.
- The company id sent on save follows `companyFromForm`: kept while the field still shows the context's company; a different name is an explicit reassignment.

## States

- Loading: `loadInto()` shows skeletons while a list loads. If a first load fails, it shows "Couldn't load … / Try again"; if a refresh fails, the old list stays and an error toast appears. Used by Meetings, Projects and Opportunities.
- Empty: `emptyState()` with what to do next and, where it fits, a "New …" action.
- Saves: failures show an error toast (`persist.ts`); reversible deletes offer Undo; irreversible ones use `showConfirm`.
- Deleted records: the router drops back to the module list instead of showing a stale page.

## Keyboard and focus

- ⌘1–⌘9 open the first nine modules in the sidebar, top to bottom (modules hidden until Microsoft 365 is connected are skipped).
- `?` (or ⌘/) opens the shortcut sheet. Esc closes the company list first, then the dialog, then leaves a field, then the record.
- A dialog focuses its first field when it opens (not a company field, so its list doesn't cover the dialog) and returns focus to whatever opened it when it closes (`nav.ts`).
- Keyboard focus is always visible (`:focus-visible` outline); mouse clicks don't show it.
