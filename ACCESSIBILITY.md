# Accessibility Statement (`ACCESSIBILITY.md`)

**DevPulse** (`https://devpulse.ritualdev.in`) is committed to meeting **Web Content Accessibility Guidelines (WCAG) 2.2 Level AA** across the Mission Control dashboard, analytics charts, modals, and public status/bug-report portals.

## Implemented Accessibility Practices

- **Keyboard Navigation & Shortcuts:**
  - Global Command Palette via `Cmd+K` / `Ctrl+K`.
  - Crash Issue Detail modal navigation via `j` / `k` (next/previous issue) and `Escape` to close.
  - All portal dialogs (`ModalShell`) trap modal semantics (`role="dialog"`, `aria-modal="true"`) and close cleanly on `Escape` or backdrop click.
- **Visual Contrast & Color Independence:**
  - Both high-contrast dark presets (`Obsidian`, `Tokyo Night`, `Nord`, `Dracula`) and light presets (`Minimal White`) maintain >= 4.5:1 text contrast.
  - Operational health, CVE severity, and Core Web Vitals ratings pair icons and text labels with colors (`0 CVEs`, `Good`, `Needs Improvement`, `Poor`) rather than relying on color alone.
- **Target Sizing & Sticky Header Safe Scrolling:**
  - Interactive icon buttons meet `>= 24x24` CSS pixel minimum hit areas.
  - Numeric KPI counters and tables use `tabular-nums` to prevent layout shift and reading jitter.

## Feedback & Support

If you encounter any keyboard barrier, contrast issue, or screen-reader compatibility bug, email **accessibility@ritualdev.in** or file a public report via `https://devpulse.ritualdev.in/report/ritual-core`.
