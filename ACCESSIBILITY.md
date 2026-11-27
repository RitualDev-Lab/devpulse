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
  - Dashboard routes use `scroll-padding-top: 4.5rem` (WCAG 2.4.11 Focus Not Obscured) and explicit `:focus-visible` outlines (WCAG 2.4.13).
- **Accessible Charts & Tables (`ChartTableToggle`):**
  - Core analytics and package velocity charts define lifted dark-mode `oklch` series tokens (`--chart-1..5`, >= 3:1 non-text graphical contrast per WCAG 1.4.11), provenance badges (`Source`, `Window`, `Estimated`), and keyboard-accessible **Show Chart / Show Table** toggles.

## VPAT Summary Status
- Desktop (`1280x800`), mobile (`390x844`), and enlarged zoom viewports verified via automated Chromium layout checks (`scrollWidth <= innerWidth`, zero unhandled console errors).
- Continuous improvements track full keyboard & screen-reader parity across interactive charts and slide-over panels.

## Feedback & Support

If you encounter any keyboard barrier, contrast issue, or screen-reader compatibility bug, email **accessibility@ritualdev.in** or file a public report via `https://devpulse.ritualdev.in/report/ritual-core`.
