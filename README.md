# EngCalc — Engineering Toolkit for Students

A frontend-only web toolkit of interactive engineering calculators, built from real coursework problems. No backend, no build step — open `index.html` and it runs.

**Live demo:** _add your deployed link here (GitHub Pages / Netlify / Vercel)_

## Why this exists

Built while working through EM and circuits coursework — the tools that existed either buried the intuition behind a plain number output, or needed an account and a backend for something that's pure math. EngCalc keeps everything client-side and visual: you see *why* the answer is what it is, not just the answer.

## Tools

| Tool | Status | What it does |
|---|---|---|
| RLC Resonance Solver | ✅ Live | Live impedance-vs-frequency curve for series/parallel RLC circuits — resonant frequency, Q factor, and bandwidth update as you adjust R, L, C |
| BJT Bias Point Calculator | 🚧 In progress | Q-point and load-line visualizer for a common-emitter stage |
| Coulomb's Law Field Visualizer | 🚧 In progress | Place charges on a canvas, see the field lines update live |

## Tech stack

- Vanilla HTML / CSS / JavaScript — no framework, no build tooling
- Native SVG rendering for live graphs (no charting library dependency)
- Fully responsive, keyboard-accessible, respects `prefers-reduced-motion`

## Running locally

No install needed:

```bash
git clone <your-repo-url>
cd engcalc
open index.html   # or just double-click it
```

Or serve it (needed for some browsers' stricter local-file policies):

```bash
python3 -m http.server 8000
# visit http://localhost:8000
```

## Project structure

```
engcalc/
├── index.html      # everything: markup, styles, and logic for all tools
└── README.md
```

Single-file by design for this hackathon submission — trivial to deploy anywhere that serves static files.

## Roadmap

- [ ] BJT Bias Point Calculator
- [ ] Coulomb's Law Field Visualizer
- [ ] Export graph as PNG
- [ ] Shareable permalink (encode circuit values in URL)

## Built for

Frontend Web Development Hackathon 2026 (SkillValix) — Student Utilities category.

## License

MIT
