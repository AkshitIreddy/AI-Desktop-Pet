(() => {
  const P = window.__pet;
  const dir = P.runtime.director;
  const env = dir.env;

  // ---- geometry -----------------------------------------------------------
  const CLIPW = __CLIPW__, CLIPH = __CLIPH__, TASKBAR = 62, PET = __PETSIZE__;
  const mons = (env.monitors && env.monitors.length)
    ? env.monitors
    : [{ left: 0, right: env.width, top: 0, bottom: env.height, floorY: env.height, primary: true }];
  const m = mons.find(x => x.primary) || mons[0];
  if (m.__origFloor == null) m.__origFloor = m.floorY; // survive reruns without drift
  const origFloor = m.__origFloor;
  const newFloor = origFloor - TASKBAR;
  m.floorY = newFloor;
  const clipX = m.left;
  const clipW = Math.min(CLIPW, m.right - m.left);
  const clipBottom = origFloor;
  const clipTop = clipBottom - CLIPH;
  const LX = ox => ox - clipX, LY = oy => oy - clipTop;

  // window rects (overlay coords)
  const codeW = 660, codeH = 470;
  const codeLeft = clipX + 400, codeRight = codeLeft + codeW;
  const codeTop = newFloor - codeH, codeBottom = newFloor;
  const brW = 520, brH = 340;
  const brLeft = clipX + 60, brTop = clipTop + 66;   // floating, decorative

  // ---- DOM ----------------------------------------------------------------
  ['__demoScene', '__demoStyle', '__demoBg', '__demoCss'].forEach(id => document.getElementById(id)?.remove());
  const st = document.createElement('style');
  st.id = '__demoStyle';
  st.textContent = `
  .pet,.pet-body,.pet img{opacity:1 !important}
  #__demoScene{position:fixed;left:${clipX}px;top:${clipTop}px;width:${clipW}px;height:${CLIPH}px;z-index:0;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
  #__demoScene .wall{position:absolute;inset:0;background:#0b1020 url("__WALL__") center/cover no-repeat}
  #__demoScene .win{position:absolute;border-radius:11px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 2px 0 rgba(255,255,255,.05) inset;overflow:hidden;border:1px solid rgba(255,255,255,.11)}
  #__demoScene .tb{display:flex;align-items:center;height:40px;padding:0 14px;gap:10px;color:#e8e8e8}
  #__demoScene .tb .dots{display:flex;gap:8px}
  #__demoScene .tb .dot{width:13px;height:13px;border-radius:50%}
  #__demoScene .tb .title{opacity:.85;font-size:13px}
  #__demoScene .tb .wc{margin-left:auto;display:flex;gap:20px;opacity:.6;font-size:14px}
  #__code{left:${LX(codeLeft)}px;top:${LY(codeTop)}px;width:${codeW}px;height:${codeH}px;background:#1e1e1e}
  #__code .tb{background:#323233;border-bottom:1px solid #000}
  #__code .body{display:flex;height:calc(100% - 40px)}
  #__code .side{width:52px;background:#333;flex:none}
  #__code .side i{display:block;width:26px;height:26px;margin:16px auto;border-radius:6px;opacity:.55}
  #__code .files{width:150px;background:#252526;flex:none;padding:12px 8px;font-size:13px;color:#bdbdbd}
  #__code .files b{display:block;color:#8a8a8a;font-size:11px;letter-spacing:.6px;margin:2px 6px 8px}
  #__code .files span{display:block;padding:4px 8px;border-radius:5px}
  #__code .files .on{background:#37373d;color:#fff}
  #__code .code{flex:1;padding:12px 16px;font-family:'Cascadia Code',Consolas,monospace;font-size:13.5px;line-height:1.62;overflow:hidden}
  #__code .code .ln{display:flex;white-space:pre}
  #__code .code .n{width:30px;color:#858585;text-align:right;margin-right:18px;flex:none}
  .k{color:#569cd6}.s{color:#ce9178}.c{color:#6a9955}.f{color:#dcdcaa}.t{color:#4ec9b0}.v{color:#9cdcfe}.o{color:#d4d4d4}.nm{color:#b5cea8}
  #__browser{left:${LX(brLeft)}px;top:${LY(brTop)}px;width:${brW}px;height:${brH}px;background:#fff}
  #__browser .tb{background:#dfe3ea;height:44px;color:#333}
  #__browser .tab{background:#fff;border-radius:9px 9px 0 0;padding:7px 14px;font-size:12.5px;display:flex;align-items:center;gap:7px;box-shadow:0 -1px 3px rgba(0,0,0,.08)}
  #__browser .addr{flex:1;background:#fff;border-radius:16px;height:26px;display:flex;align-items:center;gap:7px;padding:0 12px;font-size:12.5px;color:#555;border:1px solid #cfd4dc}
  #__browser .page{height:calc(100% - 44px);background:linear-gradient(160deg,#1b1233,#3a1d6e 55%,#e0508a);position:relative;color:#fff;padding:26px 28px}
  #__browser .page h1{font-size:26px;margin:10px 0 8px;font-weight:700}
  #__browser .page p{font-size:13.5px;opacity:.88;max-width:74%;line-height:1.55}
  #__browser .page .pill{display:inline-block;margin-top:18px;background:#fff;color:#3a1d6e;font-size:13px;font-weight:600;padding:8px 18px;border-radius:22px}
  #__browser .page .blob{position:absolute;border-radius:50%;filter:blur(7px);opacity:.5}
  #__tb{position:absolute;left:0;bottom:0;width:100%;height:${TASKBAR}px;background:rgba(26,26,32,.74);backdrop-filter:blur(24px) saturate(1.3);border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center}
  #__tb .mid{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center}
  #__tb .ic{width:38px;height:38px;border-radius:9px;display:flex;align-items:center;justify-content:center}
  #__tb .tray{position:absolute;right:18px;display:flex;align-items:center;gap:16px;color:#eaeaea;font-size:12.5px}
  #__tb .clock{text-align:right;line-height:1.25}
  `;
  document.head.appendChild(st);

  const svg = i => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">${i}</svg>`;
  const winLogo = `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="2" y="2" width="9" height="9" fill="#38bdf8"/><rect x="13" y="2" width="9" height="9" fill="#38bdf8"/><rect x="2" y="13" width="9" height="9" fill="#38bdf8"/><rect x="13" y="13" width="9" height="9" fill="#38bdf8"/></svg>`;
  const icFolder = svg('<path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z" fill="#f6c453"/><path d="M3 8h18v10a2 2 0 0 1-2 2H3z" fill="#e9b53d"/>');
  const icEdge = svg('<circle cx="12" cy="12" r="10" fill="#2b88d8"/><path d="M4 13c3-6 12-6 15-1-2-2-7-2-8 3-1 4-5 4-7-2z" fill="#7fd3ff"/>');
  const icCode = svg('<rect x="2" y="3" width="20" height="18" rx="3" fill="#1f6fb2"/><path d="M15 7l4 5-4 5M9 7l-4 5 4 5" stroke="#dff1ff" stroke-width="1.7" fill="none"/>');
  const icTerm = svg('<rect x="2" y="3" width="20" height="18" rx="3" fill="#1b1b22"/><path d="M6 8l4 4-4 4M12 16h6" stroke="#5eead4" stroke-width="1.7" fill="none"/>');
  const icStore = svg('<path d="M4 7h16l-2 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="#7c5cff"/><path d="M8 7a4 4 0 0 1 8 0" stroke="#dcd3ff" stroke-width="1.7" fill="none"/>');

  const scene = document.createElement('div');
  scene.id = '__demoScene';
  scene.innerHTML = `
  <div class="wall"></div>
  <div class="win" id="__browser">
    <div class="tb"><span class="tab">🌐 Convai · Desktop Pets</span><span class="addr">🔒 convai.com/desktop-pets</span></div>
    <div class="page">
      <div class="blob" style="width:150px;height:150px;background:#ff7ab6;top:-24px;right:-14px"></div>
      <div class="blob" style="width:110px;height:110px;background:#7c5cff;bottom:14px;right:70px"></div>
      <h1>Your desktop, alive.</h1>
      <p>AI companions that walk your screen, climb your windows, and chat with you — powered by Convai.</p>
      <span class="pill">Download for Windows</span>
    </div>
  </div>
  <div class="win" id="__code">
    <div class="tb"><span class="dots"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span></span><span class="title">PetEngine.ts — Convai Desktop Pets</span><span class="wc">&#9472; &#9723; &#10005;</span></div>
    <div class="body">
      <div class="side"><i style="background:#cfcfcf"></i><i style="background:#8fb3ff"></i><i style="background:#8fe0c0"></i><i style="background:#e0a0ff"></i></div>
      <div class="files"><b>EXPLORER</b><span>overlay/</span><span class="on">PetEngine.ts</span><span>behaviors.ts</span><span>runtime.ts</span><span>monitors.ts</span><span>platforms.ts</span></div>
      <div class="code">
        <div class="ln"><span class="n">1</span><span class="c">// shimeji physics — walk, climb, fall</span></div>
        <div class="ln"><span class="n">2</span><span class="k">export class</span><span class="o"> </span><span class="t">Pet</span><span class="o"> </span><span class="k">implements</span><span class="o"> </span><span class="t">PetHandle</span><span class="o"> {</span></div>
        <div class="ln"><span class="n">3</span><span class="o">  </span><span class="f">climbToPlatform</span><span class="o">(</span><span class="v">p</span><span class="o">: </span><span class="t">Platform</span><span class="o">) {</span></div>
        <div class="ln"><span class="n">4</span><span class="o">    </span><span class="k">const</span><span class="o"> </span><span class="v">side</span><span class="o"> = </span><span class="f">pickMountSide</span><span class="o">(</span><span class="v">p</span><span class="o">)</span></div>
        <div class="ln"><span class="n">5</span><span class="o">    </span><span class="k">this</span><span class="o">.</span><span class="v">walkTarget</span><span class="o"> = </span><span class="v">side</span><span class="o"> === </span><span class="s">'left'</span></div>
        <div class="ln"><span class="n">6</span><span class="o">      ? </span><span class="v">p</span><span class="o">.</span><span class="v">left</span><span class="o"> - </span><span class="k">this</span><span class="o">.</span><span class="v">size</span><span class="o"> : </span><span class="v">p</span><span class="o">.</span><span class="v">right</span></div>
        <div class="ln"><span class="n">7</span><span class="o">    </span><span class="k">this</span><span class="o">.</span><span class="f">setState</span><span class="o">(</span><span class="s">'climbing'</span><span class="o">)</span></div>
        <div class="ln"><span class="n">8</span><span class="o">  }</span></div>
        <div class="ln"><span class="n">9</span><span class="o">  </span><span class="f">tick</span><span class="o">(</span><span class="v">now</span><span class="o">: </span><span class="t">number</span><span class="o">) {</span></div>
        <div class="ln"><span class="n">10</span><span class="o">    </span><span class="k">if</span><span class="o"> (</span><span class="k">this</span><span class="o">.</span><span class="v">grounded</span><span class="o">) </span><span class="k">this</span><span class="o">.</span><span class="f">step</span><span class="o">()</span></div>
        <div class="ln"><span class="n">11</span><span class="o">    </span><span class="k">else</span><span class="o"> </span><span class="k">this</span><span class="o">.</span><span class="v">vy</span><span class="o"> += </span><span class="t">GRAVITY</span></div>
        <div class="ln"><span class="n">12</span><span class="o">  }</span></div>
        <div class="ln"><span class="n">13</span><span class="o">}</span></div>
      </div>
    </div>
  </div>
  <div id="__tb">
    <div class="mid">
      <div class="ic">${winLogo}</div><div class="ic">${icEdge}</div><div class="ic">${icFolder}</div><div class="ic">${icCode}</div><div class="ic">${icTerm}</div><div class="ic">${icStore}</div>
    </div>
    <div class="tray"><span>&#9650;</span><span>&#128246; &#128266;</span><span class="clock"><div>10:24 AM</div><div>7/11/2026</div></span></div>
  </div>`;
  document.body.appendChild(scene);

  // ---- pets ---------------------------------------------------------------
  P.appStore.state.settings.petSize = PET;
  P.appStore.state.settings.windowWalking = false;
  P.appStore.state.settings.cursorInteractions = false;
  for (const n of [...dir.pets.keys()]) dir.despawn(n);
  const banned = __BANNED__;
  const avail = Object.keys(P.appStore.state.characters).filter(n => !banned.includes(n));
  const want = __CAST__.filter(n => avail.includes(n));
  const cast = (want.length ? want : avail).slice(0, 4);
  for (const n of cast) dir.spawn(P.appStore.state.characters[n]);
  dir.setSuspended(true);

  const codeWin = { kind: 'window', windowId: 90001, y: codeTop, left: codeLeft, right: codeRight, bottom: codeBottom, cover: [] };
  const pets = [...dir.pets.values()];
  const n = pets.length;
  const spreadX = i => Math.round(clipX + 150 + (i + 0.5) * ((clipW - 320) / n));
  pets.forEach((p, i) => p.teleport(spreadX(i), newFloor - p.size));

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wander = async (p, a, b, sig) => {
    while (!sig.done) {
      await p.walkTo(a); if (sig.done) break;
      if (Math.random() < 0.55) await p.playSpecial(); else await sleep(280);
      if (sig.done) break;
      await p.walkTo(b); if (sig.done) break;
      await sleep(220);
    }
  };

  window.__demo = {
    clip: { clipX, clipY: clipTop, clipW, clipH: CLIPH },
    codeWin, stop: false,
    async cycle() {
      dir.env.platforms = [codeWin];
      const climber = dir.pets.get(cast[cast.length - 1]) || pets[pets.length - 1];
      const edger = dir.pets.get(cast[0]) || pets[0];
      const mids = pets.filter(p => p !== climber && p !== edger);
      // neutral spread (loop anchor)
      await Promise.all(pets.map((p, i) => p.walkTo(spreadX(i))));
      await sleep(320);
      const sig = { done: false };
      const midRuns = mids.map((p, i) => wander(p, spreadX(1) + i * 44, spreadX(2) + i * 28, sig));
      const climbSeq = (async () => {
        await climber.climbToPlatform(codeWin, 'right');
        await sleep(400); await climber.playSpecial(); await sleep(250);
        await climber.dismountPlatform();
      })();
      const edgeSeq = (async () => {
        await edger.walkTo(clipX + 44);
        await edger.climbEdge('left', newFloor - 300);
        await sleep(1100);
        await edger.climbEdge('left', newFloor - edger.size);
      })();
      await Promise.all([climbSeq, edgeSeq]);
      sig.done = true;
      await Promise.allSettled(midRuns);
      await Promise.all(pets.map((p, i) => p.walkTo(spreadX(i))));
      await sleep(260);
    },
    async start() {
      this.stop = false;
      while (!this.stop) await this.cycle();
    },
  };

  return { clipX, clipY: clipTop, clipW, clipH: CLIPH, cast, newFloor };
})();
