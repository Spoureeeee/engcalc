# EngCalc — Engineering Toolkit for Students

A frontend-only web toolkit of interactive engineering calculators, built from real coursework problems. No backend, no build step — open `index.html` and it runs.

**Built by spouree** for the Frontend Web Development Hackathon 2026.

**Live demo:** [_add your deployed link here (GitHub Pages / Netlify / Vercel)
](https://spoureeeee.github.io/engcalc/)
<!--
  TODO before submission: replace the three placeholders below with real
  screenshots (or swap this section for one GIF of the Field Visualizer in
  action). Save images into /screenshots and point the paths below at them.
  Suggested shots: RLC graph mid-resonance, BJT in Saturation with the
  concept explainer open, and the Field Visualizer with a few charges placed.
-->
![RLC Resonance Solver screenshot](screenshots/rlc.png)
![BJT Bias Point Calculator screenshot](screenshots/bjt.png)
![Coulomb's Law Field Visualizer screenshot](screenshots/field.png)

## The thing that makes this different

Most calculators give you a number and stop. Every tool in EngCalc has a **"Why does this happen?"** panel that reads your *actual* numbers — not a generic textbook example — and explains them in plain English. Push the RLC filter into a low-Q setup and it tells you why that's now a broad, damped response instead of a sharp peak. Push a BJT into Saturation and it explains, using your real resistor values, exactly why it collapsed there. That's the core idea: not just compute the answer, explain the specific answer you got.

## Why this exists

This came directly out of an Electricity and Magnetism module (MMU Foundation in Engineering, T2610 AFP1164) that covers exactly these three topics — Coulomb's Law, RLC resonance, and BJT bias analysis. The tools that existed for that coursework either buried the intuition behind a plain number output, or needed an account and a backend for something that's pure math. EngCalc keeps everything client-side and visual, and it's built so it can be used to double-check hand-worked homework before submission — plug in the same R/L/C or resistor-divider values from a problem set and see whether the number (and, more importantly, the *reasoning*) matches.

## Tools

| Tool | What it does |
|---|---|
| **RLC Resonance Solver** | Live impedance-vs-frequency curve for series/parallel RLC circuits — resonant frequency, Q factor, and bandwidth update as you adjust R, L, C. The live explainer reads your actual Q factor and explains what it means (sharp/selective vs. broad/damped). |
| **BJT Bias Point Calculator** | Q-point and load-line visualizer for a voltage-divider-bias stage — switch between **Common-Emitter**, **Common-Collector (Emitter Follower)**, and **Common-Base**. Region badge (Active / Saturation / Cutoff) updates live, with an explainer that reads your specific numbers and explains why the transistor landed in that region. |
| **Coulomb's Law Field Visualizer** | Place charges on a canvas — drag, keyboard-move, or delete them — and watch a live vector field with a field-strength glow layer update in real time. Hover anywhere to read the exact field magnitude and direction at that point. |

Every tool also has: real-world presets, a shareable permalink (encodes your exact setup into the URL), a print/export report view, PNG export of the graph, and a "Reset to defaults" button that's clearly marked as the active state until you change something.

## Accessibility

- ARIA live regions announce dynamic readouts (RLC/BJT parameter outputs, the field visualizer's live hover-probe values) so screen reader users get the same updates sighted users see
- Full keyboard support for the Field Visualizer: tab to a charge, arrow keys to move it, Delete to remove it, plus a dedicated "Add charge" button as a keyboard-accessible entry point (placing a charge isn't mouse-only)
- Respects `prefers-reduced-motion`
- Light/dark theme toggle, including every hand-drawn SVG graph re-coloring correctly, not just the page chrome

## Tech stack

- Vanilla HTML / CSS / JavaScript — no framework, no build tooling
- Native SVG rendering for every graph and visualization (no charting library dependency)
- Field Visualizer redraws are batched with `requestAnimationFrame` — dragging or hovering a charge updates in-memory state immediately, but the actual redraw (recomputing the ~1,248-cell field-strength heatmap plus the direction-arrow grid) is deferred to the next animation frame with an "already scheduled" guard, so any number of raw mouse events between frames collapse into a single redraw instead of one full redraw per event

## Running locally

No install needed:

```bash
git clone <your-repo-url>
cd engcalc
open index.html   # or just double-click it
```

Or serve it (needed for some browsers' stricter local-file policies, and required for the print/export feature to work correctly):

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

## Project structure

```
engcalc/
├── index.html      # markup only
├── style.css       # all styling
├── app.js          # all logic for all three tools
└── README.md
```

No build step — deploys anywhere that serves static files.

## Model limitations (in the interest of honesty)

- The parallel RLC model is ideal — it doesn't account for inductor winding resistance (ESR), which in a real coil would damp the peak and lower the effective Q somewhat versus what's shown
- BJT bias equations use a fixed V_BE = 0.7V, not a temperature-dependent model

## Roadmap

- [x] Export graph as PNG
- [x] More BJT topologies (Common-Collector, Common-Base)
- [ ] Unit toggle for RLC (Hz/kHz, mH/µH)

## Built for

Frontend Web Development Hackathon 2026 (SkillValix) — Student Utilities category.

## License

MIT

