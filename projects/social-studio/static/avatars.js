// Avatars: cartoon presenters (muh awaaz ke saath hilta hai) aur "meri photo" wala gol frame.
// Har avatar ke 8 frames (PNG, 900x900, transparent) bante hain: muh ke 4 level x aankh khuli/band.
const AVATAR_SIZE = 900;
const FRAME_NAMES = [0, 1, 2, 3].flatMap((m) => [0, 1].map((e) => ({ key: `m${m}e${e}`, mouth: m, blink: e === 1 })));

const AVATAR_PRESETS = [
  { id: "aarav", name: "Aarav", gender: "m", skin: "#e2b08a", hair: "short", hairColor: "#24180f", shirt: "#2f6fed", tie: "#17306b" },
  { id: "priya", name: "Priya", gender: "f", skin: "#d9a27a", hair: "long", hairColor: "#1d1410", shirt: "#e0457b", bindi: true },
  { id: "rohan", name: "Rohan", gender: "m", skin: "#c98e65", hair: "side", hairColor: "#2a1b12", shirt: "#1f9d6b", glasses: true },
  { id: "meera", name: "Meera", gender: "f", skin: "#eec3a0", hair: "bun", hairColor: "#3a2417", shirt: "#7b5cf0", glasses: true },
  { id: "kabir", name: "Kabir", gender: "m", skin: "#a8714a", hair: "short", hairColor: "#150e0a", shirt: "#f08a24", beard: true },
  { id: "ananya", name: "Ananya", gender: "f", skin: "#c58a62", hair: "curly", hairColor: "#20140d", shirt: "#12a4b6", bindi: true },
  { id: "vikram", name: "Vikram", gender: "m", skin: "#e8b995", hair: "bald", hairColor: "#2a1b12", shirt: "#3b3f4a", beard: true, glasses: true },
  { id: "sara", name: "Sara", gender: "f", skin: "#f1cdb0", hair: "side", hairColor: "#7a4a24", shirt: "#d6a31c" },
  { id: "dev", name: "Dev", gender: "m", skin: "#b9805a", hair: "curly", hairColor: "#1a110c", shirt: "#c73e3e", tie: "#f4f4f4" },
  { id: "isha", name: "Isha", gender: "f", skin: "#e3ae88", hair: "long", hairColor: "#4a2a17", shirt: "#2c8c5a", glasses: true },
  { id: "arjun", name: "Arjun", gender: "m", skin: "#d49a72", hair: "side", hairColor: "#1c130d", shirt: "#4a8be8" },
  { id: "zoya", name: "Zoya", gender: "f", skin: "#c99870", hair: "bun", hairColor: "#16100c", shirt: "#8e44ad", bindi: true },
];

function adjust(hex, amt) {
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function ell(ctx, x, y, rx, ry, fill, stroke, lw) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 4; ctx.stroke(); }
}
function rrect(ctx, x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }

function drawMouth(ctx, level) {
  const cx = 450, cy = 540, dark = "#5b1f24", lip = "#b24a52";
  if (level === 0) {  // band, halki muskaan
    ctx.beginPath(); ctx.moveTo(408, cy - 10); ctx.quadraticCurveTo(450, cy + 22, 492, cy - 10);
    ctx.strokeStyle = "#7a2e2e"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.stroke(); return;
  }
  const sizes = [null, [26, 11], [32, 21], [36, 33]][level], [rx, ry] = sizes, y = cy + (level === 3 ? 6 : 0);
  ell(ctx, cx, y, rx, ry, dark, lip, 6);
  if (level >= 2) {  // upar ke daant
    ctx.save(); ctx.beginPath(); ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#fff"; ctx.fillRect(cx - rx, y - ry, rx * 2, level === 3 ? 12 : 9);
    ell(ctx, cx, y + ry * 0.75, rx * 0.62, ry * 0.45, "#d9626f"); ctx.restore();
  }
}

function drawEyes(ctx, blink, spec) {
  for (const x of [385, 515]) {
    if (blink) {
      ctx.beginPath(); ctx.moveTo(x - 30, 412); ctx.quadraticCurveTo(x, 428, x + 30, 412);
      ctx.strokeStyle = "#2a1a12"; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.stroke();
    } else {
      ell(ctx, x, 410, 31, 25, "#ffffff", "rgba(0,0,0,0.12)", 3);
      ell(ctx, x + (x < 450 ? 4 : -4), 412, 15, 18, "#2d1b12");
      ell(ctx, x + (x < 450 ? 9 : -1), 405, 5, 5, "#ffffff");
    }
    ctx.beginPath(); ctx.moveTo(x - 36, 362 + (x < 450 ? 4 : 0)); ctx.quadraticCurveTo(x, 346, x + 36, 362 + (x < 450 ? 0 : 4));
    ctx.strokeStyle = spec.hair === "bald" ? "#3a2a20" : spec.hairColor; ctx.lineWidth = 11; ctx.lineCap = "round"; ctx.stroke();
  }
}

function drawHairFront(ctx, spec) {
  const c = spec.hairColor; ctx.fillStyle = c;
  const crown = () => { ctx.moveTo(258, 410); ctx.bezierCurveTo(240, 195, 340, 178, 450, 178); ctx.bezierCurveTo(560, 178, 660, 195, 642, 410); };
  if (spec.hair === "short" || spec.hair === "bun") {
    ctx.beginPath(); crown(); ctx.bezierCurveTo(615, 330, 540, 292, 450, 300); ctx.bezierCurveTo(360, 292, 285, 330, 258, 410); ctx.fill();
  } else if (spec.hair === "side") {
    ctx.beginPath(); crown(); ctx.bezierCurveTo(630, 340, 480, 270, 330, 330); ctx.bezierCurveTo(290, 350, 270, 380, 258, 410); ctx.fill();
  } else if (spec.hair === "long") {
    ctx.beginPath(); crown(); ctx.bezierCurveTo(630, 330, 520, 300, 452, 296); ctx.bezierCurveTo(380, 300, 285, 330, 258, 410); ctx.fill();
    ctx.beginPath(); ctx.moveTo(452, 296); ctx.bezierCurveTo(500, 296, 590, 330, 642, 410); ctx.lineTo(642, 330); ctx.bezierCurveTo(600, 240, 500, 230, 452, 232); ctx.fill();
  } else if (spec.hair === "curly") {
    ctx.beginPath(); crown(); ctx.bezierCurveTo(615, 340, 540, 300, 450, 306); ctx.bezierCurveTo(360, 300, 285, 340, 258, 410); ctx.fill();
    for (let a = 0; a <= 12; a++) {
      const t = Math.PI + (Math.PI * a) / 12; ell(ctx, 450 + Math.cos(t) * 205, 330 + Math.sin(t) * 165, 46, 46, c);
    }
  }
}

function drawAvatarCartoon(canvas, spec, mouth, blink) {
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const skin = spec.skin, skinDark = adjust(skin, -22);
  // peeche ke baal
  if (spec.hair === "long") { ell(ctx, 450, 420, 222, 272, spec.hairColor); rrect(ctx, 228, 400, 444, 330, 120, spec.hairColor); }
  if (spec.hair === "bun") ell(ctx, 450, 150, 74, 74, spec.hairColor);
  // kandhe + kameez
  ctx.beginPath(); ctx.moveTo(90, 900); ctx.quadraticCurveTo(100, 690, 330, 660); ctx.lineTo(570, 660); ctx.quadraticCurveTo(800, 690, 810, 900); ctx.closePath();
  ctx.fillStyle = spec.shirt; ctx.fill();
  ctx.beginPath(); ctx.moveTo(90, 900); ctx.quadraticCurveTo(100, 690, 330, 660); ctx.lineTo(330, 900); ctx.closePath(); ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fill();
  // gardan
  rrect(ctx, 385, 540, 130, 170, 34, skinDark);
  ctx.beginPath(); ctx.moveTo(380, 668); ctx.lineTo(450, 735); ctx.lineTo(520, 668); ctx.closePath(); ctx.fillStyle = skinDark; ctx.fill();
  if (spec.tie) { ctx.beginPath(); ctx.moveTo(430, 700); ctx.lineTo(470, 700); ctx.lineTo(485, 900); ctx.lineTo(415, 900); ctx.closePath(); ctx.fillStyle = spec.tie; ctx.fill(); }
  // kaan, chehra
  ell(ctx, 258, 425, 30, 42, skinDark); ell(ctx, 642, 425, 30, 42, skinDark);
  ell(ctx, 450, 405, 192, 220, skin);
  ell(ctx, 450, 470, 170, 170, "rgba(255,255,255,0)");
  if (spec.hair === "bald") ell(ctx, 450, 250, 120, 40, "rgba(255,255,255,0.12)");
  drawHairFront(ctx, spec);
  if (spec.bindi) ell(ctx, 450, 332, 10, 10, "#c91f37");
  drawEyes(ctx, blink, spec);
  // naak, gaal
  ctx.beginPath(); ctx.moveTo(446, 428); ctx.quadraticCurveTo(428, 478, 452, 482); ctx.strokeStyle = adjust(skin, -45); ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.stroke();
  ell(ctx, 330, 488, 38, 24, "rgba(232,96,110,0.28)"); ell(ctx, 570, 488, 38, 24, "rgba(232,96,110,0.28)");
  if (spec.beard) {  // moochh + daadhi
    ctx.fillStyle = spec.hairColor; ctx.beginPath(); ctx.moveTo(262, 470); ctx.bezierCurveTo(270, 640, 380, 650, 450, 650); ctx.bezierCurveTo(520, 650, 630, 640, 638, 470);
    ctx.bezierCurveTo(610, 560, 560, 580, 450, 582); ctx.bezierCurveTo(340, 580, 290, 560, 262, 470); ctx.fill();
    ctx.beginPath(); ctx.moveTo(385, 508); ctx.quadraticCurveTo(450, 480, 515, 508); ctx.quadraticCurveTo(450, 522, 385, 508); ctx.fill();
  }
  drawMouth(ctx, mouth);
  if (spec.glasses) {
    ctx.strokeStyle = "#1c1f2b"; ctx.lineWidth = 9;
    for (const x of [385, 515]) { ctx.beginPath(); ctx.roundRect(x - 56, 366, 112, 90, 30); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(441, 405); ctx.quadraticCurveTo(450, 395, 459, 405); ctx.stroke();
  }
}

// "Meri photo": gol frame, awaaz ke saath chamakta ring aur halka zoom (asli lip-sync nahi)
function drawAvatarPhoto(canvas, img, mouth, accent) {
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const r = 330, cx = 450, cy = 470, pulse = 1 + mouth * 0.012;
  ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 20 + mouth * 22;
  ctx.beginPath(); ctx.arc(cx, cy, r + 14 + mouth * 5, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const k = Math.max((2 * r) / img.width, (2 * r) / img.height) * pulse;
  ctx.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2 - 10, img.width * k, img.height * k); ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 8; ctx.stroke();
}

// 8 frames banakar {m0e0: dataURL, ...} lautata hai
function renderAvatarFrames(drawOne) {
  const c = document.createElement("canvas"), frames = {};
  for (const f of FRAME_NAMES) { drawOne(c, f.mouth, f.blink); frames[f.key] = c.toDataURL("image/png"); }
  return frames;
}
