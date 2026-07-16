// ====================================================================
// Echter 3D-Würfel (WebGL) für die Startspieler-Auslosung.
//
// Rendert ein geschlossenes, kantengerundetes Würfel-Mesh (keine
// zusammengesetzten CSS-Flächen) mit Licht + Glanzpunkt. Ein einziger
// versteckter WebGL-Canvas rendert alle Würfel; jedes sichtbare
// <canvas class="die-canvas"> bekommt sein Bild per drawImage.
//
//   Die3D.ok()                       → WebGL verfügbar & initialisiert?
//   Die3D.attach(canvas)             → Handle, zeichnet Ruhelage
//   Die3D.roll(handles, targets, dS) → animiert zu Zielrotationen (Grad)
// ====================================================================
(function () {
  const SIZE = 256;            // Render-Auflösung (wird herunterskaliert)
  const RADIUS = 0.30;         // Kantenrundung (Halbkante = 1)
  const SEG = 10;              // Unterteilungen pro Fläche
  const DIST = 6.0, FOV = 35;  // Kamera (FOV mit Reserve, damit Ecken beim Drehen nie anschneiden)
  const FACES_TXT = ["9", "10", "B", "D", "K", "A"];

  let gl = null, glCanvas = null, prog = null, ready = false;
  let indexCount = 0, uni = {};
  const handles = [];          // zuletzt angebundene Würfel (für Redraws)

  // ---------- Mini-Mathe ----------
  const D2R = Math.PI / 180;
  function matPerspective(fovDeg, near, far) {
    const f = 1 / Math.tan(fovDeg * D2R / 2), nf = 1 / (near - far);
    return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  // Modellmatrix: Verschieben * RotX * RotY (entspricht CSS rotateX() rotateY())
  function matModel(rx, ry, z) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    // Rx*Ry, Spaltenvektor-Konvention, column-major abgelegt
    return [
      cy, sx * sy, -cx * sy, 0,
      0, cx, sx, 0,
      sy, -sx * cy, cx * cy, 0,
      0, 0, z, 1,
    ];
  }

  // ---------- Geometrie: kantengerundeter Würfel ----------
  // 6 Gitter-Flächen; jeder Punkt wird auf die "runde Box" projiziert:
  // q = clamp(p, -inner, inner); Rest-Vektor normiert * RADIUS dazu.
  const FACE_DEF = [
    { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0] },   // f1 vorne
    { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0] },   // f2 rechts
    { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1] },   // f3 unten
    { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1] },  // f4 oben
    { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0] },   // f5 links
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },   // f6 hinten
  ];

  function buildGeometry() {
    const pos = [], nrm = [], uv = [], idx = [];
    const inner = 1 - RADIUS;
    FACE_DEF.forEach((f, fi) => {
      const base = pos.length / 3;
      const col = fi % 3, row = Math.floor(fi / 3);
      for (let j = 0; j <= SEG; j++) {
        for (let i = 0; i <= SEG; i++) {
          const a = i / SEG * 2 - 1, b = j / SEG * 2 - 1;
          const p = [
            f.u[0] * a + f.v[0] * b + f.n[0],
            f.u[1] * a + f.v[1] * b + f.n[1],
            f.u[2] * a + f.v[2] * b + f.n[2],
          ];
          const q = p.map(c => Math.max(-inner, Math.min(inner, c)));
          const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
          const len = Math.hypot(d[0], d[1], d[2]) || 1;
          pos.push(q[0] + d[0] / len * RADIUS, q[1] + d[1] / len * RADIUS, q[2] + d[2] / len * RADIUS);
          nrm.push(d[0] / len, d[1] / len, d[2] / len);
          // Atlas-Zelle der Fläche (3×2); b=+1 ist oben → kleinere Canvas-y
          uv.push((col + (a * 0.5 + 0.5)) / 3, (row + (0.5 - b * 0.5)) / 2);
        }
      }
      for (let j = 0; j < SEG; j++) {
        for (let i = 0; i < SEG; i++) {
          const r0 = base + j * (SEG + 1) + i, r1 = r0 + SEG + 1;
          idx.push(r0, r0 + 1, r1 + 1, r0, r1 + 1, r1);
        }
      }
    });
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
  }

  // ---------- Textur: Elfenbein-Flächen mit Buchstaben ----------
  function buildTexture() {
    const cell = 128;
    const c = document.createElement("canvas");
    c.width = cell * 3; c.height = cell * 2;
    const g = c.getContext("2d");
    FACES_TXT.forEach((txt, i) => {
      const x = (i % 3) * cell, y = Math.floor(i / 3) * cell;
      const gr = g.createRadialGradient(x + cell * 0.32, y + cell * 0.28, cell * 0.08, x + cell / 2, y + cell / 2, cell * 0.75);
      gr.addColorStop(0, "#fffdf4");
      gr.addColorStop(0.55, "#f6f1e0");
      gr.addColorStop(1, "#ded5ba");
      g.fillStyle = gr;
      g.fillRect(x, y, cell, cell);
      g.fillStyle = i >= 4 ? "#b3372c" : "#23301f";  // K & A traditionell rot
      g.font = `800 ${txt.length > 1 ? 56 : 68}px Fraunces, Georgia, serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(txt, x + cell / 2, y + cell / 2 + 4);
    });
    return c;
  }

  function uploadTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildTexture());
    // WICHTIG: keine Mipmaps — der Atlas (384×256) ist keine Zweierpotenz;
    // mit Mipmap-Filter wäre die Textur in WebGL1 "unvollständig" und
    // sampelt komplett schwarz. LINEAR reicht (wird eh herunterskaliert).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---------- Init ----------
  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    uniform mat4 uMV, uP;
    varying vec3 vN, vV; varying vec2 vUV;
    void main() {
      vec4 mp = uMV * vec4(aPos, 1.0);
      gl_Position = uP * mp;
      vN = mat3(uMV[0].xyz, uMV[1].xyz, uMV[2].xyz) * aNrm;
      vV = -mp.xyz;
      vUV = aUV;
    }`;
  const FS = `
    precision mediump float;
    varying vec3 vN, vV; varying vec2 vUV;
    uniform sampler2D uTex;
    void main() {
      vec3 N = normalize(vN), V = normalize(vV);
      vec3 L = normalize(vec3(0.45, 0.75, 0.55));
      float diff = max(dot(N, L), 0.0);
      float fill = max(dot(N, normalize(vec3(-0.5, -0.3, 0.4))), 0.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 36.0);
      vec3 tex = texture2D(uTex, vUV).rgb;
      vec3 col = tex * (0.38 + 0.62 * diff + 0.14 * fill) + vec3(1.0, 0.97, 0.88) * spec * 0.4;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function init() {
    glCanvas = document.createElement("canvas");
    glCanvas.width = SIZE; glCanvas.height = SIZE;
    gl = glCanvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return false;

    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    const geo = buildGeometry();
    indexCount = geo.idx.length;
    const buf = (target, data) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    const attr = (name, buffer, size) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr("aPos", buf(gl.ARRAY_BUFFER, geo.pos), 3);
    attr("aNrm", buf(gl.ARRAY_BUFFER, geo.nrm), 3);
    attr("aUV", buf(gl.ARRAY_BUFFER, geo.uv), 2);
    buf(gl.ELEMENT_ARRAY_BUFFER, geo.idx);

    uni.mv = gl.getUniformLocation(prog, "uMV");
    uni.p = gl.getUniformLocation(prog, "uP");
    gl.uniformMatrix4fv(uni.p, false, matPerspective(FOV, 0.5, 30));
    uploadTexture();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.viewport(0, 0, SIZE, SIZE);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  function render(rxDeg, ryDeg) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(uni.mv, false, matModel(rxDeg * D2R, ryDeg * D2R, -DIST));
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
  }

  function drawHandle(h) {
    render(h.rx, h.ry);
    h.ctx.clearRect(0, 0, h.canvas.width, h.canvas.height);
    h.ctx.drawImage(glCanvas, 0, 0, h.canvas.width, h.canvas.height);
  }

  // Weiche Landung wie die bisherige CSS-Kurve
  const ease = t => 1 - Math.pow(1 - t, 4);

  window.Die3D = {
    ok() {
      if (ready) return true;
      try { ready = init(); } catch { ready = false; }
      this.ok = () => ready;   // nur einmal initialisieren
      return ready;
    },

    attach(canvas) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = canvas.clientWidth || 62;
      canvas.width = Math.round(px * dpr);
      canvas.height = Math.round(px * dpr);
      const h = { canvas, ctx: canvas.getContext("2d"), rx: -22, ry: 28 };
      drawHandle(h);
      handles.push(h);
      if (handles.length > 24) handles.splice(0, handles.length - 24);
      return h;
    },

    // targets: [{x, y}] in Grad (inkl. Extra-Umdrehungen), delayStep in ms
    roll(list, targets, delayStep = 90, dur = 1500) {
      const t0 = performance.now();
      const from = list.map(h => ({ rx: h.rx, ry: h.ry }));
      const step = now => {
        let busy = false;
        list.forEach((h, i) => {
          const t = (now - t0 - i * delayStep) / dur;
          if (t < 1) busy = true;
          const e = ease(Math.max(0, Math.min(1, t)));
          h.rx = from[i].rx + (targets[i].x - from[i].rx) * e;
          h.ry = from[i].ry + (targets[i].y - from[i].ry) * e;
          drawHandle(h);
        });
        if (busy) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
  };

  // Sobald die Display-Schrift geladen ist, Textur + Ruhebilder auffrischen
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!ready) return;
      uploadTexture();
      handles.forEach(h => { if (h.canvas.isConnected) drawHandle(h); });
    });
  }
})();
