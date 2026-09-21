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

## Focus

Every page tells you where to look. The owner's test: opening any page should never feel like being handed a form; anyone should know at once where their eyes go. If something already shipped makes a page busier than it needs to be, it goes.

1. **Three levels, no more.** One thing to look at first (a record's title and status line; My Day's next item; a create page's first empty field). Then what supports it, as read-only text and links. Everything else is collapsed, on hover, or behind "…" / Edit.
2. **Read first, edit on demand.** Facts read as text (`src/lib/propsList.ts`). Clicking a value — or Enter on it — turns that row into its control; it saves through the page's usual path with the same "Saved" flash; Esc puts the old value back; leaving the row returns it to text. Each Details section has **Edit**, which shows every field as the form (empty ones too; they aren't shown while reading). No input stays open on a record page unless typing is its whole purpose (notes, a review comment that's due now, the meeting's action-item line).
3. **One blue button per screen** — what you most likely came to do. Everything else is secondary, ghost, or in "…". A dialog is its own screen.
4. **Nothing that is both empty and non-actionable.** No dash columns or rows, no "Not yet", no "choose X to see Y" panels, no empty-state sentence for something that isn't the page's job. An empty section is one line with its action, or not there.
5. **Row actions appear on hover or focus** (faded, not hidden, so Tab reaches them) and stay in the row's "…". My Day's attention rows keep their one main action visible.
6. On a record page the first thing is never an empty box asking to be filled: an empty Description is one quiet "Add a description" line, and Next action leads the opportunity. My Day's rail stays quieter than the day: six recent entries, then "Show more".
7. **The squint test:** if you can't tell in a second where to look, the page fails. `npm run focus-check` counts, per view at 1440×900 before scrolling, the inputs, buttons and blue buttons, and fails above one blue button, on a select in a list row, when an empty text box comes first (boxes marked `data-typing`, like a review comment that's due, are exempt), or over a page's targets.

## Pages and records

- List pages: `page-header` with the title, a subtitle, and actions on the right. The primary action is `btn-primary` with a plus icon and "New <record>" (sentence case).
- Record pages share `rec-header`: an icon or avatar, an eyebrow with the record type, the title, and badges (status first). Actions sit on the right: **New** (a menu), Edit, and "…" for the rest.
- Status colours have one meaning everywhere, and `src/lib/statusTone.ts` is their only source: green done (won, signed, completed, active service), red ended badly (lost, cancelled), amber waiting or at risk (with the client, on hold, at risk), accent moving (in progress, being prepared), muted not started or ended. `ST`, `AGR_ST`, project dots and status charts all take the status's tone, so a status has the same colour in every list, header and chart. The project header shows status only in its editable field.
- Record headers: the title is in `--text`; the eyebrow, meta line and every badge after the first are muted. The header's primary status (the first toned badge in `.rec-badges`) is the only pill; elsewhere a status is a coloured dot and plain text (`.rec-badge` in a list, `statusDot()`).
- Relationships are links: the location bar shows the record's company ("in Globex"); record details list Company, Project, Opportunity and Note (meeting), or the origin chain (project) as links.
- The thread strip sits under the header of opportunity, proposal, agreement and project pages (`threadStrip.ts`, `tabs/recordThread.ts`). Every step keeps its name (Opportunity, Proposal, Agreement, Project) — it is the last thing to go. The open record shows only its step name, highlighted and not a link (the header already has its title); other steps show name and label as a link, the label cut at about 32 characters with the full text on hover; missing steps show only their muted name, the first one carrying the next action (a small ghost button). Gaps read "11d · with client", amber only when late; steps dated out of order show the line with no number. The strip wraps to a second line rather than cutting labels short, never scrolls sideways, and has no panel of its own on any page; a missing step that would sit alone on the second line is left out. On a record's own page the strip doesn't repeat the header's next step. Nothing shows for a lone record with nothing next. Tab reaches every link and the button.
- One timeline per record (`timeline.ts`): what happened above a red "Now" line, what's coming below it, overdue first and in red, undated under "No date". The last 15 past rows, with "Show earlier"; the future is never cut. At most one inline action per row (complete a task, mark a promise kept). Opportunity and project pages show the whole engagement (every record on the thread) with "+ Log note" in its header; the timeline replaces their Activity section and sits near the top — under Next action on the opportunity, first on the project. Proposal and agreement pages use it in place of Activity (the proposal keeps its stage rail and its Notes box, whose notes stay out of the timeline). Company and contact pages keep their activity feeds; My Day shares the Now line.
- No empty boxes (`sectionLayout.ts`): on opportunity, project, meeting and company pages a section with nothing in it collapses to its heading, "None yet" and its "+ New", and sinks below the sections with content (which keep their order); clicking "None yet" opens it. The opportunity page is one column: Description, Next action (the next open task as a link, or the text box when there is none) and the timeline first; then sections with content, Files last among them; then the empty ones. List rows on these single-column pages are hairline rows. It has no Proposal or Project sections — the strip links them and offers to create them.
- Company 360 is a briefing, not a count of what exists. Under the header, up to five plain clauses say where we stand (`lib/companyBrief.ts`), each only when it has something to say: the relationship and commercials (client since, services, monthly value, agreement end and its notice date); what's in flight — the count, naming only what is with us or late (the meeting page's brief spells each one out); contact rhythm (last meeting, last email, next meeting — amber when an active client has had neither for over 45 days); who owes what (with overdue tasks); and pinned notes, verbatim. Every name and number in them is a link. Then Open threads — one line per live engagement: its label, where it stands, who it's waiting on (amber when late) and its next step on hover; the row opens the record, where the full strip is. Five, then "Show all". Engagements with nothing dated for 120 days are dormant: one line, "N dormant — review in Clean-up". Then People (decision makers first, then by last contact; with nobody yet, one quiet line at the bottom), the timeline, Company notes, and "All records" — the full sections, collapsed under one heading with their counts (open or closed is remembered). The section bar is short — Overview, People, Timeline, Notes, All records. Key facts live in the edit panel under the header (Edit); industry, owner, location and website are in the header.
- The Brief (header "Brief", or ⌘K "Brief <company>") is one read-only page of the same facts — the clauses (without "in flight", since the open threads follow), open threads, people, open commitments both ways, and the next meeting when there is one — that prints on its own in Light.
- "Decision maker" is the only contact tag, set from the contact's "…" menu on Company 360 or on the contact page; everything else about a person comes from their job title.

## Lists

- List pages share one toolbar (`.toolbar` / `.fbar`): segmented view filter where it helps, search (placeholders end in "…"), at most two filters (the two used most), and a count on the right. Any other filters sit behind one **Filters** button that counts those in use (`src/lib/filterBar.ts`); Clear appears when anything is set. The period select stays in the page header. Meetings has All / Upcoming / Past plus search by title, company or attendee.
- List rows are read, not edited: a status is a dot and text; right-click the row, or its "…" (on hover or focus), to change it — or do it on the record's page. `focus-check` fails on a select in a list row.
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
- One primary per view: row actions in lists are secondary and appear on hover. On a meeting, Join Teams is the primary action. On a proposal, the header's next step is the primary; a single contextual document button (Open PowerPoint, or Generate proposal while drafting) sits beside it, the other tools in "…"; the review's Approved is a green secondary.

## Themes

- Light, Dark, Auto and Graphite. Auto follows the Mac's appearance and switches with it (`src/core/theme.ts` sets `data-theme` to light or dark). Sepia, Ocean and Forest were retired; anyone on one moved to Light. The View → Theme menu lists the same four.

## Commitments

- In any notes text, a line starting `>>` is something we promised the client (it gets a task), `<<` something the client promised us (tracked, no task). List markers and checkboxes in front are fine; `- [x] >> …` is already kept. Dates are read like task quick-add ("by Thu", "30 Sep", "tomorrow", "end of month"). The hint is in the Decisions and Follow-up placeholders, the New commitment dialog and the `?` sheet.
- `>>` lines stay as typed in the editor (not a quote), and Enter after one starts a plain line.
- A commitment row: → we owe / ← they owe (with the words for screen readers), the text, who, the due date (red once late), where it came from, a checkbox for kept, "…" for Edit, Drop (asks why), Reopen, Open source, Delete. Open ones first; kept and dropped fold under one line. A section with none is hidden.
- Opportunity: Waiting on Us / Them / —, since when (kept while the side stays the same), one line for what. A client's open promise is offered as a suggestion, never set by itself. Lists and the board show "Waiting on client · Nd" or "With us · Nd" instead of "Stalled".

## Creating records

- One list of create actions per open record (`src/core/contextActions.ts`) feeds three places: the record header's **New** menu, the sidebar **+ New** menu, and the command palette.
- Dialogs: titles read "New meeting" / "Edit meeting"; the submit button reads "Create meeting" / "Save changes"; Cancel is always the secondary button.
- Required fields end in `*`; optional fields carry no marker. Hints stay only where they explain the format.
- Required fields come first; optional ones wait behind **More details** (`src/lib/moreDetails.ts`) unless the context already filled one, in which case they're shown. Create is reachable at 1080×680.
- New proposal is one screen at 1440×900: the eye lands on Company; one Create button, in the header; no list beside it. Services by search (↑ ↓ Enter) plus the five used most, "Browse all services" for the catalogue; chosen services show only as lines. Entity/currency and the workflow defaults are one line each with Change. Opportunity and contact appear once there's a company; the summary once there's a client or a service; the folder as one line.
- The list beside a record is closed unless you open it (its toggle, or ⇧⌘\\; ⌘\\ stays the sidebar's), and never beside a create page.
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
