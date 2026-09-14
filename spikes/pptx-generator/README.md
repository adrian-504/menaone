# Spike: generating proposals from the real PowerPoint templates

Sprint 0 question: can MENA One build a client proposal deck from the existing
templates, keeping only the slides it needs and filling in the client's details,
without PowerPoint or an Office library?

**Answer: yes.** The approach works on the real templates, and the output opens
cleanly in Microsoft PowerPoint for Mac. The blockers left are about the
templates themselves, not the technology.

## How it works

`src/main.rs` is about 300 lines of Rust with two crates (`zip`, `regex`). A `.pptx` file is a zip
archive of XML parts, so the generator:

1. Removes unselected slides from `ppt/presentation.xml` (the slide list and
   section lists) and from its relationships.
2. Drops links from kept slides that point at a removed slide.
3. Garbage-collects every part no longer reachable from the package root:
   removed slides, their notes and comments, and media only they used. It also
   drops their `[Content_Types].xml` entries and fixes the slide count in
   `docProps/app.xml`.
4. Fills placeholders paragraph by paragraph. PowerPoint often splits typed text
   into several runs (`'Client` + ` Name'`). The replacement goes into the first
   run, which keeps its formatting, and is removed from the others.

```bash
cargo run --release -- in.pptx out.pptx 6-11,47 "'Client Name'=Acme Test Co"
```

## What was tested

These runs used copies of the templates and a fictional client name.

| Test | Result |
|---|---|
| `Workforce Services Proposal Template.pptx`: all 24 slides, `'Client Name'` → `Acme Test Co (شركة أكمي للاختبار)` | 11 placeholders filled, including split ones. Opens in PowerPoint (no repair prompt), 24 slides, exports to PDF |
| `All Services Proposal Template.pptx`: keep the Workforce module (slides 6–11) and the back cover (47) | 47 → 7 slides, 98 unused parts removed (2.95 MB → 2.21 MB). Opens in PowerPoint, 7 slides, exports to PDF |
| Package check (every relationship resolves, every content-type entry exists, all XML parses) | Pass for both |
| Visual check of PDF pages | Fonts, layout and images intact; Arabic renders correctly inside English text; slide numbers renumber correctly (they are layout fields) |

Tooling in `verify/`: `check.applescript` opens a deck in PowerPoint, counts
slides and exports a PDF. A repair prompt would make it hang, so a timeout
counts as a failure. `render.swift` turns PDF pages into PNGs for review.

## Findings that shape Sprint 7 (proposal generator)

1. **There is no master deck yet.** `All Services Proposal Template.pptx` holds only
   the service modules. It has no cover, letter, agenda, Terms & Conditions,
   About MENA BIG or references; those exist only inside each single-service
   template. The generator needs one master that holds all of them (decision
   D6). Merging slides across files is possible but much harder: layouts, masters,
   themes and media would need de-duplicating. Keep everything in one file.
2. **Dates are typed, not placeholders.** Examples are "Sunday, 9th June 2024" on the cover and "Date: 16th of May 2024" on
   the letter, with "th" as a separate superscript run and a yellow highlight.
   The master needs explicit tokens such as `{{proposal_date}}`, with the ordinal written as its own
   token or dropped.
3. **Fixed-size text boxes overflow.** A long client name wraps into the "Logo"
   box on the cover. The master should set autofit (shrink text on overflow) on
   variable fields, and the app should warn on names above a set length.
4. **The agenda has typed page numbers** ("04, 12, 16"). After slides are removed they
   would be wrong. Either the generator recomputes them from the kept sections,
   or the agenda drops page numbers.
5. **The "Logo" and "Photos" boxes are image placeholders.** Filling them with the client
   logo means replacing a picture's image part: same technique, not built in
   this spike.
6. **Fee tables** (Project Fees, Package Deal) contain typed amounts in SAR. They
   need tokens per cell, or the generator writes the table rows itself from
   proposal lines. The second option needs table-row cloning, which is the next
   thing to prove.
7. **Arabic interface or right-to-left paragraphs** were not tested; Arabic words inside English
   paragraphs render correctly.

## Not verified

- PowerPoint for Windows. No Windows machine is available; the output only uses
  standard OOXML that the Mac version accepts without repair. Test on the first
  Windows install (Sprint 5).
- Keynote and Google Slides.
- `pptx-automizer` (Node) was not built. The Rust approach passed, it runs
  inside the existing Rust backend with no Node runtime to ship, and the
  remaining work (tokens, table rows, images) is plain XML either way.
