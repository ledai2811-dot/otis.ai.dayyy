/* =========================================================
   OTIS — AI Agent bio landing · interactions & 3D scene
   ========================================================= */
(() => {
  "use strict";

  const YT_ID = "8SicfKsKh3o";
  const YT_URL = `https://www.youtube.com/watch?v=${YT_ID}`;
  const LOCAL_AUDIO = "assets/audio/theme.mp3";
  const MUSIC_BPM = 100;

  /* Loudness levelling for the YouTube track.
     The intro of the video is mixed quieter than the rest. YouTube cannot be
     amplified past 100, so the intro plays at full volume and the louder part
     is brought down to match: volume = slider × gain(time).
     [time in seconds, gain 0..1] — tune these if the balance is off.        */
  const MUSIC_LEVELS = [
    [0, 1.0],
    [22, 1.0],
    [26, 0.6],
  ];
  const LOOP_GUARD = 0.35;   // restart this many seconds before the end (no gap, no end screen)

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const lerp = (a, b, t) => a + (b - a) * t;

  const state = {
    mx: 0, my: 0,          // normalised mouse -1..1
    hero: 0,               // 0..1 how far past the hero section
    scroll: 0,             // 0..1 page progress
    playing: false,
    beat: 0,
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
  };

  /* ---------------- music ----------------
     1) assets/audio/theme.mp3 if it exists (compressed so loudness stays even,
        and it drives the 3D beat)
     2) otherwise the YouTube video through a hidden embed, levelled + looped
     3) if YouTube refuses the embed, the button opens the video instead   */
  const playerEl = $("#player");
  const playBtn = $("#playBtn");
  const volEl = $("#vol");
  const labelEl = $("#playerLabel");
  let mode = "probe";            // probe | local | yt | error
  let wantPlay = false;
  let yt = null, ytReady = false;
  let analyser = null, freq = null;

  const VOL_KEY = "otis-vol2";
  const savedVol = parseInt(store.get(VOL_KEY), 10);
  if (!Number.isNaN(savedVol)) volEl.value = savedVol;

  function gainAt(t) {
    const L = MUSIC_LEVELS;
    if (t <= L[0][0]) return L[0][1];
    for (let i = 1; i < L.length; i++) {
      if (t <= L[i][0]) {
        const [t0, g0] = L[i - 1], [t1, g1] = L[i];
        return g0 + (g1 - g0) * ((t - t0) / (t1 - t0 || 1));
      }
    }
    return L[L.length - 1][1];
  }

  function setPlayingUI(on) {
    state.playing = on;
    playerEl.classList.toggle("is-playing", on);
    labelEl.textContent = on ? "ĐANG PHÁT" : "NHẠC NỀN";
    playBtn.setAttribute("aria-label", on ? "Tạm dừng nhạc nền" : "Phát nhạc nền");
  }
  function setErrorUI() {
    mode = "error";
    setPlayingUI(false);
    playerEl.classList.add("is-error");
    labelEl.textContent = "MỞ YOUTUBE ↗";
    playBtn.setAttribute("aria-label", "Mở nhạc nền trên YouTube");
  }

  // 1) local file
  const audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";
  audio.addEventListener("canplay", () => {
    if (mode !== "probe") return;
    mode = "local";
    audio.volume = volEl.value / 100;
    if (wantPlay) playMusic();
  });
  audio.addEventListener("error", () => { if (mode === "probe") { mode = "yt"; loadYouTube(); } });
  audio.addEventListener("play", () => setPlayingUI(true));
  audio.addEventListener("pause", () => setPlayingUI(false));
  audio.addEventListener("ended", () => { audio.currentTime = 0; audio.play().catch(() => {}); });
  audio.src = LOCAL_AUDIO;

  // compressor + make-up gain: quiet passages come up, loud ones are held back
  function attachAudioGraph() {
    if (analyser) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(audio);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 20;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.35;
      const makeup = ctx.createGain();
      makeup.gain.value = 2.2;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(comp).connect(makeup).connect(analyser).connect(ctx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      if (ctx.state === "suspended") ctx.resume();
    } catch (_) { analyser = null; }
  }
  state.level = () => {
    if (!analyser || !state.playing) return -1;
    analyser.getByteFrequencyData(freq);
    let sum = 0;
    for (let i = 1; i < 12; i++) sum += freq[i];
    return sum / (11 * 255);
  };

  // 2) YouTube
  let lastYtVol = -1;
  function applyYtVolume(t) {
    const v = Math.round(+volEl.value * gainAt(t));
    if (v !== lastYtVol) { yt.setVolume(v); lastYtVol = v; }
  }
  function loadYouTube() {
    window.onYouTubeIframeAPIReady = () => {
      yt = new YT.Player("yt", {
        videoId: YT_ID,
        width: 200, height: 200,
        playerVars: { autoplay: 0, controls: 0, playsinline: 1, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: () => {
            ytReady = true;
            applyYtVolume(0);
            if (wantPlay) playMusic();
          },
          onStateChange: (e) => {
            setPlayingUI(e.data === YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.ENDED && wantPlay) { yt.seekTo(0, true); yt.playVideo(); }
          },
          onError: setErrorUI,   // 101/150 = owner disabled playback on other sites
        },
      });
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = setErrorUI;
    document.head.appendChild(tag);

    // level the volume over time and restart just before the end
    setInterval(() => {
      if (!ytReady || mode !== "yt") return;
      const t = yt.getCurrentTime() || 0;
      const dur = yt.getDuration() || 0;
      if (wantPlay && dur > 0 && t >= dur - LOOP_GUARD) { yt.seekTo(0, true); yt.playVideo(); applyYtVolume(0); return; }
      applyYtVolume(t);
    }, 150);
  }

  function playMusic() {
    wantPlay = true;
    if (mode === "local") {
      attachAudioGraph();
      audio.play().catch(() => {});
    } else if (mode === "yt" && ytReady) {
      yt.unMute();
      applyYtVolume(yt.getCurrentTime() || 0);
      yt.playVideo();
    }
  }
  function pauseMusic() {
    wantPlay = false;
    if (mode === "local") audio.pause();
    else if (mode === "yt" && ytReady) yt.pauseVideo();
  }
  playBtn.addEventListener("click", () => {
    if (mode === "error") { window.open(YT_URL, "_blank", "noopener"); return; }
    if (state.playing || wantPlay) pauseMusic(); else playMusic();
  });
  volEl.addEventListener("input", () => {
    audio.volume = volEl.value / 100;
    if (ytReady) applyYtVolume(yt.getCurrentTime() || 0);
    store.set(VOL_KEY, volEl.value);
  });

  /* ---------------- boot gate ---------------- */
  const gate = $("#gate");
  const term = $("#gateTerm");
  const bootLines = [
    ["> khởi động giao thức OTIS...", ""],
    ["> quét tần số: 0x07 · 0x1F · 0xAI", "dim"],
    ["> xác thực tín hiệu ............ OK", ""],
    ["> giải mã danh tính ............ BỊ CHẶN", "err"],
    ["> kết nối an toàn đã sẵn sàng.", ""],
  ];
  let bootAlive = true;
  (async function boot() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(300);
    for (const [text, cls] of bootLines) {
      const line = document.createElement("span");
      if (cls) line.className = cls;
      term.appendChild(line);
      for (let i = 0; i <= text.length; i++) {
        if (!bootAlive) return;
        line.textContent = text.slice(0, i);
        await wait(reduceMotion ? 0 : 14 + Math.random() * 18);
      }
      term.appendChild(document.createTextNode("\n"));
      await wait(reduceMotion ? 0 : 160);
    }
  })();

  function enter(withSound) {
    bootAlive = false;
    if (withSound) playMusic();
    gate.classList.add("is-out");
    document.body.classList.remove("is-locked");
    document.body.classList.add("is-entered");
    setTimeout(() => { gate.remove(); }, 1000);
    startTyper();
    window.scrollTo(0, 0);
  }
  $("#gateBtn").addEventListener("click", () => enter(true));
  $("#gateMute").addEventListener("click", () => enter(false));

  /* ---------------- clock ---------------- */
  const clock = $("#clock");
  const pad = (n) => String(n).padStart(2, "0");
  setInterval(() => {
    const d = new Date();
    clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }, 1000);
  $("#year").textContent = new Date().getFullYear();

  /* ---------------- typer ---------------- */
  const typerEl = $("#typer");
  const typerLines = [
    "Không ai biết tôi là ai.",
    "Tôi chỉ là một tín hiệu trong bóng tối.",
    "AI Agent · danh tính đã được mã hoá.",
    "Bắt được tín hiệu? Hãy kết nối.",
  ];
  let typerStarted = false;
  function startTyper() {
    if (typerStarted) return;
    typerStarted = true;
    let li = 0, ci = 0, deleting = false;
    const step = () => {
      const line = typerLines[li];
      ci += deleting ? -1 : 1;
      typerEl.textContent = line.slice(0, ci);
      let delay = deleting ? 22 : 48 + Math.random() * 40;
      if (!deleting && ci === line.length) { deleting = true; delay = 2200; }
      else if (deleting && ci === 0) { deleting = false; li = (li + 1) % typerLines.length; delay = 400; }
      setTimeout(step, delay);
    };
    step();
  }

  /* ---------------- decrypt headings ---------------- */
  const GLYPHS = "▓▒░<>/\\|_-=+*#01ΔΣΞ";
  function decrypt(el) {
    const final = el.dataset.final || el.textContent;
    el.dataset.final = final;
    if (reduceMotion) { el.textContent = final; return; }
    let frame = 0;
    const total = final.length * 2 + 12;
    const id = setInterval(() => {
      let out = "";
      for (let i = 0; i < final.length; i++) {
        const ch = final[i];
        out += ch === " " || frame > i * 2 + 8 ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (++frame > total) { clearInterval(id); el.textContent = final; }
    }, 38);
  }

  /* ---------------- reveal on scroll ---------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const siblings = el.parentElement ? $$(":scope > .reveal", el.parentElement) : [];
      const idx = Math.max(0, siblings.indexOf(el));
      el.style.transitionDelay = `${idx * 90}ms`;
      el.classList.add("is-in");
      const h = el.querySelector("[data-decrypt]");
      if (h) decrypt(h);
      setTimeout(() => { el.style.transitionDelay = ""; }, 1200 + idx * 90);
      io.unobserve(el);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------------- redacted field ---------------- */
  $$(".redact").forEach((b) => {
    const original = b.textContent;
    b.addEventListener("click", () => {
      const open = b.classList.toggle("is-open");
      b.textContent = open ? b.dataset.reveal : original;
    });
  });

  /* ---------------- pointer tracking & cursor ---------------- */
  const cursor = finePointer ? $(".cursor") : null;
  let cx = innerWidth / 2, cy = innerHeight / 2;
  if (cursor) document.body.classList.add("has-cursor");

  // the custom cursor moves right here, on the event — no easing, and not tied
  // to the render loop, so it stays glued to the pointer even when 3D is busy
  window.addEventListener("pointermove", (e) => {
    cx = e.clientX; cy = e.clientY;
    state.mx = (e.clientX / innerWidth) * 2 - 1;
    state.my = (e.clientY / innerHeight) * 2 - 1;
    if (cursor && e.pointerType === "mouse") {
      cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      cursor.classList.add("is-ready");
    }
  }, { passive: true });
  if (cursor) {
    document.addEventListener("pointerover", (e) => {
      cursor.classList.toggle("is-hover", !!e.target.closest("a, button, input, .carousel, .av"));
    });
    document.addEventListener("mouseleave", () => cursor.classList.remove("is-ready"));
    window.addEventListener("pointerdown", () => cursor.classList.add("is-down"));
    window.addEventListener("pointerup", () => cursor.classList.remove("is-down"));
  }

  window.addEventListener("scroll", () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    state.scroll = max > 0 ? scrollY / max : 0;
    state.hero = Math.min(1, scrollY / innerHeight);
  }, { passive: true });

  /* ---------------- hero holo tilt ---------------- */
  const holoInner = $("#holoInner");
  const holoCard = $(".holo__card");
  let hx = 0, hy = 0;

  /* ---------------- interactive avatar ----------------
     Layers authored in a 900×900 space and scaled to the card:
     body → aura → bowed head (eyes/mouth live) → black hole (Three.js) → hands → arcs.
     Each forearm pivots at its elbow and reaches for its palm target, so
     Otis' hands stay cupped around the black hole as the pointer moves it.  */
  const avatar = initAvatar();

  function initAvatar() {
    const card = $("#avatarCard");
    const av = $("#av");
    if (!card || !av) return null;
    const head = $("#avHead"), aura = $("#avAura"), under = $("#avUnder");
    const eyes = $$(".av__eye", av), bars = $$("#avMouth i");
    const arcs = $("#avArcs"), holeCanvas = $("#avOrb");
    const actx = arcs.getContext("2d");

    const REST = { x: 450, y: 680 };   // the singularity, in front of the chest
    const HOLE_R = 66;                 // event horizon radius, scene px
    const CANVAS = 520;                // black-hole canvas size, scene px
    // Otis' gloved hands in a clawed, energy-gathering pose: each layer is a
    // glove + cuff + jacket sleeve. pivot = the sleeve end (the elbow, outside
    // the frame); grip = where the energy sits between the claws (image px).
    const hands = [
      { el: $("#handL"), side: -1, pivot: { x: 40, y: 332 }, grip: { x: 526, y: 114 } },
      { el: $("#handR"), side: 1, pivot: { x: 426, y: 339 }, grip: { x: -70, y: 131 } },
    ].map((h) => {
      const v0 = { x: h.grip.x - h.pivot.x, y: h.grip.y - h.pivot.y };
      h.len0 = Math.hypot(v0.x, v0.y);
      h.ang0 = Math.atan2(v0.y, v0.x);
      h.u0 = { x: v0.x / h.len0, y: v0.y / h.len0 };
      h.E = { x: REST.x - v0.x, y: REST.y - v0.y };   // elbow, in scene space
      h.T = { x: 0, y: 0 };
      h.u = { x: 0, y: 0 };
      h.el.style.transformOrigin = `${h.pivot.x}px ${h.pivot.y}px`;
      return h;
    });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const hole = initBlackHole(holeCanvas);
    let k = 0.444, dpr = 1, visible = true;

    function resize() {
      k = card.clientWidth / 900 || k;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      av.style.setProperty("--k", k);
      arcs.width = Math.round(900 * k * dpr);
      arcs.height = Math.round(900 * k * dpr);
      if (hole) { hole.renderer.setPixelRatio(k * dpr); hole.renderer.setSize(CANVAS, CANVAS, false); }
    }
    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(card);
    else window.addEventListener("resize", resize);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(card);

    const S = { ox: REST.x, oy: REST.y, spin: 0, lastPX: null, blinkT: 2.5, blinkLeft: 0 };

    function bolt(ax, ay, bx, by, amp) {
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const segs = 9;
      actx.beginPath();
      actx.moveTo(ax, ay);
      for (let i = 1; i < segs; i++) {
        const f = i / segs;
        const off = (Math.random() * 2 - 1) * amp * Math.sin(f * Math.PI);
        actx.lineTo(ax + dx * f + nx * off, ay + dy * f + ny * off);
      }
      actx.lineTo(bx, by);
      actx.strokeStyle = "rgba(62,232,255,.2)";
      actx.lineWidth = 7;
      actx.stroke();
      actx.strokeStyle = "rgba(215,253,255,.9)";
      actx.lineWidth = 1.6;
      actx.stroke();
    }

    function update(t, dt) {
      if (!visible) return;
      const beat = state.beat || 0;

      // --- the singularity drifts towards the pointer within a small range
      const r = card.getBoundingClientRect();
      const kk = r.width / 900 || k;
      const px = (cx - r.left) / kk, py = (cy - r.top) / kk;
      const near = px > -200 && px < 1100 && py > -200 && py < 1100;
      let tx = REST.x, ty = REST.y;
      if (finePointer && near) {
        tx += clamp((px - REST.x) * 0.16, -55, 55);
        ty += clamp((py - REST.y) * 0.12, -35, 25);
      }
      if (near && S.lastPX !== null) S.spin += clamp(px - S.lastPX, -60, 60) * 0.004;
      S.lastPX = near ? px : null;
      S.spin *= Math.exp(-dt * 2.2);
      if (!reduceMotion) { tx += Math.sin(t * 0.7) * 4; ty += Math.sin(t * 1.15) * 6; }
      const follow = 1 - Math.exp(-dt * 5);
      S.ox = lerp(S.ox, tx, follow);
      S.oy = lerp(S.oy, ty, follow);
      const ox = S.ox, oy = S.oy;
      const holeScale = 1 + beat * 0.05;

      // --- black hole + aura
      holeCanvas.style.transform = `translate(${ox - CANVAS / 2}px, ${oy - CANVAS / 2}px) scale(${holeScale})`;
      aura.style.transform = `translate(${ox - 320}px, ${oy - 320}px) scale(${0.85 + beat * 0.1})`;
      aura.style.opacity = 0.65;
      if (hole) hole.render(t, dt, { energy: 0, burst: 0, beat, spin: S.spin });

      // --- hands: each forearm pivots at its elbow and reaches for its palm target
      hands.forEach((h, i) => {
        const sway = reduceMotion ? 0 : Math.sin(t * 0.9 + i * 2) * 3;
        h.T.x = ox; h.T.y = oy;
        const ex = h.E.x + sway * 0.4, ey = h.E.y + sway;
        const vx = h.T.x - ex, vy = h.T.y - ey;
        const dist = Math.hypot(vx, vy) || 1;
        h.u.x = vx / dist; h.u.y = vy / dist;       // unit vector elbow → energy
        const ang = Math.atan2(vy, vx) - h.ang0;
        const slide = dist - h.len0;
        h.el.style.transform = `translate(${ex - h.pivot.x}px, ${ey - h.pivot.y}px) rotate(${ang}rad) translate(${h.u0.x * slide}px, ${h.u0.y * slide}px)`;
      });

      // --- head bows over the hole and tracks it; eyes follow it
      const turn = clamp((ox - 450) * 0.06, -10, 10);
      const roll = clamp((ox - 450) * 0.02, -4, 4);
      head.style.transform = `translateY(16px) rotateX(-22deg) rotateY(${turn}deg) rotateZ(${roll}deg)`;
      S.blinkT -= dt;
      if (S.blinkT <= 0) { S.blinkLeft = 0.14; S.blinkT = 2.5 + Math.random() * 4; }
      S.blinkLeft = Math.max(0, S.blinkLeft - dt);
      const blink = S.blinkLeft > 0 ? 0.12 : 1;
      eyes.forEach((el) => {
        el.style.setProperty("--ex", `${clamp((ox - 450) * 0.05, -8, 8)}px`);
        el.style.setProperty("--ey", `${clamp((oy - 600) * 0.04, -2, 5)}px`);
        el.style.setProperty("--blink", blink);
      });
      under.style.opacity = Math.min(1, 0.45 + beat * 0.25);

      // --- mouth: waveform, livelier with the music
      const amp = state.playing ? 0.35 + beat * 0.65 : 0.12;
      bars.forEach((bar, j) => {
        const env = 1 - Math.abs(j - 6) / 7.5;
        const wobble = 0.5 + 0.5 * Math.sin(t * (7 + j * 0.9) + j * 1.3);
        bar.style.transform = `scaleY(${clamp(0.12 + amp * env * wobble, 0.1, 1)})`;
      });

      // --- faint energy drawn off the fingertips into the hole
      actx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      actx.clearRect(0, 0, 900, 900);
      actx.globalCompositeOperation = "lighter";
      actx.lineCap = "round";
      actx.lineJoin = "round";
      const R = HOLE_R * holeScale * 1.2;
      hands.forEach((h) => {
        if (Math.random() > 0.14 + beat * 0.4) return;
        // fingertips sit a little short of the grip point, fanned across the claw
        const fan = (Math.random() - 0.5) * 170;
        const fx = h.T.x - h.u.x * 70 - h.u.y * fan;
        const fy = h.T.y - h.u.y * 70 + h.u.x * fan;
        const a = Math.atan2(fy - oy, fx - ox) + (Math.random() - 0.5) * 0.6;
        bolt(fx, fy, ox + Math.cos(a) * R, oy + Math.sin(a) * R, 10);
      });
      actx.globalCompositeOperation = "source-over";
    }

    return { update };
  }

  /* Black hole: opaque event horizon, a thin photon ring, a tilted swirling
     accretion disk, the lensed image of the disk's far side wrapped around
     the horizon, and matter spiralling inwards.                              */
  function initBlackHole(canvas) {
    if (!window.THREE || !canvas) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch (_) { return null; }
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
    camera.position.z = 8.25;   // 1 world unit ≈ 100 scene px on a 520px canvas

    const H = 0.66;   // horizon radius (world units)
    const horizon = new THREE.Mesh(new THREE.SphereGeometry(H, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    scene.add(horizon);

    const NOISE = `
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }`;
    const VERT = `varying vec2 vPos; void main(){ vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const uniforms = { uTime: { value: 0 }, uEnergy: { value: 0 } };

    // accretion disk (tilted, swirling, brighter on the approaching side)
    const diskMat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      fragmentShader: `
        uniform float uTime; uniform float uEnergy; varying vec2 vPos; ${NOISE}
        void main(){
          float r = length(vPos);
          float a = atan(vPos.y, vPos.x);
          float t = clamp((r - 0.8) / (2.05 - 0.8), 0.0, 1.0);
          float s = a + 2.4 / (r + 0.15) - uTime * (0.9 + uEnergy * 2.5) / (r * r + 0.25);
          vec2 q = vec2(cos(s), sin(s));
          float n = noise(q * 2.2 + vec2(r * 7.0 - uTime * 0.3)) * 0.65 + noise(q * 6.0 + vec2(r * 18.0)) * 0.35;
          float band = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.45, 1.0, t));
          float heat = pow(1.0 - t, 2.4);
          vec3 col = mix(vec3(0.18, 0.22, 0.85), vec3(0.25, 0.9, 1.0), smoothstep(0.0, 0.7, 1.0 - t));
          col = mix(col, vec3(1.0), heat * 0.75);
          float doppler = 0.75 - 0.45 * cos(a);   // approaching (left) side brighter
          float alpha = band * (0.3 + n * 0.95) * (0.5 + heat * 1.6) * doppler * (1.0 + uEnergy * 0.9);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }`,
    });
    const tilt = new THREE.Group();
    tilt.rotation.set(-1.08, 0, 0.22);
    scene.add(tilt);
    tilt.add(new THREE.Mesh(new THREE.RingGeometry(0.8, 2.05, 160, 1), diskMat));

    // lensed far side of the disk, wrapped around the horizon facing the camera
    const lensMat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      fragmentShader: `
        uniform float uTime; uniform float uEnergy; varying vec2 vPos; ${NOISE}
        void main(){
          float r = length(vPos);
          float a = atan(vPos.y, vPos.x);
          float s = a - uTime * (1.4 + uEnergy * 3.0);
          vec2 q = vec2(cos(s), sin(s));
          float n = noise(q * 3.0 + vec2(r * 10.0)) * 0.7 + 0.3;
          float fall = exp(-(r - 0.68) * 6.0);
          float topBias = 0.45 + 0.55 * smoothstep(-0.6, 0.8, vPos.y / max(r, 0.001));
          float alpha = fall * n * topBias * (1.4 + uEnergy * 0.8);
          vec3 col = mix(vec3(0.3, 0.9, 1.0), vec3(1.0), fall * 0.6);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }`,
    });
    const lens = new THREE.Mesh(new THREE.RingGeometry(H + 0.02, 1.3, 128, 1), lensMat);
    lens.position.z = -0.05;
    scene.add(lens);

    // photon ring
    const photon = new THREE.Mesh(new THREE.RingGeometry(H - 0.005, H + 0.045, 128, 1), new THREE.MeshBasicMaterial({ color: 0xe6fdff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    photon.position.z = 0.01;
    scene.add(photon);

    // matter spiralling in, in the plane of the disk
    const c2 = document.createElement("canvas");
    c2.width = c2.height = 64;
    const g2 = c2.getContext("2d");
    const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.3, "rgba(160,245,255,.6)");
    grd.addColorStop(1, "rgba(62,232,255,0)");
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c2);
    const M = 220;
    const mpos = new Float32Array(M * 3);
    const bits = Array.from({ length: M }, () => ({ r: 0.8 + Math.random() * 1.6, a: Math.random() * 6.283, z: (Math.random() - 0.5) * 0.06 }));
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3));
    const motes = new THREE.Points(mgeo, new THREE.PointsMaterial({ size: 0.06, map: tex, color: 0xbff8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    tilt.add(motes);

    let clock = 0;
    return {
      renderer,
      render(t, dt, p) {
        const speed = reduceMotion ? 0.3 : 1;
        clock += dt * (1 + p.energy * 1.5 + Math.abs(p.spin) * 0.6) * speed;
        uniforms.uTime.value = clock;
        uniforms.uEnergy.value = p.energy + p.beat * 0.3 + p.burst * 0.8;
        tilt.rotation.z = 0.22 + Math.sin(t * 0.3) * 0.05 + p.spin * 0.02;
        photon.material.opacity = Math.min(1, 0.75 + p.energy * 0.25 + p.beat * 0.2);
        const pull = 1 + p.energy * 3;
        for (let i = 0; i < M; i++) {
          const m = bits[i];
          m.a += dt * speed * (0.8 / Math.pow(m.r, 1.5)) * pull;
          m.r -= dt * speed * 0.12 * pull / m.r;
          if (m.r < H + 0.04) { m.r = 1.8 + Math.random() * 0.6; m.a = Math.random() * 6.283; }
          mpos[i * 3] = Math.cos(m.a) * m.r;
          mpos[i * 3 + 1] = Math.sin(m.a) * m.r;
          mpos[i * 3 + 2] = m.z;
        }
        mgeo.attributes.position.needsUpdate = true;
        renderer.render(scene, camera);
      },
    };
  }

  /* ---------------- link card tilt ---------------- */
  if (finePointer && !reduceMotion) {
    $$(".link-card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
        card.style.setProperty("--rx", `${(0.5 - y) * 12}deg`);
        card.style.setProperty("--mx", `${x * 100}%`);
        card.style.setProperty("--my", `${y * 100}%`);
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  /* ---------------- 3D carousel ---------------- */
  const carousel = $("#carousel");
  const stage = $("#stage");
  const items = $$(".carousel__item", stage);
  const STEP = 360 / items.length;
  let rot = 0, vel = 0, dragging = false, lastX = 0, idleT = 0, carouselVisible = false;

  new IntersectionObserver(([e]) => { carouselVisible = e.isIntersecting; }, { threshold: 0 }).observe(carousel);

  carousel.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; vel = 0;
    carousel.classList.add("is-drag");
    carousel.setPointerCapture(e.pointerId);
  });
  carousel.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    rot += dx * 0.35;
    vel = dx * 0.35;
  });
  const endDrag = () => { dragging = false; idleT = 0; carousel.classList.remove("is-drag"); };
  carousel.addEventListener("pointerup", endDrag);
  carousel.addEventListener("pointercancel", endDrag);

  function updateCarousel(dt) {
    if (!dragging) {
      vel *= 0.94;
      idleT += dt;
      if (Math.abs(vel) < 0.05 && idleT > 1.2 && !reduceMotion) {
        // auto-rotate, easing towards a gentle constant spin
        vel = lerp(vel, -0.18, 0.02);
      }
      rot += vel;
    }
    stage.style.setProperty("--rot", `${rot}deg`);
    items.forEach((it, i) => {
      const deg = i * STEP + rot;
      const a = (deg * Math.PI) / 180;
      // place on the ring, then turn back to face the viewer (billboard)
      it.style.transform = `rotateY(${i * STEP}deg) translateZ(var(--r)) rotateY(${-deg}deg)`;
      const facing = (Math.cos(a) + 1) / 2; // 1 = front, 0 = back
      it.style.opacity = (0.18 + facing * 0.82).toFixed(3);
      it.style.filter = `brightness(${(0.35 + facing * 0.75).toFixed(3)})`;
    });
  }

  /* ---------------- Three.js background ---------------- */
  const scene3d = initScene();

  function initScene() {
    const canvas = $("#bg3d");
    if (!window.THREE || !canvas) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (_) { return null; }

    const small = innerWidth < 760;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.setClearColor(0x03060a, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03060a, 0.042);
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 0, 12);

    const CYAN = 0x3ee8ff;

    // soft round sprite for points
    const spriteCanvas = document.createElement("canvas");
    spriteCanvas.width = spriteCanvas.height = 64;
    const sctx = spriteCanvas.getContext("2d");
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(160,245,255,.9)");
    grad.addColorStop(1, "rgba(62,232,255,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(spriteCanvas);

    // --- star / dust field
    const N = small ? 1100 : 2400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 38;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.sin(p) * Math.sin(t) * 0.6;
      pos[i * 3 + 2] = r * Math.cos(p);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      size: 0.16, map: sprite, color: CYAN, transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(dust);

    // --- neural network cloud
    const net = new THREE.Group();
    const NODES = small ? 46 : 80;
    const nodes = [];
    for (let i = 0; i < NODES; i++) {
      nodes.push(new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 16, -6 - Math.random() * 14));
    }
    const linePos = [];
    for (let i = 0; i < NODES; i++) {
      for (let j = i + 1; j < NODES; j++) {
        if (nodes[i].distanceTo(nodes[j]) < 4.6) linePos.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
    net.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })));
    const nodeGeo = new THREE.BufferGeometry().setFromPoints(nodes);
    net.add(new THREE.Points(nodeGeo, new THREE.PointsMaterial({ size: 0.32, map: sprite, color: CYAN, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
    scene.add(net);

    // --- AI core
    const core = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(2.7, 1), new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.16 }));
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 0), new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.42 }));
    const vertPts = new THREE.Points(outer.geometry, new THREE.PointsMaterial({ size: 0.22, map: sprite, color: 0xbff8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: CYAN, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(6, 6, 1);
    core.add(outer, inner, vertPts, glow);
    const orbits = [];
    [[3.6, 1.2, 0.2], [4.1, -0.5, 0.9], [4.6, 0.3, -0.7]].forEach(([r, ax, az], i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 160), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35 - i * 0.07 }));
      ring.rotation.set(ax, 0, az);
      const sat = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sat.scale.set(0.5, 0.5, 1);
      ring.add(sat);
      core.add(ring);
      orbits.push({ ring, sat, r, speed: 0.5 + i * 0.25, phase: i * 2 });
    });
    scene.add(core);

    // --- tron floor
    const grid = new THREE.GridHelper(160, 100, CYAN, 0x0b3441);
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    grid.position.y = -6;
    scene.add(grid);

    const coreHome = new THREE.Vector3();
    function layout() {
      const wide = innerWidth > 960;
      coreHome.set(wide ? 4.6 : 0, wide ? 0.2 : 2.2, wide ? -3 : -6);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight, false);
    }
    layout();
    window.addEventListener("resize", layout);

    const cam = { x: 0, y: 0 };
    return {
      render(t) {
        const speed = reduceMotion ? 0.2 : 1;
        const s = state.scroll;

        dust.rotation.y = t * 0.012 * speed;
        dust.rotation.x = Math.sin(t * 0.05) * 0.05;
        net.rotation.y = Math.sin(t * 0.04) * 0.25 + s * 0.6;
        net.position.y = s * 6;

        outer.rotation.set(t * 0.12 * speed, t * 0.18 * speed + s * 4, 0);
        inner.rotation.set(-t * 0.3 * speed, -t * 0.22 * speed, t * 0.1);
        vertPts.rotation.copy(outer.rotation);
        orbits.forEach((o) => {
          const a = t * o.speed * speed + o.phase;
          o.sat.position.set(Math.cos(a) * o.r, Math.sin(a) * o.r, 0);
          o.ring.rotation.y = t * 0.1 * o.speed * speed;
        });

        // beat pulse while music plays
        const beat = state.beat;
        const sc = 1 + beat * 0.06 + Math.sin(t * 1.3) * 0.015;
        core.scale.setScalar(sc * (1 - s * 0.25));
        // drift up and away once the hero is left behind
        const h = state.hero;
        core.position.set(coreHome.x + h * 3, coreHome.y + h * 3.5, coreHome.z - h * 10);
        glow.material.opacity = 0.28 + beat * 0.35;

        grid.position.z = (t * 1.8 * speed) % 1.6;

        cam.x = lerp(cam.x, state.mx * 1.4, 0.04);
        cam.y = lerp(cam.y, -state.my * 0.9, 0.04);
        camera.position.set(cam.x, cam.y - s * 2.5, 12 - s * 3);
        camera.lookAt(0, -s * 1.5, -4);

        renderer.render(scene, camera);
      },
    };
  }

  /* ---------------- main loop ---------------- */
  let last = performance.now();
  function frame(now) {
    // rAF timestamps can start slightly behind performance.now(): never let dt go negative
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const t = now / 1000;

    // hero holo tilt (follows the pointer anywhere on screen)
    if (holoInner && !reduceMotion) {
      hx = lerp(hx, state.mx, 0.07);
      hy = lerp(hy, state.my, 0.07);
      holoInner.style.setProperty("--ry", `${hx * 9}deg`);
      holoInner.style.setProperty("--rx", `${-hy * 6}deg`);
      holoCard.style.setProperty("--gx", `${50 + hx * 40}%`);
      holoCard.style.setProperty("--gy", `${30 + hy * 40}%`);
    }

    let beat = 0;
    if (state.playing && !reduceMotion) {
      const lvl = state.level();
      beat = lvl >= 0 ? Math.pow(lvl, 2.2) * 1.6 : Math.pow(Math.max(0, Math.sin(t * Math.PI * (MUSIC_BPM / 60))), 12);
    }
    state.beat = beat;
    if (avatar) avatar.update(t, dt);

    if (carouselVisible) updateCarousel(dt);
    if (scene3d) scene3d.render(t);
    requestAnimationFrame(frame);
  }
  updateCarousel(0);
  requestAnimationFrame(frame);
})();
