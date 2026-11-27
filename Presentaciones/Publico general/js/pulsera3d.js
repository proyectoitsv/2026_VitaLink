/* VitaLink · Pulsera en 3D (carcasa real exportada de Fusion 360 + correa, placa y batería)
   Expone window.Pulsera3D con:
     pose(obj)        → mueve la pulsera (x, y en px del escenario 1920×1080; rx, ry, rz en grados; s escala;
                        ex despiece 0‥1; o opacidad; correa 0‥1; cargador 0‥1; giro velocidad en °/s)
     vibrar()         → sacude la pulsera como cuando avisa
     centroPantalla() → posición en px del centro de la pulsera (para ondas y etiquetas)
     etiquetas()      → posiciones en px de cada pieza para las etiquetas del despiece
     arrastrar(dx,dy) → rotación manual con el mouse */
(function () {
  'use strict';
  var W = 1920, H = 1080;
  var host = document.getElementById('gl');
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setSize(W, H, false);
  renderer.domElement.style.width = W + 'px';
  renderer.domElement.style.height = H + 'px';
  host.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, W / H, 10, 4000);
  camera.position.set(0, 0, 600);
  var PX = 2 * 600 * Math.tan(15 * Math.PI / 180) / H; // unidades de mundo por px del escenario

  // ---- Entorno de estudio para los reflejos metálicos (fondo oscuro + softboxes) ----
  function texturaGradiente(c1, c2) {
    var cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    var x = cv.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    var tx = new THREE.CanvasTexture(cv); tx.encoding = THREE.sRGBEncoding; return tx;
  }
  (function () {
    var env = new THREE.Scene();
    env.background = new THREE.Color(0x050506);
    function panel(w, h, x, y, z, mat) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    }
    // softbox grande detrás de la cámara: da el degradé plateado a las chapas
    panel(150, 120, 0, 10, 90, new THREE.MeshBasicMaterial({ map: texturaGradiente('#ffffff', '#1a1a1e'), side: THREE.DoubleSide }));
    panel(160, 20, 0, 85, 20, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    panel(170, 70, 0, 60, 70, new THREE.MeshBasicMaterial({ map: texturaGradiente('#2a2a30', '#f2f2f2'), side: THREE.DoubleSide }));
    panel(14, 120, -90, 0, 20, new THREE.MeshBasicMaterial({ color: 0xbfc6d0, side: THREE.DoubleSide }));
    panel(14, 120, 90, 0, -10, new THREE.MeshBasicMaterial({ color: 0x8a8f99, side: THREE.DoubleSide }));
    var pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.01).texture;
  })();

  // textura de metal cepillado para las chapas
  var cepillado = (function () {
    var cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    var x = cv.getContext('2d'); x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 2600; i++) {
      var v = 150 + Math.random() * 105 | 0;
      x.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.06 + Math.random() * 0.16) + ')';
      x.lineWidth = Math.random() * 1.6 + 0.3;
      var y = Math.random() * 512; x.beginPath(); x.moveTo(0, y); x.lineTo(512, y + (Math.random() - 0.5) * 3); x.stroke();
    }
    var tx = new THREE.CanvasTexture(cv); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx;
  })();

  // ---- Luces: clave blanca, contraluz con el color del tema ----
  scene.add(new THREE.HemisphereLight(0xffffff, 0x101018, 0.18));
  var key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(-200, 300, 400); scene.add(key);
  var rim = new THREE.DirectionalLight(0xe5484d, 1.7); rim.position.set(250, -100, -300); scene.add(rim);
  var rim2 = new THREE.DirectionalLight(0xe5484d, 0.8); rim2.position.set(-300, 120, -200); scene.add(rim2);

  // ---- Materiales ----
  var mCase = new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.62, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.7, envMapIntensity: 0.18, transparent: true });
  var mPad = new THREE.MeshStandardMaterial({ color: 0xd6d9de, map: cepillado, roughnessMap: cepillado, roughness: 0.32, metalness: 1, envMapIntensity: 1.25, transparent: true });
  var mStrap = new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.75, metalness: 0, envMapIntensity: 0.2, transparent: true });
  var mBoard = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.45, metalness: 0.2, transparent: true });
  var mShield = new THREE.MeshStandardMaterial({ color: 0xd4d7dc, roughness: 0.25, metalness: 1, transparent: true });
  var mBlue = new THREE.MeshStandardMaterial({ color: 0x2457c9, roughness: 0.45, metalness: 0.1, transparent: true });
  var mGreen = new THREE.MeshStandardMaterial({ color: 0x2c6b45, roughness: 0.45, metalness: 0.1, transparent: true });
  var mChip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.3, transparent: true });
  var mGold = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.25, metalness: 1, transparent: true });
  var mLipo = new THREE.MeshStandardMaterial({ color: 0xaab2bd, roughness: 0.32, metalness: 0.75, transparent: true });
  var mDock = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0f, roughness: 0.45, metalness: 0.1, clearcoat: 0.4, envMapIntensity: 0.4, transparent: true });
  var mGlow = new THREE.MeshBasicMaterial({ color: 0x3ecf5c, transparent: true });
  var todos = [mCase, mPad, mStrap, mBoard, mShield, mBlue, mGreen, mChip, mGold, mLipo, mDock, mGlow];

  var raiz = new THREE.Group();   // pose general
  var modelo = new THREE.Group(); // pieza completa
  raiz.add(modelo); scene.add(raiz);

  // ---- Carcasa: 4 piezas STL reales ----
  function stl(b64) {
    var s = atob(b64), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(u.buffer), 3));
    g.computeVertexNormals();
    return g;
  }
  // Pulsera = pieza 0 (base con ventana óptica y anclajes de la correa) + pieza 1 (tapa con las chapas).
  // Cargador magnético = pieza 2 (parte inferior, abraza la tapa) + pieza 3 (cara externa que replica S.O.S. y Cancelar).
  var mCargador = mCase.clone();
  todos.push(mCargador);
  modelo.position.z = 6; // centra visualmente la pulsera armada
  var zArmado = [-11, -4];
  var zDespiece = [-52, 26];
  var piezas = (window.VITA_STL || []).map(function (b, i) {
    var m = new THREE.Mesh(stl(b), i >= 2 ? mCargador : mCase);
    if (i < 2) { m.position.z = zArmado[i]; modelo.add(m); }
    return m;
  });

  // Chapas metálicas en los huecos de la tapa (zonas táctiles S.O.S. / Cancelar y pads de carga GND / 5 V)
  var pads = new THREE.Mesh(new THREE.BoxGeometry(36, 28, 0.6), mPad);
  pads.position.z = 5.8;
  if (piezas[1]) piezas[1].add(pads); // viaja siempre con la tapa

  // Brillo de las zonas táctiles (se encienden cuando se habla de ellas)
  var texHalo = (function () {
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var x = cv.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  })();
  function brilloZona(w, h, x, y, color) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    m.position.set(x, y, 6.7);
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo, color: color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(w * 3.2, h * 2.6, 1); halo.position.z = 2;
    m.add(halo); m.userData.halo = halo;
    if (piezas[1]) piezas[1].add(m);
    return m;
  }
  var zonas = { sos: brilloZona(15.5, 25.5, 8.5, 0, 0xff3b41), cancelar: brilloZona(15.5, 15.5, -9, -4.3, 0x3ecf5c) };
  var zonaObj = { sos: 0, cancelar: 0 }, zonaCur = { sos: 0, cancelar: 0 };
  function brillo(nombre, on) { if (zonas[nombre]) zonaObj[nombre] = on ? 1 : 0; }

  // ---- Correa: lazo cerrado que pasa por debajo de la carcasa ----
  var correa = (function () {
    var pts = [[25, -8], [36, -14], [42, -32], [37, -52], [20, -64], [0, -67], [-20, -64], [-37, -52], [-42, -32], [-36, -14], [-25, -8], [0, -11]]
      .map(function (p) { return new THREE.Vector3(p[0], 0, p[1]); });
    var curva = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    var N = 220, ancho = 22, esp = 2.6, v = [], idx = [];
    var Y = new THREE.Vector3(0, 1, 0);
    for (var i = 0; i < N; i++) {
      var t = i / N, p = curva.getPointAt(t), T = curva.getTangentAt(t), n = new THREE.Vector3().crossVectors(T, Y).normalize();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) {
        v.push(p.x + n.x * esp / 2 * k[1], ancho / 2 * k[0], p.z + n.z * esp / 2 * k[1]);
      });
    }
    for (i = 0; i < N; i++) {
      var a = i * 4, b = ((i + 1) % N) * 4;
      for (var f = 0; f < 4; f++) {
        var f2 = (f + 1) % 4;
        idx.push(a + f, b + f, b + f2, a + f, b + f2, a + f2);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var m = new THREE.Mesh(g, mStrap);
    // hebilla
    var heb = new THREE.Mesh(new THREE.TorusGeometry(4, 1, 8, 24), mStrap);
    heb.scale.set(1, 3.4, 1); heb.rotation.y = Math.PI / 2;
    heb.position.set(38, 0, -46);
    var grupo = new THREE.Group(); grupo.add(m); grupo.add(heb);
    grupo.userData.banda = m; grupo.userData.hebilla = heb;
    modelo.add(grupo);
    return grupo;
  })();

  // ---- Placa electrónica (simplificada) ----
  var placa = new THREE.Group();
  (function () {
    function caja(w, h, d, mat, x, y, z) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); placa.add(m); return m; }
    caja(41, 31, 1.6, mBoard, 0, 0, 0);
    // XIAO ESP32-S3 con blindaje metálico y USB-C
    caja(17.5, 21, 1.2, mBoard, 8, 1, 1.4);
    caja(12, 13, 2.2, mShield, 8, 3.5, 2.8);
    caja(9, 7, 3.2, mShield, 8, -7.5, 2.6);
    // MPU-6050 (placa azul)
    caja(13, 20, 1.4, mBlue, -10.5, 1, 1.5);
    caja(4.2, 4.2, 1, mChip, -10.5, 1, 2.7);
    // Componentes SMD
    [[-14, -12], [-9, -12], [-3, -12], [2, -12], [16, -12], [-2, 10]].forEach(function (p) { caja(2.4, 1.4, 0.9, mChip, p[0], p[1], 1.2); });
    // MAX30102 (cara inferior, placa verde)
    caja(15, 18, 1.4, mGreen, 6, 0, -1.6);
    caja(5.6, 3.3, 1.2, mChip, 6, 0, -2.9);
    for (var i = 0; i < 8; i++) caja(1.1, 1.1, 1.3, mGold, 18.6, -11 + i * 3.1, -0.2);
  })();
  placa.position.z = 0.5;
  modelo.add(placa);

  // ---- Batería LiPo y motor de vibración ----
  var lipo = new THREE.Mesh(new THREE.BoxGeometry(34, 25, 4.2), mLipo);
  lipo.position.z = -5;
  modelo.add(lipo);
  var motor = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2.7, 32), mShield);
  motor.rotation.x = Math.PI / 2;
  motor.position.set(-15, 9, -5);
  modelo.add(motor);

  // ---- Cargador magnético con pogo pins: se apoya sobre la tapa y replica las zonas táctiles ----
  var cargador = new THREE.Group();
  (function () {
    piezas[2].position.z = 0; cargador.add(piezas[2]);
    piezas[3].position.z = 11.4; cargador.add(piezas[3]);
    var pc = new THREE.Mesh(new THREE.BoxGeometry(38, 30, 0.6), mPad);
    pc.position.z = 11.4 + 6.3; cargador.add(pc);
    var anillo = new THREE.Mesh(new THREE.TorusGeometry(26, 0.5, 8, 80), mGlow);
    anillo.scale.set(1.2, 0.98, 1); anillo.position.z = -5.5; cargador.add(anillo);
  })();
  modelo.add(cargador);

  // ---- Estado y animación ----
  var DEF = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, s: 1, ex: 0, o: 1, correa: 1, cargador: 0, giro: 0 };
  var obj = Object.assign({}, DEF, { o: 0 }), cur = Object.assign({}, obj);
  var giroAcum = 0, usuario = { x: 0, y: 0 }, mouse = { x: 0, y: 0 }, vib = 0;

  function pose(p) { obj = Object.assign({}, DEF, p); }

  // ---- Entrada cinematográfica ----
  // 0,0 s  la pulsera aparece desarmada en la oscuridad (placa y batería a la vista)
  // 0–3,4 s la cámara la rodea mientras se enciende la luz
  // 1,5–3,0 s las piezas se cierran de golpe (clic en 3,0 s)
  // 2,85–3,9 s la correa se envuelve · 3,05–4,5 s un reflejo barre la superficie
  var intro = -1, INTRO_DUR = 3.6, golpe = 0, expoObj = 1;
  var luzBarrido = new THREE.DirectionalLight(0xffffff, 0);
  luzBarrido.target = raiz;
  scene.add(luzBarrido);
  function armar() { intro = tiempo; }
  // Corta el armado si se pasa de diapositiva antes de que termine
  function cancelarArmado() {
    if (intro < 0) return;
    intro = -1; golpe = 0; expoObj = 1;
    luzBarrido.intensity = 0;
    correa.userData.banda.geometry.setDrawRange(0, Infinity);
    correa.userData.hebilla.visible = true;
  }
  function suave(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function tramo(x, a, b) { return Math.min(1, Math.max(0, (x - a) / (b - a))); }
  function aplicarIntro() {
    golpe = 0;
    if (intro < 0) { renderer.toneMappingExposure += (expoObj - renderer.toneMappingExposure) * 0.03; return; }
    var t = tiempo - intro;
    if (t < INTRO_DUR) {
      var c = suave(tramo(t, 0, 3.4));
      cur.o = tramo(t, 0, 0.9); cur.x = 0; cur.y = 30;
      cur.s = 1.1 + 0.2 * suave(tramo(t, 0, 3.6));
      cur.ry = -150 + 138 * c; cur.rx = -62 + 44 * c; cur.rz = 18 - 14 * c;
      cur.ex = 1 - Math.pow(tramo(t, 1.5, 3.0), 4);
      cur.correa = 1; cur.cargador = 0;
      giroAcum = 0;
      renderer.toneMappingExposure = 0.12 + 0.88 * suave(tramo(t, 0.1, 2.0));
      expoObj = 1;
    } else renderer.toneMappingExposure += (expoObj - renderer.toneMappingExposure) * 0.03;
    var g = tramo(t, 3.0, 3.35);
    if (g > 0 && g < 1) golpe = Math.sin(Math.PI * g) * 0.05;
    var f = suave(tramo(t, 2.85, 3.9)), banda = correa.userData.banda, total = banda.geometry.index.count;
    banda.geometry.setDrawRange(0, Math.floor(total * f / 3) * 3);
    correa.userData.hebilla.visible = f > 0.85;
    var bl = tramo(t, 3.05, 4.5);
    luzBarrido.intensity = bl > 0 && bl < 1 ? Math.sin(Math.PI * bl) * 3.2 : 0;
    luzBarrido.position.set(raiz.position.x - 320 + 640 * bl, raiz.position.y + 160, 300);
    if (t > 4.6) {
      intro = -1; luzBarrido.intensity = 0;
      banda.geometry.setDrawRange(0, Infinity); correa.userData.hebilla.visible = true;
    }
  }
  function vibrar() { vib = 1; }
  function fijar(p) { for (var k in p) { cur[k] = p[k]; obj[k] = p[k]; } }
  function exposicion(v) { expoObj = v; }
  function arrastrar(dx, dy) { usuario.y += dx * 0.01; usuario.x += dy * 0.01; }
  function resetUsuario() { usuario.x = 0; usuario.y = 0; }
  // en esta presentación la pulsera no sigue al mouse

  var reloj = new THREE.Clock(), tiempo = 0;
  function setColorTema(hex) { var c = new THREE.Color(hex); rim.color.copy(c); rim2.color.copy(c); }

  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, reloj.getDelta()); tiempo += dt;
    var k = 1 - Math.exp(-dt * 2.6), kr = 1 - Math.exp(-dt * 2.2);
    ['x', 'y', 's', 'o', 'correa', 'cargador'].forEach(function (c) { cur[c] += (obj[c] - cur[c]) * k; });
    ['rx', 'ry', 'rz'].forEach(function (c) { cur[c] += (obj[c] - cur[c]) * kr; });
    cur.ex += (obj.ex - cur.ex) * (1 - Math.exp(-dt * 1.9));
    giroAcum += obj.giro * dt;
    if (!obj.giro) giroAcum += (Math.round(giroAcum / 360) * 360 - giroAcum) * k;
    usuario.x *= 0.995; usuario.y *= 0.995;
    vib = Math.max(0, vib - dt * 0.55);
    var sac = vib > 0 ? Math.sin(tiempo * 90) * 1.6 * Math.min(1, vib * 3) : 0;
    aplicarIntro();

    var D = Math.PI / 180;
    raiz.position.set(cur.x * PX + sac * 0.6, -cur.y * PX + Math.sin(tiempo * 1.3) * 2.2, 0);
    raiz.rotation.set((cur.rx - mouse.y * 10) * D + usuario.x, (cur.ry + giroAcum + mouse.x * 14) * D + usuario.y + Math.sin(tiempo * 0.5) * 0.05, cur.rz * D + sac * 0.01);
    raiz.scale.setScalar(Math.max(0.001, cur.s) * 1.7 * (1 + golpe));
    todos.forEach(function (m) { m.transparent = m.opacity < 0.995; });

    var e = cur.ex;
    piezas.forEach(function (m, i) { if (i < 2) m.position.z = zArmado[i] + (zDespiece[i] - zArmado[i]) * e; });
    placa.position.z = -2 + 2 * e;
    lipo.position.z = -5.5 - 22 * e;
    motor.position.z = -5.5 - 22 * e; motor.position.x = -15 - 20 * e;
    var vis = cur.o > 0.02;
    raiz.visible = vis;
    var correaF = 1;
    ['sos', 'cancelar'].forEach(function (z) {
      zonaCur[z] += (zonaObj[z] - zonaCur[z]) * Math.min(1, dt * 6);
      var pulso = 0.75 + 0.25 * Math.sin(tiempo * 7);
      zonas[z].material.opacity = zonaCur[z] * cur.o * 0.9 * pulso;
      zonas[z].userData.halo.material.opacity = zonaCur[z] * cur.o * 0.55 * pulso;
      zonas[z].visible = zonaCur[z] > 0.01;
    });
    mStrap.opacity = cur.o * cur.correa * (1 - e) * correaF;
    correa.visible = mStrap.opacity > 0.02;
    var interior = Math.min(1, e * 1.5);
    placa.visible = lipo.visible = motor.visible = interior > 0.02;
    [mBoard, mShield, mBlue, mGreen, mChip, mGold, mLipo].forEach(function (m) { m.opacity = cur.o * Math.max(interior, 0); });
    mCase.opacity = mPad.opacity = cur.o;
    // cargador: baja desde arriba y se acopla sobre la tapa
    cargador.visible = cur.cargador > 0.02 && e < 0.5;
    cargador.position.z = (zArmado[1] + 8.1) + 70 * (1 - cur.cargador);
    mCargador.opacity = cur.o * Math.min(1, cur.cargador * 1.4);
    mGlow.opacity = cur.o * cur.cargador * (0.55 + 0.45 * Math.sin(tiempo * 3));
    renderer.render(scene, camera);
  }

  var v3 = new THREE.Vector3();
  function aPantalla(o3, local) {
    v3.copy(local || new THREE.Vector3());
    if (o3) o3.localToWorld(v3); else raiz.localToWorld(v3);
    v3.project(camera);
    return { x: (v3.x + 1) / 2 * W, y: (1 - v3.y) / 2 * H };
  }
  function etiquetas() {
    return {
      chapas: aPantalla(piezas[1], new THREE.Vector3(8.5, 0, 6.5)),
      carga: aPantalla(piezas[1], new THREE.Vector3(-9.1, 8.6, 6.5)),
      carcasa: aPantalla(piezas[1], new THREE.Vector3(-8, -18, -2)),
      correa: aPantalla(modelo, new THREE.Vector3(41, 0, -36)),
      sensor: aPantalla(piezas[0], new THREE.Vector3(0, 0, -3.5)),
      tapa: aPantalla(piezas[1], new THREE.Vector3(22, 0, 0)),
      placa: aPantalla(placa, new THREE.Vector3(20, 0, 0)),
      bateria: aPantalla(lipo, new THREE.Vector3(17, 0, 0)),
      motor: aPantalla(motor, new THREE.Vector3(0, 0, 0)),
      base: aPantalla(piezas[0], new THREE.Vector3(25, 0, 0)),
      cara: aPantalla(piezas[1], new THREE.Vector3(-4, 15.5, 6.2)),
      sos: aPantalla(piezas[1], new THREE.Vector3(8.5, 2, 6.7)),
      ladoIzq: aPantalla(piezas[1], new THREE.Vector3(-22, 0, 0))
    };
  }
  function resolucion(escala) {
    renderer.setPixelRatio(Math.min(2, Math.max(0.5, escala * (window.devicePixelRatio || 1))));
    renderer.setSize(W, H, false);
    renderer.domElement.style.width = W + 'px';
    renderer.domElement.style.height = H + 'px';
  }

  window.Pulsera3D = {
    pose: pose, armar: armar, cancelarArmado: cancelarArmado, fijar: fijar, brillo: brillo, exposicion: exposicion, vibrar: vibrar, arrastrar: arrastrar, resetUsuario: resetUsuario, etiquetas: etiquetas,
    centroPantalla: function () { return aPantalla(null); }, setColorTema: setColorTema, resolucion: resolucion,
    get despiece() { return cur.ex; }
  };
  frame();
})();
