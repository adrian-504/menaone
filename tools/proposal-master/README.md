# MENA BIG Proposal Master 2026

Builds `MENA BIG Proposal Master 2026.pptx` — every service's proposal slides in the 2026 design (Aptos, MENA BIG palette), tagged for MENA One's generator. Pure Python 3 standard library.

```
python3 build.py --assets "<folder with the 2026 redesign decks>" --out "MENA BIG Proposal Master 2026.pptx"
```

The assets folder is `MENA BD 2026/Proposals Templates/2026 Proposal Template` (or a copy): the logos, cover photo and reference logos are read from `Admin_PRO_proposal_MENA_BIG_redesign.pptx` and `MENA_BIG_Busines_Setup_Template.pptx`. MENA One looks for the master in `Proposals Templates/` (next to `Proposals New Logo/`) or at `app_meta.proposal_master_path`.

- `pptxkit.py` — OOXML writer: master, layouts (Cover, Content, Content with side panel, Section, Service divider, Back cover), theme, slides, real tables, notes.
- `design.py` — palette, type sizes, text measurement and components (eyebrow + title, numbered lists, panels, chips, stats, fee tables).
- `shared.py` — cover, letter, agenda, section dividers, general terms, acceptance, about, references, back cover.
- `modules_admin.py`, `modules_services.py`, `modules_people.py` — one function per service module.

**Tags** (speaker notes): `[always]`, `[module: <key>]` (keys as in `src-tauri/src/proposal_library.rs`), `[role: cover|letter|agenda|section-approach|section-terms|section-about|divider|approach|fees|expenses|terms|acceptance|about|references|back]`, `[when: recruitment|term12|term_short]`. Slides with `[role: terms]` are placed in the Terms section.

**Fields**: `{{client_name}}`, `{{proposal_date}}`, `{{services_title}}`, `{{entity_region}}`, `{{client_country_line}}`, `{{term}}`, `{{term.words}}`, `{{page.approach|terms|about}}`; on fee slides `{{row.label}}`, `{{row.price}}`, `{{row.percent}}` (the table row repeats per priced row), `{{fee.price}}`, `{{fee.total}}`, `{{constitution.price}}`, `{{bundle.package|constitution|maintenance|without|with|savings}}`, `{{wf.m1}}/{{wf.r1}}/{{wf.m2}}/{{wf.r2}}`, `{{accountancy.projects_note}}`, `{{recruitment.staff_note}}` (a paragraph whose only content is an empty field is removed).

Content rule (owner): terms, durations, percentages and penalties come from the templates in use (`Proposals New Logo`); where the 2026 redesign differs, the current templates win.
