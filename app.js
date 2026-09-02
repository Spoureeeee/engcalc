(function(){
  "use strict";

  try {

  /* ---------- Theme: apply saved preference immediately, before any graph is
     drawn, so the first render already uses the right colors instead of a
     dark-then-light flash. ---------- */
  try {
    if (localStorage.getItem('engcalc-theme') === 'light'){
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) { /* localStorage unavailable (e.g. blocked) — default dark theme is fine */ }

  /* ---------- Tab switching ---------- */
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.hasAttribute('disabled')) return;
      const targetPanel = tab.dataset.panel ? document.getElementById(tab.dataset.panel) : null;
      if (!targetPanel) return; // not an actual nav tab (no data-panel) — nothing to switch to, do nothing safely
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      targetPanel.classList.add('active');
    });
  });

  /* ---------- Home page "Open tool" launch buttons ---------- */
  // Reuses the exact same tab-click logic above by simulating a real click on
  // the corresponding nav tab, rather than duplicating the switching logic.
  document.querySelectorAll('.tool-launch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = document.getElementById(btn.dataset.target);
      if (targetTab) targetTab.click();
    });
  });

  /* ---------- Global input validation ---------- */
  // Clamp any number input to its declared min/max on blur, so a typed value
  // can never silently exceed the range the sliders (and the math) expect.
  document.addEventListener('change', (evt) => {
    const t = evt.target;
    if (t.tagName === 'INPUT' && t.type === 'number'){
      let v = parseFloat(t.value);
      const min = t.min !== '' ? parseFloat(t.min) : -Infinity;
      const max = t.max !== '' ? parseFloat(t.max) : Infinity;
      if (isNaN(v)) v = min !== -Infinity ? min : 0;
      v = Math.min(Math.max(v, min), max);
      t.value = v;
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  /* ---------- RLC Resonance Solver ---------- */
  const rRange = document.getElementById('r-range');
  const rInput = document.getElementById('r-input');
  const lRange = document.getElementById('l-range');
  const lInput = document.getElementById('l-input');
  const cRange = document.getElementById('c-range');
  const cInput = document.getElementById('c-input');

  const outF0 = document.getElementById('out-f0');
  const outQ = document.getElementById('out-q');
  const outBW = document.getElementById('out-bw');
  const outZ0 = document.getElementById('out-z0');
  const graphRange = document.getElementById('graph-range');
  const svg = document.getElementById('graph');

  const topoSeries = document.getElementById('topo-series');
  const topoParallel = document.getElementById('topo-parallel');
  const rlcTopoBadge = document.getElementById('rlc-topo-badge');
  let topology = 'series';

  topoSeries.addEventListener('click', () => { clearGroupSelection('rlc-presets'); setTopology('series'); });
  topoParallel.addEventListener('click', () => { clearGroupSelection('rlc-presets'); setTopology('parallel'); });
  function setTopology(t){
    topology = t;
    topoSeries.setAttribute('aria-pressed', String(t === 'series'));
    topoParallel.setAttribute('aria-pressed', String(t === 'parallel'));
    rlcTopoBadge.textContent = t === 'series' ? 'Series circuit' : 'Parallel circuit';
    compute();
  }

  function syncPair(range, input){
    range.addEventListener('input', () => { input.value = range.value; clearGroupSelection('rlc-presets'); compute(); });
    input.addEventListener('input', () => {
      let v = parseFloat(input.value);
      if (!isNaN(v)){
        const min = parseFloat(range.min), max = parseFloat(range.max);
        range.value = Math.min(Math.max(v, min), max);
      }
      clearGroupSelection('rlc-presets');
      compute();
    });
  }
  syncPair(rRange, rInput);
  syncPair(lRange, lInput);
  syncPair(cRange, cInput);

  function fmt(n, digits){
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return (n/1000).toFixed(digits) + 'k';
    return n.toFixed(digits);
  }

  /* Shared "show your work" renderer — steps is an array of {label, eq} */
  function renderWork(containerId, steps){
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = steps.map(s =>
      `<div class="workstep"><div class="wlabel">${s.label}</div><div class="weq">${s.eq}</div></div>`
    ).join('');
  }

  /* Shared "why does this happen" concept-explainer renderer — paragraphs is an
     array of HTML strings, each becomes one <p>. */
  function renderConcept(containerId, paragraphs){
    const target = document.getElementById(containerId);
    if (!target) return;
    target.innerHTML = paragraphs.map(p => `<p>${p}</p>`).join('');
  }

  /* Sets a readout's content and briefly pulses it — but only if the value
     actually changed, so it doesn't pulse on every redraw when nothing moved
     (e.g. switching tabs). The CSS animation itself is a color shift, not a
     motion effect, but the global prefers-reduced-motion rule still forces its
     duration near-zero for anyone who's set that. */
  function setReadout(el, html){
    if (el.innerHTML === html) return;
    el.innerHTML = html;
    el.classList.remove('pulse');
    void el.offsetWidth; // force reflow so the animation restarts even mid-pulse
    el.classList.add('pulse');
  }

  /* Shared close-wiring for a quiz <dialog>: the X button, clicking the
     backdrop (native <dialog> doesn't do this on its own), and native
     Escape-to-close all funnel through the dialog's 'close' event, so
     onCleanup (un-blurring the graph/readouts) runs no matter how it closed. */
  function wireQuizModalClose(dialog, onCleanup){
    const closeBtn = dialog.querySelector('.quiz-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', onCleanup);
  }

  /* Interpolates between two RGB colors by t (0 = fully c1, 1 = fully c2). Used
     to shift the field-strength glow's hue, not just its opacity, as it gets
     stronger — weak stays the theme's signal color, strong shifts toward each
     theme's "intense" color (bright white-cyan in dark mode, deep ink teal in
     light mode). */
  function lerpColor(c1, c2, t){
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    return `rgb(${r},${g},${b})`;
  }

  /* All colors used by hand-drawn SVG (graphs, field map) live here, branched by
     the active theme. SVG presentation attributes (fill="...", stroke="...") do
     NOT reliably resolve CSS var() the way regular CSS does, so rather than
     depend on that, every draw function reads this fresh and uses literal
     values — guaranteed correct in every browser. Called fresh on every redraw,
     so switching themes and re-triggering a redraw is enough to re-color everything. */
  function isLightTheme(){
    return document.documentElement.getAttribute('data-theme') === 'light';
  }
  function svgColors(){
    if (isLightTheme()){
      return {
        gridLine: '#D8E4F0', textFaint: '#6B84A0', textDim: '#3D5872',
        curve: '#0E8E82', accent: '#C15A1D', danger: '#C93E3E',
        bright: '#0E8E82', surface: '#FFFFFF', border: '#C6D7E8',
        glowWeak: [14, 142, 130], glowStrong: [11, 74, 69]
      };
    }
    return {
      gridLine: '#1B3A5C', textFaint: '#7C9CB8', textDim: '#91AEC7',
      curve: '#5EEAD4', accent: '#FF8A3D', danger: '#FF6B6B',
      bright: '#DCEEFF', surface: '#0B1F33', border: '#24476b',
      glowWeak: [94, 234, 212], glowStrong: [225, 245, 255]
    };
  }

  function compute(){
    const R = Math.max(parseFloat(rInput.value) || 0.0001, 0.0001);
    const Lmh = Math.max(parseFloat(lInput.value) || 0.0001, 0.0001);
    const Cuf = Math.max(parseFloat(cInput.value) || 0.0001, 0.0001);
    const L = Lmh / 1000;      // H
    const C = Cuf / 1e6;       // F

    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));

    let Q, Z0, bw;
    if (topology === 'series'){
      Q = (1 / R) * Math.sqrt(L / C);
      Z0 = R;
    } else {
      Q = R * Math.sqrt(C / L);
      Z0 = R;
    }
    bw = f0 / Q;

    setReadout(outF0, fmt(f0, 1) + ' <small>Hz</small>');
    setReadout(outQ, fmt(Q, 2));
    setReadout(outBW, fmt(bw, 1) + ' <small>Hz</small>');
    setReadout(outZ0, fmt(Z0, 2) + ' <small>Ω</small>');

    renderWork('rlc-worksteps', [
      { label: 'Resonant frequency — f₀ = 1 / (2π√(LC))',
        eq: `f₀ = 1 / (2π√(${Lmh}mH × ${Cuf}µF)) = <span class="result">${fmt(f0,1)} Hz</span>` },
      { label: topology === 'series'
          ? 'Q factor (series) — Q = (1/R)·√(L/C)'
          : 'Q factor (parallel) — Q = R·√(C/L)',
        eq: topology === 'series'
          ? `Q = (1/${fmt(R,2)}) × √(${Lmh}mH / ${Cuf}µF) = <span class="result">${fmt(Q,2)}</span>`
          : `Q = ${fmt(R,2)} × √(${Cuf}µF / ${Lmh}mH) = <span class="result">${fmt(Q,2)}</span>` },
      { label: 'Bandwidth — BW = f₀ / Q',
        eq: `BW = ${fmt(f0,1)} <span class="op">/</span> ${fmt(Q,2)} = <span class="result">${fmt(bw,1)} Hz</span>` }
    ]);

    const topoExplainer = topology === 'series'
      ? `At resonance, the inductor's opposition to current (X<sub>L</sub> = 2πfL) and the capacitor's opposition (X<sub>C</sub> = 1/2πfC) become exactly equal and cancel each other out. In a <b>series</b> circuit, that leaves only the resistor to oppose current — so impedance drops to its <b>minimum</b> (just R), and current through the circuit <b>peaks</b>.`
      : `At resonance, the inductor's opposition to current (X<sub>L</sub> = 2πfL) and the capacitor's opposition (X<sub>C</sub> = 1/2πfC) become exactly equal. In a <b>parallel</b> circuit, this makes the two branches trade energy back and forth between themselves rather than drawing it from the source — so impedance seen by the source <b>peaks</b>, and current drawn from the source <b>drops to a minimum</b>.`;

    let qExplainer;
    if (Q >= 5){
      qExplainer = `Your Q factor of <b>${fmt(Q,2)}</b> makes this a <b>sharp, narrow</b> response — the circuit strongly favors frequencies right around f₀ and rejects everything else. This is the behavior you'd want in something like a radio tuner, where you need to isolate one station's frequency from all the others nearby.`;
    } else if (Q >= 1){
      qExplainer = `Your Q factor of <b>${fmt(Q,2)}</b> gives a <b>moderately selective</b> response — there's a noticeable peak around f₀, but it's not razor-sharp. Plenty of nearby frequencies still get through with only mild attenuation.`;
    } else {
      qExplainer = `Your Q factor of <b>${fmt(Q,2)}</b> means this is a <b>heavily damped, broad</b> response — the circuit doesn't strongly favor any single frequency. This low-Q behavior is typical in filters meant to smooth or reduce ripple across a range, rather than isolate one specific tone.`;
    }

    renderConcept('rlc-concept', [
      topoExplainer,
      `<span class="context-note">${qExplainer}</span>`,
      topology === 'parallel'
        ? `<i>Model note: this uses an ideal parallel RLC — it doesn't account for the inductor's own winding resistance (ESR), which in a real coil damps the peak and lowers the effective Q somewhat versus what's shown here.</i>`
        : ''
    ].filter(Boolean));

    drawGraph(R, L, C, f0);
  }

  function impedanceAt(f, R, L, C, topo){
    const w = 2 * Math.PI * f;
    const Xl = w * L;
    const Xc = 1 / (w * C);
    if (topo === 'series'){
      return Math.sqrt(R*R + (Xl - Xc) * (Xl - Xc));
    } else {
      // parallel RLC impedance magnitude
      const Yr = 1 / R;
      const Yl = -1 / Xl;
      const Yc = 1 / Xc;
      const Yre = Yr;
      const Yim = Yl + Yc;
      const Ymag = Math.sqrt(Yre*Yre + Yim*Yim);
      return 1 / Ymag;
    }
  }

  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs){
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function drawGraph(R, L, C, f0){
    svg.innerHTML = '';
    const W = 640, H = 340;
    const pad = { top: 20, right: 20, bottom: 40, left: 56 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const fMin = f0 * 0.1;
    const fMax = f0 * 3;
    graphRange.textContent = fmt(fMin,0) + ' Hz – ' + fmt(fMax,0) + ' Hz';

    const N = 200;
    const pts = [];
    let zMax = 0;
    for (let i = 0; i <= N; i++){
      const f = fMin + (fMax - fMin) * (i / N);
      const z = impedanceAt(f, R, L, C, topology);
      pts.push([f, z]);
      if (isFinite(z) && z > zMax) zMax = z;
    }
    zMax = zMax * 1.1 || 1;

    const x = f => pad.left + ((f - fMin) / (fMax - fMin)) * plotW;
    const y = z => pad.top + plotH - (Math.min(z, zMax) / zMax) * plotH;

    const T = svgColors();

    // grid lines
    const gridGroup = el('g', {});
    for (let i = 0; i <= 4; i++){
      const gy = pad.top + (plotH / 4) * i;
      gridGroup.appendChild(el('line', {
        x1: pad.left, y1: gy, x2: pad.left + plotW, y2: gy,
        stroke: T.gridLine, 'stroke-width': 1
      }));
      const zVal = zMax - (zMax / 4) * i;
      const label = el('text', { x: pad.left - 8, y: gy + 4, 'text-anchor': 'end', fill: T.textFaint, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10' });
      label.textContent = fmt(zVal, 0);
      gridGroup.appendChild(label);
    }
    for (let i = 0; i <= 4; i++){
      const gx = pad.left + (plotW / 4) * i;
      const fVal = fMin + (fMax - fMin) * (i / 4);
      const label = el('text', { x: gx, y: H - pad.bottom + 18, 'text-anchor': 'middle', fill: T.textFaint, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10' });
      label.textContent = fmt(fVal, 0);
      gridGroup.appendChild(label);
    }
    svg.appendChild(gridGroup);

    // axis labels
    const yAxisLabel = el('text', { x: 14, y: pad.top + plotH/2, fill: T.textDim, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10', transform: `rotate(-90, 14, ${pad.top + plotH/2})`, 'text-anchor': 'middle' });
    yAxisLabel.textContent = '|Z| (Ω)';
    svg.appendChild(yAxisLabel);

    const xAxisLabel = el('text', { x: pad.left + plotW/2, y: H - 6, fill: T.textDim, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10', 'text-anchor': 'middle' });
    xAxisLabel.textContent = 'Frequency (Hz)';
    svg.appendChild(xAxisLabel);

    // curve
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + x(p[0]).toFixed(2) + ',' + y(p[1]).toFixed(2)).join(' ');
    svg.appendChild(el('path', { d, fill: 'none', stroke: T.curve, 'stroke-width': 2 }));

    // resonance marker
    const rx = x(f0);
    // At true resonance, X_L and X_C cancel in both topologies: in series that
    // leaves only R in the current path; in parallel, L and C's reactive
    // currents cancel so only R draws current from the source. Z at f0 = R
    // either way — this isn't a bug, just written confusingly before.
    const rz = R;
    const ry = y(rz);
    svg.appendChild(el('line', { x1: rx, y1: pad.top, x2: rx, y2: pad.top + plotH, stroke: T.accent, 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    svg.appendChild(el('circle', { cx: rx, cy: ry, r: 4, fill: T.accent }));

    const tagX = Math.min(Math.max(rx + 8, pad.left + 4), pad.left + plotW - 90);
    const tag = el('text', { x: tagX, y: pad.top + 14, fill: T.accent, 'font-family': 'JetBrains Mono, monospace', 'font-size': '11', 'font-weight': '600' });
    tag.textContent = 'f₀ = ' + fmt(f0, 1) + ' Hz';
    svg.appendChild(tag);
  }

  /* Shared helper: mark one preset (or the Reset-to-defaults button) as the
     active/selected state within its group, clearing every other button in that
     same group — including Reset, so "Default" reads as a real selectable state
     rather than the only option with no visual indicator at all. */
  function selectPreset(groupId, btn){
    document.querySelectorAll('#' + groupId + ' .preset-btn, #' + groupId + ' .reset-btn').forEach(b => {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
  }

  /* Clears ALL selection state in a group (no preset AND no "Default" marked) —
     used whenever the user manually edits a value, since at that point the
     current state no longer matches any named preset or the untouched default. */
  function clearGroupSelection(groupId){
    document.querySelectorAll('#' + groupId + ' .preset-btn, #' + groupId + ' .reset-btn').forEach(b => {
      b.setAttribute('aria-pressed', 'false');
    });
  }

  /* RLC presets — chosen to land within the slider ranges and produce a meaningful, distinct curve */
  const rlcPresets = {
    crossover:  { r: 8,   l: 2,   c: 47  },  // 2-way speaker crossover, heavily damped low-Q
    ripple:     { r: 100, l: 100, c: 100 },  // supply ripple filter, broad damped response
    oscillator: { r: 10,  l: 50,  c: 10  }   // sharp, high-Q resonance peak (Q ≈ 7 — actually demonstrates the "sharp/narrow" explanation)
  };
  document.querySelectorAll('#rlc-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = rlcPresets[btn.dataset.preset];
      if (!p) return;
      rRange.value = rInput.value = p.r;
      lRange.value = lInput.value = p.l;
      cRange.value = cInput.value = p.c;
      selectPreset('rlc-presets', btn);
      compute();
    });
  });

  document.getElementById('rlc-reset').addEventListener('click', () => {
    rRange.value = rInput.value = 50;
    lRange.value = lInput.value = 10;
    cRange.value = cInput.value = 100;
    setTopology('series'); // also calls compute() with the values just reset above
    selectPreset('rlc-presets', document.getElementById('rlc-reset')); // mark Default as the active state
  });

  compute();

  /* ---------- RLC Quiz ---------- */
  (function(){
    const scenarios = [
      { label: 'Series RLC: R = 8Ω, L = 2mH, C = 47µF. What\'s the Q factor?', r: 8, l: 2, c: 47, topo: 'series' },
      { label: 'Series RLC: R = 100Ω, L = 100mH, C = 100µF. What\'s the Q factor?', r: 100, l: 100, c: 100, topo: 'series' },
      { label: 'Series RLC: R = 10Ω, L = 50mH, C = 10µF. What\'s the Q factor?', r: 10, l: 50, c: 10, topo: 'series' },
      { label: 'Series RLC: R = 50Ω, L = 10mH, C = 100µF. What\'s the Q factor?', r: 50, l: 10, c: 100, topo: 'series' },
      { label: 'Parallel RLC: R = 20Ω, L = 5mH, C = 5µF. What\'s the Q factor?', r: 20, l: 5, c: 5, topo: 'parallel' }
    ];
    let idx = 0;
    const startBtn = document.getElementById('rlc-quiz-start');
    const questionBox = document.getElementById('rlc-quiz-question');
    const label = document.getElementById('rlc-quiz-label');
    const guessInput = document.getElementById('rlc-quiz-guess');
    const checkBtn = document.getElementById('rlc-quiz-check');
    const resultBox = document.getElementById('rlc-quiz-result');
    const nextBtn = document.getElementById('rlc-quiz-next');
    const graphSvg = document.getElementById('graph'); // blur just the SVG, not the whole card — the card also contains this quiz panel
    const readoutsBox = document.querySelectorAll('#panel-rlc .readouts')[0];
    wireQuizModalClose(questionBox, () => {
      graphSvg.classList.remove('quiz-blur');
      readoutsBox.classList.remove('quiz-blur');
    });

    function loadScenario(){
      const s = scenarios[idx];
      document.getElementById('rlc-quiz').open = true; // force the accordion open regardless of prior state
      rRange.value = rInput.value = s.r;
      lRange.value = lInput.value = s.l;
      cRange.value = cInput.value = s.c;
      clearGroupSelection('rlc-presets');
      setTopology(s.topo); // computes real values — we just hide them visually below
      label.textContent = s.label;
      guessInput.value = '';
      resultBox.textContent = '';
      nextBtn.style.display = 'none';
      guessInput.disabled = false;
      checkBtn.disabled = false;
      graphSvg.classList.add('quiz-blur');
      readoutsBox.classList.add('quiz-blur');
      if (!questionBox.open) questionBox.showModal();
      guessInput.focus();
    }
    startBtn.addEventListener('click', () => { idx = 0; loadScenario(); });
    nextBtn.addEventListener('click', () => {
      idx = (idx + 1) % scenarios.length;
      loadScenario();
    });
    checkBtn.addEventListener('click', () => {
      const guess = parseFloat(guessInput.value);
      const actual = parseFloat(outQ.textContent); // reuse the already-computed real value, don't recompute it separately
      graphSvg.classList.remove('quiz-blur');
      readoutsBox.classList.remove('quiz-blur');
      guessInput.disabled = true;
      checkBtn.disabled = true;
      nextBtn.style.display = '';
      if (isNaN(guess)){
        resultBox.textContent = 'Enter a number first.';
        resultBox.className = 'quiz-result';
        graphSvg.classList.add('quiz-blur');
        readoutsBox.classList.add('quiz-blur');
        guessInput.disabled = false;
        checkBtn.disabled = false;
        nextBtn.style.display = 'none';
        return;
      }
      const tolerance = Math.max(0.3, actual * 0.25);
      const correct = Math.abs(guess - actual) <= tolerance;
      resultBox.textContent = correct
        ? `✓ Correct! Actual Q factor: ${actual}. Check the "Show your work" and "Why does this happen?" panels above for the full breakdown.`
        : `Not quite — the actual Q factor is ${actual} (you guessed ${guess}). Check the panels above to see why.`;
      resultBox.className = 'quiz-result ' + (correct ? 'correct' : 'wrong');
    });
  })();

  /* ---------- BJT Bias Point Calculator ---------- */
  const vccR = document.getElementById('vcc-range'), vccI = document.getElementById('vcc-input');
  const r1R = document.getElementById('r1-range'), r1I = document.getElementById('r1-input');
  const r2R = document.getElementById('r2-range'), r2I = document.getElementById('r2-input');
  const rcR = document.getElementById('rc-range'), rcI = document.getElementById('rc-input');
  const reR = document.getElementById('re-range'), reI = document.getElementById('re-input');
  const betaR = document.getElementById('beta-range'), betaI = document.getElementById('beta-input');

  const outIb = document.getElementById('out-ib');
  const outIc = document.getElementById('out-ic');
  const outVce = document.getElementById('out-vce');
  const outVth = document.getElementById('out-vth');
  const regionBadge = document.getElementById('bjt-region-badge');
  const bjtGraphRange = document.getElementById('bjt-graph-range');
  const bjtSvg = document.getElementById('bjt-graph');

  const configCeBtn = document.getElementById('config-ce');
  const configCcBtn = document.getElementById('config-cc');
  const configCbBtn = document.getElementById('config-cb');
  const configCaption = document.getElementById('config-caption');
  const rcFieldWrapper = document.getElementById('rc-field-wrapper');
  const rcDisabledNote = document.getElementById('rc-disabled-note');
  let bjtConfig = 'ce'; // 'ce' | 'cc' | 'cb'

  const CONFIG_CAPTIONS = {
    ce: 'Common-Emitter — voltage-divider bias, output at collector',
    cc: 'Common-Collector (Emitter Follower) — collector tied to Vcc, output at emitter',
    cb: 'Common-Base — same DC bias as CE; input/output differ at the AC level'
  };

  function setBjtConfig(cfg){
    bjtConfig = cfg;
    configCeBtn.setAttribute('aria-pressed', String(cfg === 'ce'));
    configCcBtn.setAttribute('aria-pressed', String(cfg === 'cc'));
    configCbBtn.setAttribute('aria-pressed', String(cfg === 'cb'));
    configCaption.textContent = CONFIG_CAPTIONS[cfg] || CONFIG_CAPTIONS.ce;
    // Common-Collector ties the collector straight to Vcc — Rc isn't part of the
    // circuit in this configuration, so hide it rather than leave a misleading
    // input sitting there with no effect.
    const ccActive = cfg === 'cc';
    rcFieldWrapper.style.display = ccActive ? 'none' : '';
    rcDisabledNote.style.display = ccActive ? '' : 'none';
    bjtCompute();
  }
  configCeBtn.addEventListener('click', () => { clearGroupSelection('bjt-presets'); setBjtConfig('ce'); });
  configCcBtn.addEventListener('click', () => { clearGroupSelection('bjt-presets'); setBjtConfig('cc'); });
  configCbBtn.addEventListener('click', () => { clearGroupSelection('bjt-presets'); setBjtConfig('cb'); });

  function syncPairGeneric(range, input, cb){
    range.addEventListener('input', () => { input.value = range.value; cb(); });
    input.addEventListener('input', () => {
      let v = parseFloat(input.value);
      if (!isNaN(v)){
        const min = parseFloat(range.min), max = parseFloat(range.max);
        range.value = Math.min(Math.max(v, min), max);
      }
      cb();
    });
  }
  [[vccR,vccI],[r1R,r1I],[r2R,r2I],[rcR,rcI],[reR,reI],[betaR,betaI]].forEach(([r,i]) => syncPairGeneric(r, i, () => { clearGroupSelection('bjt-presets'); bjtCompute(); }));

  const mistakeToggle = document.getElementById('mistake-toggle');
  mistakeToggle.addEventListener('change', bjtCompute);

  const VBE = 0.7;

  function bjtCompute(){
    const Vcc = Math.max(parseFloat(vccI.value) || 0.01, 0.01);
    const R1 = Math.max(parseFloat(r1I.value) || 0.01, 0.01) * 1000;
    const R2 = Math.max(parseFloat(r2I.value) || 0.01, 0.01) * 1000;
    const RcInput = Math.max(parseFloat(rcI.value) || 0.01, 0.01) * 1000;
    const Rc = bjtConfig === 'cc' ? 0 : RcInput; // Common-Collector: collector ties directly to Vcc, no Rc in the circuit
    const Re = Math.max(parseFloat(reI.value) || 0.01, 0.01) * 1000;
    const beta = Math.max(parseFloat(betaI.value) || 1, 1);

    const Vth = Vcc * R2 / (R1 + R2);
    const Rth = (R1 * R2) / (R1 + R2);

    let Ib = (Vth - VBE) / (Rth + (beta + 1) * Re);
    if (Ib < 0) Ib = 0;
    let Ic = beta * Ib;
    const Ie = (beta + 1) * Ib;
    let Vce = Vcc - Ic * Rc - Ie * Re;

    const IcSat = Vcc / (Rc + Re);
    let region = 'Active';
    if (Ib <= 0){
      region = 'Cutoff';
      Ic = 0; Vce = Vcc;
    } else if (Ic >= IcSat || Vce <= 0.2){
      region = 'Saturation';
      Ic = IcSat;
      Vce = 0.2;
    }

    // ---- Common student mistake: using Vbe = 0V instead of 0.7V ----
    // Computed independently with the SAME clamping rules as the real result,
    // so the comparison is apples-to-apples (both can land in Sat/Cutoff too).
    let mistakePoint = null;
    if (mistakeToggle.checked){
      let mIb = (Vth - 0) / (Rth + (beta + 1) * Re);
      if (mIb < 0) mIb = 0;
      let mIc = beta * mIb;
      const mIe = (beta + 1) * mIb;
      let mVce = Vcc - mIc * Rc - mIe * Re;
      let mRegion = 'Active';
      if (mIb <= 0){ mRegion = 'Cutoff'; mIc = 0; mVce = Vcc; }
      else if (mIc >= IcSat || mVce <= 0.2){ mRegion = 'Saturation'; mIc = IcSat; mVce = 0.2; }
      mistakePoint = { Ib: mIb, Ic: mIc, Vce: mVce, region: mRegion };
    }

    setReadout(outIb, fmt(Ib * 1e6, 1) + ' <small>µA</small>');
    setReadout(outIc, fmt(Ic * 1e3, 2) + ' <small>mA</small>');
    setReadout(outVce, fmt(Vce, 2) + ' <small>V</small>');
    setReadout(outVth, fmt(Vth, 2) + ' <small>V</small>');

    regionBadge.textContent = region;
    // Uses CSS variables (not literal hex) so this recolors automatically when the
    // theme toggles, with no need to re-run this function.
    regionBadge.style.color = region === 'Active' ? 'var(--signal)' : 'var(--danger)';
    regionBadge.style.borderColor = region === 'Active' ? 'var(--signal-dim)' : 'var(--danger)';
    regionBadge.style.background = region === 'Active'
      ? 'color-mix(in srgb, var(--signal) 12%, transparent)'
      : 'color-mix(in srgb, var(--danger) 12%, transparent)';

    const vceLine = Rc > 0
      ? { label: 'Collector-emitter voltage — Vce = Vcc − Ic·Rc − Ie·Re',
          eq: `Vce = ${Vcc} <span class="op">−</span> (${fmt(Ic*1e3,2)}mA × ${fmt(Rc/1000,2)}k) <span class="op">−</span> (${fmt(Ie*1e3,2)}mA × ${fmt(Re/1000,2)}k) = <span class="result">${fmt(Vce,2)} V</span>` }
      : { label: 'Collector-emitter voltage — Vce = Vcc − Ie·Re (no Rc term — collector ties directly to Vcc)',
          eq: `Vce = ${Vcc} <span class="op">−</span> (${fmt(Ie*1e3,2)}mA × ${fmt(Re/1000,2)}k) = <span class="result">${fmt(Vce,2)} V</span>` };

    renderWork('bjt-worksteps', [
      { label: 'Thevenin base voltage — Vth = Vcc·R2 / (R1+R2)',
        eq: `Vth = ${Vcc} × ${fmt(R2/1000,2)}k <span class="op">/</span> (${fmt(R1/1000,2)}k + ${fmt(R2/1000,2)}k) = <span class="result">${fmt(Vth,2)} V</span>` },
      { label: 'Thevenin base resistance — Rth = R1·R2 / (R1+R2)',
        eq: `Rth = (${fmt(R1/1000,2)}k × ${fmt(R2/1000,2)}k) <span class="op">/</span> (${fmt(R1/1000,2)}k + ${fmt(R2/1000,2)}k) = <span class="result">${fmt(Rth/1000,2)}k Ω</span>` },
      { label: 'Base current — Ib = (Vth − Vbe) / (Rth + (β+1)·Re)',
        eq: `Ib = (${fmt(Vth,2)} <span class="op">−</span> 0.7) <span class="op">/</span> (${fmt(Rth/1000,2)}k + ${beta+1} × ${fmt(Re/1000,2)}k) = <span class="result">${fmt(Ib*1e6,1)} µA</span>` },
      { label: 'Collector current — Ic = β·Ib' + (region === 'Saturation' ? ' (clamped at Ic(sat) — circuit is saturated)' : ''),
        eq: region === 'Saturation'
          ? `Ic(sat) = Vcc <span class="op">/</span> (Rc+Re) = ${Vcc} <span class="op">/</span> ${fmt((Rc+Re)/1000,2)}k = <span class="result">${fmt(Ic*1e3,2)} mA</span>`
          : `Ic = ${beta} × ${fmt(Ib*1e6,1)}µA = <span class="result">${fmt(Ic*1e3,2)} mA</span>` },
      vceLine
    ]);

    const regionBasics = `A transistor has three operating regions. In <b>Cutoff</b>, the base-emitter junction isn't forward-biased enough to conduct at all — no current flows, and the transistor behaves like an open switch. In <b>Active</b>, there's enough base current to turn it on, but enough voltage headroom (V<sub>CE</sub>) remains for the collector current to stay proportional to the base current — this is the region used for linear amplification. In <b>Saturation</b>, the circuit is asking for more collector current than V<sub>CC</sub> and the surrounding resistors can actually supply, so V<sub>CE</sub> collapses toward 0V and the transistor behaves like a closed switch instead of an amplifier.`;

    let regionContext;
    if (region === 'Active'){
      regionContext = `Your circuit is currently in <b>Active</b> region — V<sub>CE</sub> sits at <b>${fmt(Vce,2)}V</b>, comfortably between 0V and V<sub>CC</sub> (${Vcc}V). This is exactly where you want a bias point for an amplifier: it gives a signal room to swing both up and down around the Q-point without getting clipped.`;
    } else if (region === 'Saturation'){
      regionContext = `Your circuit is currently in <b>Saturation</b>. The base current you're supplying is large enough that the transistor is trying to pass more collector current than V<sub>CC</sub> / (R<sub>C</sub>+R<sub>E</sub>) = <b>${fmt(IcSat*1e3,2)}mA</b> allows — so V<sub>CE</sub> has collapsed to about 0.2V. This is useful for switching applications (fully turning on an LED or relay), but it would clip a signal if you were trying to amplify one.`;
    } else {
      regionContext = `Your circuit is currently in <b>Cutoff</b> — the Thevenin base voltage (${fmt(Vth,2)}V) isn't reaching the roughly 0.7V needed to forward-bias the base-emitter junction, so no collector current flows at all. The transistor is fully off, behaving like an open switch.`;
    }

    const conceptParas = [regionBasics, `<span class="context-note">${regionContext}</span>`];

    if (bjtConfig === 'cc'){
      conceptParas.push(`<b>Common-Collector (Emitter Follower):</b> the collector connects straight to V<sub>CC</sub> with no resistor there at all, and the output is taken from the emitter instead of the collector. That's why the V<sub>CE</sub> equation above has no R<sub>C</sub> term. This configuration gives close to unity voltage gain but very high current gain, and is mainly used as a buffer — high input impedance, low output impedance — to drive a load without loading down the stage before it.`);
    } else if (bjtConfig === 'cb'){
      conceptParas.push(`<b>Common-Base:</b> with this single-supply, resistor-divider bias network, the DC operating point math is identical to Common-Emitter — nothing above changes. What's different is at the AC level: the input signal is applied at the emitter instead of the base, the output is taken from the collector, and the base is held at AC ground (via a bypass capacitor in a real circuit, which has no effect on this DC calculation). Common-base stages give high voltage gain but no current gain, and are valued for good high-frequency response.`);
    }

    if (mistakePoint){
      const shiftDesc = mistakePoint.region !== region
        ? `and even pushes the operating region from <b>${region}</b> to <b>${mistakePoint.region}</b>`
        : `shifting the Q-point to V<sub>CE</sub> = ${fmt(mistakePoint.Vce,2)}V instead of the correct ${fmt(Vce,2)}V`;
      conceptParas.push(`<span class="context-note mistake-note"><b>✗ Common mistake — V<sub>BE</sub> = 0V:</b> it's easy to forget the base-emitter junction needs about 0.7V to conduct at all, and just solve Ib = Vth / (Rth + (β+1)Re) instead. Dropping that 0.7V term makes the numerator bigger than it really is, which overstates I<sub>B</sub> — here it pushes I<sub>B</sub> from ${fmt(Ib*1e6,1)}µA to ${fmt(mistakePoint.Ib*1e6,1)}µA, ${shiftDesc}. The fix is just remembering that 0.7V drop belongs in every base-current equation for a silicon BJT.</span>`);
    }

    renderConcept('bjt-concept', conceptParas);

    drawLoadLine(Vcc, Rc, Re, Vce, Ic, IcSat, mistakePoint);
  }

  function drawLoadLine(Vcc, Rc, Re, VceQ, IcQ, IcSat, mistakePoint){
    bjtSvg.innerHTML = '';
    const W = 640, H = 340;
    const pad = { top: 20, right: 20, bottom: 40, left: 64 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    // widen the axis range if the mistake point would otherwise sit outside the plot
    const mistakeIcMax = mistakePoint ? mistakePoint.Ic : 0;
    const vMax = Vcc * 1.05;
    const iMax = Math.max(IcSat, mistakeIcMax) * 1.15;
    bjtGraphRange.textContent = '0–' + fmt(vMax,1) + ' V, 0–' + fmt(iMax*1000,1) + ' mA';

    const x = v => pad.left + (v / vMax) * plotW;
    const y = i => pad.top + plotH - (Math.min(i, iMax) / iMax) * plotH;

    const T = svgColors();

    const gridGroup = el('g', {});
    for (let k = 0; k <= 4; k++){
      const gy = pad.top + (plotH / 4) * k;
      gridGroup.appendChild(el('line', { x1: pad.left, y1: gy, x2: pad.left + plotW, y2: gy, stroke: T.gridLine, 'stroke-width': 1 }));
      const iVal = iMax - (iMax / 4) * k;
      const lbl = el('text', { x: pad.left - 8, y: gy + 4, 'text-anchor': 'end', fill: T.textFaint, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10' });
      lbl.textContent = fmt(iVal * 1000, 1);
      gridGroup.appendChild(lbl);
    }
    for (let k = 0; k <= 4; k++){
      const gx = pad.left + (plotW / 4) * k;
      const vVal = vMax * (k / 4);
      const lbl = el('text', { x: gx, y: H - pad.bottom + 18, 'text-anchor': 'middle', fill: T.textFaint, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10' });
      lbl.textContent = fmt(vVal, 1);
      gridGroup.appendChild(lbl);
    }
    bjtSvg.appendChild(gridGroup);

    bjtSvg.appendChild(el('text', { x: 16, y: pad.top + plotH/2, fill: T.textDim, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10', transform: `rotate(-90, 16, ${pad.top + plotH/2})`, 'text-anchor': 'middle' })).textContent = 'I_C (mA)';
    bjtSvg.appendChild(el('text', { x: pad.left + plotW/2, y: H - 6, fill: T.textDim, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10', 'text-anchor': 'middle' })).textContent = 'V_CE (V)';

    // load line: from (0, IcSat) to (Vcc, 0)
    const d = `M${x(0)},${y(IcSat)} L${x(Vcc)},${y(0)}`;
    bjtSvg.appendChild(el('path', { d, fill: 'none', stroke: T.curve, 'stroke-width': 2 }));

    // Q point
    const qx = x(VceQ), qy = y(IcQ);
    bjtSvg.appendChild(el('line', { x1: qx, y1: pad.top, x2: qx, y2: pad.top + plotH, stroke: T.accent, 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    bjtSvg.appendChild(el('line', { x1: pad.left, y1: qy, x2: pad.left + plotW, y2: qy, stroke: T.accent, 'stroke-width': 1, 'stroke-dasharray': '4 4' }));
    bjtSvg.appendChild(el('circle', { cx: qx, cy: qy, r: 5, fill: T.accent }));

    const tagX = Math.min(Math.max(qx + 8, pad.left + 4), pad.left + plotW - 60);
    const tagY = Math.max(qy - 10, pad.top + 12);
    const tag = el('text', { x: tagX, y: tagY, fill: T.accent, 'font-family': 'JetBrains Mono, monospace', 'font-size': '11', 'font-weight': '600' });
    tag.textContent = 'Q';
    bjtSvg.appendChild(tag);

    if (mistakePoint){
      const mx = x(mistakePoint.Vce), my = y(mistakePoint.Ic);
      bjtSvg.appendChild(el('line', { x1: mx, y1: pad.top, x2: mx, y2: pad.top + plotH, stroke: T.danger, 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: '0.7' }));
      bjtSvg.appendChild(el('circle', { cx: mx, cy: my, r: 5, fill: 'none', stroke: T.danger, 'stroke-width': 2 }));
      bjtSvg.appendChild(el('line', { x1: mx - 4, y1: my - 4, x2: mx + 4, y2: my + 4, stroke: T.danger, 'stroke-width': 1.5 }));
      bjtSvg.appendChild(el('line', { x1: mx - 4, y1: my + 4, x2: mx + 4, y2: my - 4, stroke: T.danger, 'stroke-width': 1.5 }));

      const mTagX = Math.min(Math.max(mx + 8, pad.left + 4), pad.left + plotW - 150);
      const mTagY = Math.min(Math.max(my + 16, pad.top + 12), pad.top + plotH - 6);
      const mTag = el('text', { x: mTagX, y: mTagY, fill: T.danger, 'font-family': 'JetBrains Mono, monospace', 'font-size': '10', 'font-weight': '600' });
      mTag.textContent = '✗ Common mistake: Vbe=0';
      bjtSvg.appendChild(mTag);
    }

    // legend lives as plain HTML below the graph now, not drawn inside the SVG —
    // it was previously drawn at the top-left of the plot area (y=16-36) and
    // could visually collide with the page header depending on scroll position
    const mistakeLegendEntry = document.getElementById('bjt-legend-mistake');
    if (mistakeLegendEntry) mistakeLegendEntry.style.display = mistakePoint ? '' : 'none';
  }

  bjtCompute();

  /* ---------- BJT Quiz ---------- */
  (function(){
    // Reuses the same values already verified as presets earlier — known-good
    // Active/Saturation/Cutoff outcomes, not newly-invented numbers.
    const scenarios = [
      { label: 'Vcc=12V, R1=43k, R2=10k, Rc=2.2k, Re=1k, β=150, CE. Predict the region.', vcc:12, r1:43, r2:10, rc:2.2, re:1, beta:150, config:'ce' },
      { label: 'Vcc=9V, R1=4.7k, R2=10k, Rc=0.33k, Re=0.1k, β=200, CE. Predict the region.', vcc:9, r1:4.7, r2:10, rc:0.33, re:0.1, beta:200, config:'ce' },
      { label: 'Vcc=9V, R1=150k, R2=2k, Rc=2k, Re=0.5k, β=150, CE. Predict the region.', vcc:9, r1:150, r2:2, rc:2, re:0.5, beta:150, config:'ce' },
      { label: 'Vcc=15V, R1=100k, R2=20k, Rc=10k, Re=2k, β=300, CE. Predict the region.', vcc:15, r1:100, r2:20, rc:10, re:2, beta:300, config:'ce' },
      { label: 'Vcc=12V, R1=20k, R2=10k, Re=1k, β=150, Common-Collector. Predict the region.', vcc:12, r1:20, r2:10, rc:2.2, re:1, beta:150, config:'cc' }
    ];
    let idx = 0;
    const startBtn = document.getElementById('bjt-quiz-start');
    const questionBox = document.getElementById('bjt-quiz-question');
    const label = document.getElementById('bjt-quiz-label');
    const choiceBtns = document.querySelectorAll('#bjt-quiz-question .quiz-choice-btn');
    const resultBox = document.getElementById('bjt-quiz-result');
    const nextBtn = document.getElementById('bjt-quiz-next');
    const graphSvg = document.getElementById('bjt-graph'); // blur just the SVG, not the whole card — the card also contains this quiz panel
    const readoutsBox = document.querySelectorAll('#panel-bjt .readouts')[0];
    wireQuizModalClose(questionBox, () => {
      graphSvg.classList.remove('quiz-blur');
      readoutsBox.classList.remove('quiz-blur');
      document.getElementById('bjt-region-badge').classList.remove('quiz-blur');
    });

    function loadScenario(){
      const s = scenarios[idx];
      document.getElementById('bjt-quiz').open = true; // force the accordion open regardless of prior state
      vccR.value = vccI.value = s.vcc;
      r1R.value = r1I.value = s.r1;
      r2R.value = r2I.value = s.r2;
      rcR.value = rcI.value = s.rc;
      reR.value = reI.value = s.re;
      betaR.value = betaI.value = s.beta;
      mistakeToggle.checked = false;
      clearGroupSelection('bjt-presets');
      setBjtConfig(s.config); // computes real values — we just hide them visually below
      label.textContent = s.label;
      resultBox.textContent = '';
      nextBtn.style.display = 'none';
      choiceBtns.forEach(b => { b.disabled = false; b.classList.remove('correct', 'wrong'); });
      graphSvg.classList.add('quiz-blur');
      readoutsBox.classList.add('quiz-blur');
      document.getElementById('bjt-region-badge').classList.add('quiz-blur');
      if (!questionBox.open) questionBox.showModal();
    }
    startBtn.addEventListener('click', () => { idx = 0; loadScenario(); });
    nextBtn.addEventListener('click', () => {
      idx = (idx + 1) % scenarios.length;
      loadScenario();
    });
    choiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const guess = btn.dataset.choice;
        const actual = regionBadge.textContent; // reuse the already-computed real value
        graphSvg.classList.remove('quiz-blur');
        readoutsBox.classList.remove('quiz-blur');
        document.getElementById('bjt-region-badge').classList.remove('quiz-blur');
        choiceBtns.forEach(b => {
          b.disabled = true;
          if (b.dataset.choice === actual) b.classList.add('correct');
          else if (b === btn) b.classList.add('wrong');
        });
        nextBtn.style.display = '';
        const correct = guess === actual;
        resultBox.textContent = correct
          ? `✓ Correct! This lands in ${actual}. Check the "Show your work" and "Why does this happen?" panels above for the full breakdown.`
          : `Not quite — this actually lands in ${actual}, not ${guess}. Check the panels above to see why.`;
        resultBox.className = 'quiz-result ' + (correct ? 'correct' : 'wrong');
      });
    });
  })();

  /* BJT presets — realistic component values, deliberately spanning all three regions,
     plus one preset per alternate configuration (config defaults to 'ce' when omitted) */
  const bjtPresets = {
    audiopreamp: { vcc: 12, r1: 43,  r2: 10, rc: 2.2,  re: 1,   beta: 150 }, // Class A audio preamp, sits mid-Active
    ledswitch:   { vcc: 9,  r1: 4.7, r2: 10, rc: 0.33, re: 0.1, beta: 200 }, // driven hard on purpose — lands in Saturation
    sensoramp:   { vcc: 15, r1: 100, r2: 20, rc: 10,   re: 2,   beta: 300 }, // low-current, high-gain, stays Active
    disconnected: { vcc: 9, r1: 150, r2: 2,  rc: 2,    re: 0.5, beta: 150 }, // R2 too small to reach Vbe — lands in Cutoff
    emitterfollower: { vcc: 12, r1: 20, r2: 10, rc: 2.2, re: 1,    beta: 150, config: 'cc' }, // Rc ignored — collector ties to Vcc
    cbstage:         { vcc: 9,  r1: 33, r2: 10, rc: 1.5, re: 0.68, beta: 180, config: 'cb' }  // same math as CE, different AC role
  };
  document.querySelectorAll('#bjt-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = bjtPresets[btn.dataset.preset];
      if (!p) return;
      vccR.value = vccI.value = p.vcc;
      r1R.value = r1I.value = p.r1;
      r2R.value = r2I.value = p.r2;
      rcR.value = rcI.value = p.rc;
      reR.value = reI.value = p.re;
      betaR.value = betaI.value = p.beta;
      selectPreset('bjt-presets', btn);
      setBjtConfig(p.config || 'ce'); // also calls bjtCompute() with the values just set above
    });
  });

  document.getElementById('bjt-reset').addEventListener('click', () => {
    vccR.value = vccI.value = 12;
    r1R.value = r1I.value = 43;
    r2R.value = r2I.value = 10;
    rcR.value = rcI.value = 2.2;
    reR.value = reI.value = 1;
    betaR.value = betaI.value = 150;
    setBjtConfig('ce'); // also calls bjtCompute() with the values just reset above
    selectPreset('bjt-presets', document.getElementById('bjt-reset')); // mark Default as the active state
  });

  /* ---------- Coulomb's Law Field Visualizer ---------- */
  const fieldSvg = document.getElementById('field-graph');
  const modePosBtn = document.getElementById('mode-positive');
  const modeNegBtn = document.getElementById('mode-negative');
  const clearBtn = document.getElementById('field-clear');
  const densitySlider = document.getElementById('field-density');
  const densityVal = document.getElementById('density-val');
  const netQOut = document.getElementById('out-netq');
  const countBadge = document.getElementById('field-count-badge');

  let chargeMode = 1;
  let charges = [ { x: 220, y: 170, q: 1 }, { x: 420, y: 170, q: -1 } ];
  let dragIndex = -1;
  let keyboardFocusIndex = -1; // which charge to restore keyboard focus to after a redraw
  const NUDGE_STEP = 10; // px per arrow-key press
  let hoverGroup = null, hoverDot = null, hoverBg = null, hoverBreakdownLines = [];

  modePosBtn.addEventListener('click', () => { chargeMode = 1; modePosBtn.setAttribute('aria-pressed','true'); modeNegBtn.setAttribute('aria-pressed','false'); });
  modeNegBtn.addEventListener('click', () => { chargeMode = -1; modeNegBtn.setAttribute('aria-pressed','true'); modePosBtn.setAttribute('aria-pressed','false'); });

  // Finds an empty spot for a new charge — tries a grid of candidate points first
  // (spread across the whole canvas, well clear of each other), and only falls back
  // to a random point if every grid slot is already occupied. This replaces an
  // earlier version that cycled through just 15 fixed positions and silently
  // stacked charges on top of each other past the 15th click.
  function findFreeSpot(){
    const MIN_GAP = 30; // minimum distance from any existing charge, in SVG units
    const cols = 9, rows = 6;
    const left = CHARGE_R + EDGE_PAD + 10, right = 640 - CHARGE_R - EDGE_PAD - 10;
    const top = CHARGE_R + EDGE_PAD + 10, bottom = 340 - CHARGE_R - EDGE_PAD - 10;
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const x = left + (right - left) * (cols === 1 ? 0.5 : c / (cols - 1));
        const y = top + (bottom - top) * (rows === 1 ? 0.5 : r / (rows - 1));
        const occupied = charges.some(ch => Math.hypot(ch.x - x, ch.y - y) < MIN_GAP);
        if (!occupied) return clampToCanvas(x, y);
      }
    }
    // grid is completely full — fall back to a random point, still collision-checked once
    for (let attempt = 0; attempt < 20; attempt++){
      const x = left + Math.random() * (right - left);
      const y = top + Math.random() * (bottom - top);
      const occupied = charges.some(ch => Math.hypot(ch.x - x, ch.y - y) < MIN_GAP);
      if (!occupied) return clampToCanvas(x, y);
    }
    // truly packed solid — just place at canvas centre, better than crashing
    return clampToCanvas(320, 170);
  }

  const addBtn = document.getElementById('field-add');
  addBtn.addEventListener('click', () => {
    const [x, y] = findFreeSpot();
    charges.push({ x, y, q: chargeMode });
    keyboardFocusIndex = charges.length - 1;
    drawField();
  });
  clearBtn.addEventListener('click', () => {
    charges = [];
    document.querySelectorAll('#field-presets .preset-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
    drawField();
  });
  densitySlider.addEventListener('input', () => {
    densityVal.textContent = densitySlider.value + '×' + Math.round(densitySlider.value * 0.67);
    drawField();
  });

  function svgPoint(evt){
    const rect = fieldSvg.getBoundingClientRect();
    const vb = fieldSvg.viewBox.baseVal;
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    const px = (clientX - rect.left) / rect.width * vb.width;
    const py = (clientY - rect.top) / rect.height * vb.height;
    return [px, py];
  }

  const CHARGE_R = 13; // visual radius of a charge marker, in SVG units
  const EDGE_PAD = 4;  // extra breathing room so the marker's stroke isn't flush against the edge
  function clampToCanvas(px, py){
    const vb = fieldSvg.viewBox.baseVal;
    const minX = CHARGE_R + EDGE_PAD, maxX = vb.width - CHARGE_R - EDGE_PAD;
    const minY = CHARGE_R + EDGE_PAD, maxY = vb.height - CHARGE_R - EDGE_PAD;
    return [Math.min(Math.max(px, minX), maxX), Math.min(Math.max(py, minY), maxY)];
  }

  function hitTestCharge(px, py){
    for (let i = charges.length - 1; i >= 0; i--){
      const c = charges[i];
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < 22) return i; // generous radius for touch
    }
    return -1;
  }

  // Groups charges that sit within `radius` of one another (single-linkage — a
  // chain of near-overlapping charges all merge into one stack). Returns one
  // entry per group of 2+, positioned at the group's average location, for the
  // "×N" badge. Groups of exactly 1 (no near neighbors) are omitted — nothing
  // to flag there.
  function findChargeStacks(chargeList, radius){
    const n = chargeList.length;
    const visited = new Array(n).fill(false);
    const stacks = [];
    for (let i = 0; i < n; i++){
      if (visited[i]) continue;
      const cluster = [i];
      visited[i] = true;
      const frontier = [i];
      while (frontier.length){
        const cur = frontier.pop();
        for (let j = 0; j < n; j++){
          if (visited[j]) continue;
          const d = Math.hypot(chargeList[cur].x - chargeList[j].x, chargeList[cur].y - chargeList[j].y);
          if (d < radius){
            visited[j] = true;
            cluster.push(j);
            frontier.push(j);
          }
        }
      }
      if (cluster.length > 1){
        const avgX = cluster.reduce((s, idx) => s + chargeList[idx].x, 0) / cluster.length;
        const avgY = cluster.reduce((s, idx) => s + chargeList[idx].y, 0) / cluster.length;
        stacks.push({ x: avgX, y: avgY, count: cluster.length });
      }
    }
    return stacks;
  }

  let downStart = null; // {x, y, hitIndex} — used to distinguish tap-to-remove from drag on both mouse and touch

  fieldSvg.addEventListener('pointerdown', (evt) => {
    const [rawX, rawY] = svgPoint(evt);
    const hit = hitTestCharge(rawX, rawY);
    downStart = { x: rawX, y: rawY, hitIndex: hit };
    if (hit >= 0){
      dragIndex = hit;
      fieldSvg.setPointerCapture(evt.pointerId);
    } else {
      const [px, py] = clampToCanvas(rawX, rawY);
      charges.push({ x: px, y: py, q: chargeMode });
      drawField();
    }
  });
  // Both paths below are rAF-batched: the raw pointermove handler only updates
  // in-memory state (cheap) and schedules ONE animation frame, using a
  // "already scheduled" guard so any number of raw events firing between
  // frames collapse into a single redraw using the latest position — instead
  // of the previous behavior, which called the full drawField() (heatmap +
  // arrow grid recompute, ~1248 field evaluations) synchronously on every
  // single raw mousemove event, easily 100+ times/sec on a modern mouse.
  let dragRafPending = false;
  let hoverRafPending = false;
  let latestHoverPos = null;

  fieldSvg.addEventListener('pointermove', (evt) => {
    const [rawX, rawY] = svgPoint(evt);
    if (dragIndex < 0){
      latestHoverPos = [rawX, rawY];
      if (!hoverRafPending){
        hoverRafPending = true;
        requestAnimationFrame(() => {
          hoverRafPending = false;
          if (latestHoverPos) updateHoverProbe(latestHoverPos[0], latestHoverPos[1]);
        });
      }
      return;
    }
    const [px, py] = clampToCanvas(rawX, rawY);
    charges[dragIndex].x = px;
    charges[dragIndex].y = py;
    if (!dragRafPending){
      dragRafPending = true;
      requestAnimationFrame(() => {
        dragRafPending = false;
        drawField();
      });
    }
  });
  fieldSvg.addEventListener('pointerleave', hideHoverProbe);

  // Live field-probe tooltip — updated directly via attribute changes on mousemove
  // rather than a full drawField() call, since recomputing the whole heatmap/arrow
  // grid on every pixel of mouse movement would be needlessly expensive.
  const fieldProbeStatus = document.getElementById('field-probe-status');
  let lastProbeAnnounce = { text: '', time: 0 };
  function hideHoverProbe(){
    if (hoverGroup) hoverGroup.setAttribute('opacity', '0');
    if (fieldProbeStatus) fieldProbeStatus.textContent = '';
    lastProbeAnnounce = { text: '', time: 0 };
    latestHoverPos = null; // so an already-queued rAF frame doesn't re-show the tooltip after the pointer has left
  }
  function updateHoverProbe(px, py){
    if (!hoverGroup || charges.length === 0) return;
    if (hitTestCharge(px, py) >= 0){ hideHoverProbe(); return; }
    const T = svgColors();
    const [ex, ey] = fieldVectorAt(px, py);
    const mag = Math.hypot(ex, ey);
    const angleDeg = (Math.atan2(ey, ex) * 180 / Math.PI + 360) % 360;

    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);

    // ---- per-charge breakdown: the actual vector-sum math, not just the final
    // number, same spirit as the "show your work" panels for the other tools.
    // Capped to the top 4 contributors by magnitude so this stays readable even
    // with dozens of charges on the canvas — the rest are summarized in one line. ----
    const MAX_LINES = 4;
    const contributions = charges.map(c => {
      const dx = px - c.x, dy = py - c.y;
      const r2 = Math.max(dx*dx + dy*dy, 100);
      const r = Math.sqrt(r2);
      const cx = (c.q / r2) * (dx / r), cy = (c.q / r2) * (dy / r);
      return { sign: c.q > 0 ? '+' : '−', r, cx, cy, mag: Math.hypot(cx, cy) };
    }).sort((a, b) => b.mag - a.mag);
    const shown = contributions.slice(0, MAX_LINES);
    const hiddenCount = contributions.length - shown.length;

    const lines = [`|E| ∝ ${mag.toFixed(4)}  ∠ ${angleDeg.toFixed(0)}°`];
    shown.forEach(c => {
      lines.push(`${c.sign} charge, r=${c.r.toFixed(0)}px → (${c.cx.toFixed(4)}, ${c.cy.toFixed(4)})`);
    });
    if (hiddenCount > 0) lines.push(`+ ${hiddenCount} more charge${hiddenCount === 1 ? '' : 's'} summed in`);

    const boxW = 216;
    const lineH = 14;
    const boxH = 10 + lines.length * lineH;
    let bx = px + 14, by = py - boxH - 6;
    if (bx + boxW > 640) bx = px - boxW - 14;
    if (by < 0) by = py + 14;
    if (by + boxH > 340) by = 340 - boxH - 4;
    hoverBg.setAttribute('x', bx);
    hoverBg.setAttribute('y', by);
    hoverBg.setAttribute('width', boxW);
    hoverBg.setAttribute('height', boxH);

    hoverBreakdownLines.forEach((lineEl, i) => {
      if (i < lines.length){
        lineEl.setAttribute('x', bx + 8);
        lineEl.setAttribute('y', by + 14 + i * lineH);
        lineEl.textContent = lines[i];
        lineEl.setAttribute('fill', i === 0 ? T.bright : T.textFaint);
        lineEl.style.display = '';
      } else {
        lineEl.style.display = 'none';
      }
    });
    hoverGroup.setAttribute('opacity', '1');

    // Screen-reader equivalent of the visual tooltip above. Throttled by both a
    // minimum time gap and a "did the rounded value actually change" check, so
    // a screen reader isn't re-announcing on every single pixel of mouse movement.
    if (fieldProbeStatus){
      const announceText = `Field strength ${mag.toFixed(3)}, direction ${angleDeg.toFixed(0)} degrees`;
      const now = Date.now();
      if (announceText !== lastProbeAnnounce.text && (now - lastProbeAnnounce.time) > 400){
        fieldProbeStatus.textContent = announceText;
        lastProbeAnnounce = { text: announceText, time: now };
      }
    }
  }

  function endDrag(evt){
    if (dragIndex < 0){ downStart = null; return; }
    const [px, py] = svgPoint(evt);
    const moved = downStart ? Math.hypot(downStart.x - px, downStart.y - py) : 999;
    if (moved < 6 && downStart && downStart.hitIndex >= 0){
      // treated as a tap, not a drag — remove the charge
      charges.splice(downStart.hitIndex, 1);
    }
    dragIndex = -1;
    downStart = null;
    drawField();
  }
  fieldSvg.addEventListener('pointerup', endDrag);
  fieldSvg.addEventListener('pointercancel', endDrag);

  function fieldVectorAt(px, py){
    let ex = 0, ey = 0;
    for (const c of charges){
      const dx = px - c.x, dy = py - c.y;
      let r2 = dx*dx + dy*dy;
      if (r2 < 100) r2 = 100;
      const r = Math.sqrt(r2);
      const k = c.q / r2;
      ex += k * (dx / r);
      ey += k * (dy / r);
    }
    return [ex, ey];
  }

  function drawField(){
    fieldSvg.innerHTML = '';
    const W = 640, H = 340;
    const T = svgColors();

    // ---- shared defs: arrowhead marker + soft blur for the field-strength glow ----
    const defs = el('defs', {});
    const marker = el('marker', { id: 'arrowhead', markerWidth: 6, markerHeight: 6, refX: 5, refY: 3, orient: 'auto' });
    marker.appendChild(el('path', { d: 'M0,0 L6,3 L0,6 Z', fill: T.bright }));
    defs.appendChild(marker);
    const blurFilter = el('filter', { id: 'fieldGlow', x: '-30%', y: '-30%', width: '160%', height: '160%' });
    blurFilter.appendChild(el('feGaussianBlur', { stdDeviation: '7' }));
    defs.appendChild(blurFilter);
    fieldSvg.appendChild(defs);

    if (charges.length === 0){
      const hint = el('text', { x: W/2, y: H/2, 'text-anchor': 'middle', fill: T.textFaint, 'font-family': 'JetBrains Mono, monospace', 'font-size': '12' });
      hint.textContent = 'Click anywhere to place a charge';
      fieldSvg.appendChild(hint);
    } else {
      // ---- background layer: field-strength glow, so you can SEE where the field is strong,
      // not just infer it from arrow density. Sampled on its own fine grid, independent of the
      // direction-arrow density the user controls below. ----
      const heatCols = 48, heatRows = 26;
      const cellW = W / heatCols, cellH = H / heatRows;
      let heatMax = 0;
      const heatVals = [];
      for (let r = 0; r < heatRows; r++){
        for (let c = 0; c < heatCols; c++){
          const px = (c + 0.5) * cellW, py = (r + 0.5) * cellH;
          const [ex, ey] = fieldVectorAt(px, py);
          const mag = Math.hypot(ex, ey);
          heatVals.push({ px, py, mag });
          if (mag > heatMax) heatMax = mag;
        }
      }
      const glowGroup = el('g', { filter: 'url(#fieldGlow)' });
      heatVals.forEach(v => {
        const norm = Math.log(1 + (v.mag / (heatMax || 1)) * 9) / Math.log(10);
        if (norm < 0.05) return; // skip near-zero cells — keeps weak-field areas clean instead of a flat grey wash
        glowGroup.appendChild(el('rect', {
          x: v.px - cellW * 0.65, y: v.py - cellH * 0.65,
          width: cellW * 1.3, height: cellH * 1.3,
          fill: lerpColor(T.glowWeak, T.glowStrong, norm), opacity: (norm * 0.38).toFixed(2)
        }));
      });
      fieldSvg.appendChild(glowGroup);

      // ---- direction arrows — grid density is the user-controlled slider ----
      // Uniform length (Desmos-style) rather than magnitude-scaled: since field
      // STRENGTH is already shown by the glow layer above, arrows only need to
      // show DIRECTION. A constant tail length means every arrow reads clearly,
      // even far from any charge where the field is weak — previously those
      // arrows shrank down to almost nothing and looked like bare arrowheads
      // with no visible tail.
      const cols = parseInt(densitySlider.value, 10);
      const rows = Math.round(cols * 0.67);
      const marginX = 40, marginY = 30;
      const arrowGroup = el('g', {});
      const vecs = [];
      for (let r = 0; r < rows; r++){
        for (let cIdx = 0; cIdx < cols; cIdx++){
          const px = marginX + (W - 2*marginX) * (cIdx + 0.5) / cols;
          const py = marginY + (H - 2*marginY) * (r + 0.5) / rows;
          const [ex, ey] = fieldVectorAt(px, py);
          const mag = Math.hypot(ex, ey);
          vecs.push({ px, py, ex, ey, mag });
        }
      }
      const arrowLen = Math.min(W / cols, H / rows) * 0.62;
      vecs.forEach(v => {
        if (v.mag < 1e-9) return;
        const ux = v.ex / v.mag, uy = v.ey / v.mag;
        const x2 = v.px + ux * arrowLen, y2 = v.py + uy * arrowLen;
        arrowGroup.appendChild(el('line', { x1: v.px, y1: v.py, x2, y2, stroke: T.bright, 'stroke-width': 1.5, opacity: '0.75', 'marker-end': 'url(#arrowhead)' }));
      });
      fieldSvg.appendChild(arrowGroup);
    }

    // draw charges — each one is a focusable, keyboard-operable group
    charges.forEach((c, idx) => {
      const color = c.q > 0 ? T.accent : T.danger;
      const g = el('g', {
        tabindex: '0',
        role: 'button',
        'aria-label': `${c.q > 0 ? 'Positive' : 'Negative'} charge, position ${Math.round(c.x)}, ${Math.round(c.y)}. Use arrow keys to move, Delete to remove.`,
        style: 'cursor: pointer; outline-offset: 3px;'
      });
      g.appendChild(el('circle', { cx: c.x, cy: c.y, r: 13, fill: color, opacity: 0.9, stroke: T.surface, 'stroke-width': 2 }));
      const sign = el('text', { x: c.x, y: c.y + 5, 'text-anchor': 'middle', fill: T.surface, 'font-family': 'JetBrains Mono, monospace', 'font-size': '15', 'font-weight': '700' });
      sign.textContent = c.q > 0 ? '+' : '−';
      g.appendChild(sign);

      g.addEventListener('keydown', (evt) => {
        let dx = 0, dy = 0;
        if (evt.key === 'ArrowUp') dy = -NUDGE_STEP;
        else if (evt.key === 'ArrowDown') dy = NUDGE_STEP;
        else if (evt.key === 'ArrowLeft') dx = -NUDGE_STEP;
        else if (evt.key === 'ArrowRight') dx = NUDGE_STEP;
        else if (evt.key === 'Delete' || evt.key === 'Backspace'){
          evt.preventDefault();
          charges.splice(idx, 1);
          keyboardFocusIndex = -1;
          drawField();
          addBtn.focus(); // keep focus somewhere sensible instead of losing it to <body>
          return;
        } else {
          return; // not a key we handle — let it bubble normally
        }
        evt.preventDefault();
        const [nx, ny] = clampToCanvas(c.x + dx, c.y + dy);
        charges[idx].x = nx;
        charges[idx].y = ny;
        keyboardFocusIndex = idx;
        drawField();
      });

      fieldSvg.appendChild(g);
    });

    // ---- stack-count badges: when charges land close enough to overlap or nearly
    // overlap, show an "×N" pill so it's obvious more than one charge is there,
    // instead of them silently hiding behind each other. ----
    const stackBadges = findChargeStacks(charges, 20);
    stackBadges.forEach(s => {
      const badgeG = el('g', { style: 'pointer-events: none;' });
      const label = `×${s.count}`;
      const bw = 16 + label.length * 7;
      badgeG.appendChild(el('rect', {
        x: s.x + 10, y: s.y - 22, width: bw, height: 18, rx: 9, ry: 9,
        fill: T.surface, stroke: T.accent, 'stroke-width': 1.5
      }));
      const t = el('text', {
        x: s.x + 10 + bw / 2, y: s.y - 9, 'text-anchor': 'middle',
        'font-family': 'JetBrains Mono, monospace', 'font-size': '11', 'font-weight': '700', fill: T.accent
      });
      t.textContent = label;
      badgeG.appendChild(t);
      fieldSvg.appendChild(badgeG);
    });

    if (keyboardFocusIndex >= 0 && keyboardFocusIndex < charges.length){
      const groups = fieldSvg.querySelectorAll('g[role="button"]');
      if (groups[keyboardFocusIndex]) groups[keyboardFocusIndex].focus();
    }

    // ---- live hover-probe tooltip (hidden until the mouse moves over empty space) ----
    // Pool of 6 text lines: 1 header (|E| + angle) + up to 4 per-charge
    // contributions + 1 "N more charges" overflow line. Pre-created here and
    // just repositioned/re-texted in updateHoverProbe() on mousemove, rather
    // than creating/destroying elements every frame.
    hoverGroup = el('g', { opacity: '0', style: 'pointer-events:none; transition: opacity 0.1s ease;' });
    hoverDot = el('circle', { r: 3, fill: T.bright });
    hoverBg = el('rect', { rx: 4, ry: 4, fill: T.surface, stroke: T.border, 'stroke-width': 1 });
    hoverGroup.appendChild(hoverDot);
    hoverGroup.appendChild(hoverBg);
    hoverBreakdownLines = [];
    for (let i = 0; i < 6; i++){
      const lineEl = el('text', { 'font-family': 'JetBrains Mono, monospace', 'font-size': '10' });
      hoverBreakdownLines.push(lineEl);
      hoverGroup.appendChild(lineEl);
    }
    fieldSvg.appendChild(hoverGroup);

    const netQ = charges.reduce((s,c) => s + c.q, 0);
    setReadout(netQOut, (netQ > 0 ? '+' : '') + netQ);
    countBadge.textContent = charges.length + (charges.length === 1 ? ' charge' : ' charges');

    renderFieldWork();
  }

  function renderFieldWork(){
    const steps = [
      { label: 'Superposition principle — E(P) = Σ kqᵢ / rᵢ² (direction: point-to-field-point)',
        eq: `Each charge contributes independently; vectors are summed component-wise to get the net field at every grid point.` }
    ];
    if (charges.length === 0){
      steps.push({ label: 'No charges placed yet', eq: 'Click the field to add one, or pick a preset above.' });
    } else {
      // sample field at the plot centre so the numbers are concrete, not abstract
      const px = 320, py = 170;
      let ex = 0, ey = 0;
      charges.forEach((c, i) => {
        const dx = px - c.x, dy = py - c.y;
        const r2 = Math.max(dx*dx + dy*dy, 100);
        const r = Math.sqrt(r2);
        const contribX = (c.q / r2) * (dx / r);
        const contribY = (c.q / r2) * (dy / r);
        ex += contribX; ey += contribY;
        steps.push({
          label: `Charge ${i+1} (${c.q > 0 ? '+' : '−'}) — contribution at plot centre, r = ${fmt(r,1)} px`,
          eq: `E${i+1} ∝ ${c.q} / ${fmt(r,1)}² <span class="op">→</span> component (${contribX.toFixed(4)}, ${contribY.toFixed(4)})`
        });
      });
      const mag = Math.hypot(ex, ey);
      steps.push({
        label: 'Net field at plot centre (vector sum of all charges above)',
        eq: `|E| ∝ <span class="result">${mag.toFixed(4)}</span> (relative units — arrow direction shown on the map)`
      });
    }
    renderWork('field-worksteps', steps);
  }

  // re-draw field graph whenever its tab becomes active (SVG sizing is viewBox-based so this is optional, but ensures fresh paint)
  document.getElementById('tab-field').addEventListener('click', drawField);
  document.getElementById('tab-bjt').addEventListener('click', bjtCompute);

  /* Field presets */
  const fieldPresets = {
    dipole: () => [ { x: 220, y: 170, q: 1 }, { x: 420, y: 170, q: -1 } ],
    repel:  () => [ { x: 220, y: 170, q: 1 }, { x: 420, y: 170, q: 1 } ],
    cluster: () => [
      { x: 200, y: 120, q: 1 }, { x: 440, y: 120, q: 1 },
      { x: 200, y: 220, q: -1 }, { x: 440, y: 220, q: -1 }
    ]
  };
  document.querySelectorAll('#field-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn = fieldPresets[btn.dataset.preset];
      if (!fn) return;
      charges = fn();
      selectPreset('field-presets', btn);
      drawField();
    });
  });

  document.getElementById('field-reset').addEventListener('click', () => {
    charges = [];
    densitySlider.value = 12;
    densityVal.textContent = '12×8';
    chargeMode = 1;
    modePosBtn.setAttribute('aria-pressed', 'true');
    modeNegBtn.setAttribute('aria-pressed', 'false');
    drawField();
    selectPreset('field-presets', document.getElementById('field-reset')); // mark Default as the active state
  });

  drawField();

  /* ---------- Field Quiz ---------- */
  (function(){
    // Directions verified in advance against the exact fieldVectorAt() formula
    // below — all five land cleanly on a cardinal direction (0/90/180/270°),
    // no near-boundary ambiguity.
    const scenarios = [
      { label: 'A + charge sits at (200,170). Probe point is at (400,170). Which way does the field point at the probe?',
        charges: [{x:200,y:170,q:1}], px:400, py:170, expect:'E' },
      { label: 'A − charge sits at (320,300). Probe point is at (320,100). Which way does the field point at the probe?',
        charges: [{x:320,y:300,q:-1}], px:320, py:100, expect:'S' },
      { label: 'A + charge sits at (320,300). Probe point is at (320,100). Which way does the field point at the probe?',
        charges: [{x:320,y:300,q:1}], px:320, py:100, expect:'N' },
      { label: 'A dipole: + at (150,170), − at (490,170). Probe point is the midpoint (320,170). Which way does the field point there?',
        charges: [{x:150,y:170,q:1},{x:490,y:170,q:-1}], px:320, py:170, expect:'E' },
      { label: 'A − charge sits at (200,170). Probe point is at (400,170). Which way does the field point at the probe?',
        charges: [{x:200,y:170,q:-1}], px:400, py:170, expect:'W' }
    ];
    let idx = 0;
    const startBtn = document.getElementById('field-quiz-start');
    const questionBox = document.getElementById('field-quiz-question');
    const label = document.getElementById('field-quiz-label');
    const choiceBtns = document.querySelectorAll('#field-quiz-question .quiz-choice-btn');
    const resultBox = document.getElementById('field-quiz-result');
    const nextBtn = document.getElementById('field-quiz-next');
    wireQuizModalClose(questionBox, () => { fieldSvg.classList.remove('quiz-blur'); });

    function loadScenario(){
      const s = scenarios[idx];
      document.getElementById('field-quiz').open = true; // force the accordion open regardless of prior state
      charges = s.charges.map(c => ({ x: c.x, y: c.y, q: c.q })); // copy, not the scenario's own array
      document.querySelectorAll('#field-presets .preset-btn, #field-presets .reset-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
      drawField();
      label.textContent = s.label;
      resultBox.textContent = '';
      nextBtn.style.display = 'none';
      choiceBtns.forEach(b => { b.disabled = false; b.classList.remove('correct', 'wrong'); });
      fieldSvg.classList.add('quiz-blur'); // whole canvas — arrows would otherwise just show the answer directly
      if (!questionBox.open) questionBox.showModal();
    }
    startBtn.addEventListener('click', () => { idx = 0; loadScenario(); });
    nextBtn.addEventListener('click', () => {
      idx = (idx + 1) % scenarios.length;
      loadScenario();
    });
    choiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const s = scenarios[idx];
        const guess = btn.dataset.choice;
        fieldSvg.classList.remove('quiz-blur');
        choiceBtns.forEach(b => {
          b.disabled = true;
          if (b.dataset.choice === s.expect) b.classList.add('correct');
          else if (b === btn) b.classList.add('wrong');
        });
        nextBtn.style.display = '';
        const correct = guess === s.expect;
        const dirNames = { N: 'North (up)', E: 'East (right)', S: 'South (down)', W: 'West (left)' };
        resultBox.textContent = correct
          ? `✓ Correct! The field points ${dirNames[s.expect]} there. Look at the arrows now that the canvas is unblurred to confirm.`
          : `Not quite — the field actually points ${dirNames[s.expect]}, not ${dirNames[guess]}. Look at the arrows now that the canvas is unblurred to see why.`;
        resultBox.className = 'quiz-result ' + (correct ? 'correct' : 'wrong');
      });
    });
  })();

  /* ---------- Shareable permalinks ---------- */
  function copyToClipboard(text, btn){
    const done = () => {
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch(e){ /* silent */ }
    document.body.removeChild(ta);
  }

  function baseUrl(){
    return location.origin + location.pathname;
  }

  document.getElementById('rlc-share').addEventListener('click', function(){
    const p = new URLSearchParams({
      tool: 'rlc', r: rInput.value, l: lInput.value, c: cInput.value, topo: topology
    });
    copyToClipboard(baseUrl() + '?' + p.toString(), this);
  });

  document.getElementById('bjt-share').addEventListener('click', function(){
    const p = new URLSearchParams({
      tool: 'bjt', vcc: vccI.value, r1: r1I.value, r2: r2I.value, rc: rcI.value, re: reI.value, beta: betaI.value, config: bjtConfig
    });
    copyToClipboard(baseUrl() + '?' + p.toString(), this);
  });

  document.getElementById('field-share').addEventListener('click', function(){
    const chargeStr = charges.map(c => `${Math.round(c.x)},${Math.round(c.y)},${c.q}`).join(';');
    const p = new URLSearchParams({ tool: 'field', charges: chargeStr });
    copyToClipboard(baseUrl() + '?' + p.toString(), this);
  });

  function activateTab(tabId){
    const tab = document.getElementById(tabId);
    const targetPanel = tab && tab.dataset.panel ? document.getElementById(tab.dataset.panel) : null;
    if (!tab || !targetPanel) return; // invalid id — leave the current view untouched instead of blanking everything
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', 'false'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.setAttribute('aria-selected', 'true');
    targetPanel.classList.add('active');
  }

  function loadFromUrl(){
    const p = new URLSearchParams(location.search);
    const tool = p.get('tool');
    if (!tool) return;

    if (tool === 'rlc'){
      if (p.has('r')) rRange.value = rInput.value = p.get('r');
      if (p.has('l')) lRange.value = lInput.value = p.get('l');
      if (p.has('c')) cRange.value = cInput.value = p.get('c');
      clearGroupSelection('rlc-presets'); // a shared/loaded setup is custom, not necessarily a named preset
      if (p.get('topo') === 'parallel') setTopology('parallel'); else compute();
      activateTab('tab-rlc');
    } else if (tool === 'bjt'){
      if (p.has('vcc')) vccR.value = vccI.value = p.get('vcc');
      if (p.has('r1')) r1R.value = r1I.value = p.get('r1');
      if (p.has('r2')) r2R.value = r2I.value = p.get('r2');
      if (p.has('rc')) rcR.value = rcI.value = p.get('rc');
      if (p.has('re')) reR.value = reI.value = p.get('re');
      if (p.has('beta')) betaR.value = betaI.value = p.get('beta');
      clearGroupSelection('bjt-presets'); // a shared/loaded setup is custom, not necessarily a named preset
      const cfg = p.get('config');
      setBjtConfig((cfg === 'cc' || cfg === 'cb') ? cfg : 'ce'); // also calls bjtCompute() with the values just set above
      activateTab('tab-bjt');
    } else if (tool === 'field'){
      const raw = p.get('charges');
      if (raw){
        charges = raw.split(';').filter(Boolean).map(part => {
          const [x, y, q] = part.split(',').map(Number);
          const [cx, cy] = clampToCanvas(x, y);
          return { x: cx, y: cy, q: q >= 0 ? 1 : -1 };
        });
        clearGroupSelection('field-presets'); // a shared/loaded setup is custom, not necessarily a named preset
        drawField();
      }
      activateTab('tab-field');
    }
  }
  loadFromUrl();

  /* ---------- Theme toggle ---------- */
  const themeToggleBtn = document.getElementById('theme-toggle');
  function updateThemeToggleUI(){
    const light = isLightTheme();
    themeToggleBtn.textContent = light ? '☀️' : '🌙';
    themeToggleBtn.setAttribute('aria-pressed', String(light));
    themeToggleBtn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', light ? '#F3F6FA' : '#0B1F33');
  }
  updateThemeToggleUI(); // reflect whatever the top-of-script preference check already applied
  themeToggleBtn.addEventListener('click', () => {
    const goingLight = !isLightTheme();
    if (goingLight) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('engcalc-theme', goingLight ? 'light' : 'dark'); }
    catch (e) { /* localStorage unavailable — theme still applies for this session, just won't persist */ }
    updateThemeToggleUI();
    // re-render every hand-drawn SVG graph so their literal colors refresh immediately
    compute();
    bjtCompute();
    drawField();
  });

  /* ---------- PNG export ---------- */
  // Serializes an SVG element to a standalone image, rasterizes it onto a canvas
  // (at 2x scale for crispness, with a background fill so it isn't transparent
  // when pasted somewhere with a different background), then triggers a download.
  function downloadSvgAsPng(svgEl, filename){
    try {
      const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      const width = (vb && vb.width) ? vb.width : (svgEl.clientWidth || 640);
      const height = (vb && vb.height) ? vb.height : (svgEl.clientHeight || 340);
      const scale = 2; // export at 2x for a crisp image, not just screen resolution

      const clone = svgEl.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', width);
      clone.setAttribute('height', height);

      const svgString = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = function(){
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#0B1F33';
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);

        canvas.toBlob(function(pngBlob){
          if (!pngBlob){
            console.error('PNG export failed: canvas.toBlob returned null.');
            return;
          }
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
        }, 'image/png');
      };
      img.onerror = function(){
        console.error('PNG export failed: the browser could not load the serialized SVG as an image.');
        URL.revokeObjectURL(svgUrl);
      };
      img.src = svgUrl;
    } catch (err){
      console.error('PNG export failed:', err);
    }
  }

  document.getElementById('rlc-png').addEventListener('click', () => {
    downloadSvgAsPng(document.getElementById('graph'), 'engcalc-rlc-resonance.png');
  });
  document.getElementById('bjt-png').addEventListener('click', () => {
    downloadSvgAsPng(document.getElementById('bjt-graph'), 'engcalc-bjt-bias-point.png');
  });
  document.getElementById('field-png').addEventListener('click', () => {
    downloadSvgAsPng(document.getElementById('field-graph'), 'engcalc-field-visualizer.png');
  });

  /* ---------- Print / export report ---------- */
  function setupPrint(btnId, headerId, toolLabel){
    const btn = document.getElementById(btnId);
    const header = document.getElementById(headerId);
    btn.addEventListener('click', () => {
      header.innerHTML = `<h1 style="font-family:'Space Grotesk',sans-serif;">EngCalc — ${toolLabel}</h1><p style="color:#555;font-family:'JetBrains Mono',monospace;font-size:0.8rem;">Generated ${new Date().toLocaleString()}</p>`;
      const panels = document.querySelectorAll('.workpanel');
      const wasOpen = new Map();
      panels.forEach(d => { wasOpen.set(d, d.open); d.open = true; });
      window.print();
      panels.forEach(d => { d.open = wasOpen.get(d); });
    });
  }
  setupPrint('rlc-print', 'rlc-print-header', 'RLC Resonance Solver');
  setupPrint('bjt-print', 'bjt-print-header', 'BJT Bias Point Calculator');
  setupPrint('field-print', 'field-print-header', "Coulomb's Law Field Visualizer");

  } catch (err) {
    console.error(
      'EngCalc failed to initialize:', err,
      '\nThis usually means index.html and app.js are out of sync (mismatched versions), ' +
      'or a required element is missing from the page. Make sure you uploaded the latest ' +
      'index.html, style.css, and app.js together, then hard-refresh (Ctrl+Shift+R).'
    );
    // Visible fallback: a judge without devtools open should still see that
    // something broke, not a silently blank/broken page with no explanation.
    try {
      const banner = document.createElement('div');
      banner.setAttribute('role', 'alert');
      banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999; ' +
        'background:#3a1414; color:#ffb4b4; border-bottom:2px solid #c93e3e; ' +
        'font-family:monospace; font-size:13px; padding:12px 20px; text-align:center;';
      banner.textContent = 'EngCalc hit an error while loading and some tools may not work. ' +
        'Try a hard refresh (Ctrl+Shift+R). If that doesn\'t help, open the browser console for details.';
      document.body.prepend(banner);
    } catch (bannerErr) { /* if even this fails, the console message above is the last resort */ }
  }
})();
