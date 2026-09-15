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
- A record's lifecycle shows as one badge coloured by meaning: green for won/signed/done, red for lost/cancelled, amber for on hold, accent for in progress.
- Relationships are links: the location bar shows the record's company ("in Globex"); record details list Company, Project, Opportunity and Note (meeting), or the origin chain (project) as links.
- Company 360 overview tiles answer "what's happening": contacts, open opportunities, active proposals, active projects, signed agreements, meetings (last date), and open tasks (with overdue). Each jumps to its section; commercial facts (MRR, retainer, agreement end) are in Key facts.

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

- `?` (or ⌘/) opens the shortcut sheet. Esc closes the company list first, then the dialog, then leaves a field, then the record.
- A dialog focuses its first field when it opens (not a company field, so its list doesn't cover the dialog) and returns focus to whatever opened it when it closes (`nav.ts`).
- Keyboard focus is always visible (`:focus-visible` outline); mouse clicks don't show it.
