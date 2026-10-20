import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const RAL_2008 = "#F3752C";

const markSvg = readFileSync("public/brand/siderio-mark.svg", "utf8");
const vb = markSvg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
if (!vb) throw new Error("siderio-mark.svg is missing a viewBox");
const markW = Number(vb[1]);
const markH = Number(vb[2]);
const markPath = markSvg.match(/<path[^>]*d="([^"]+)"/)?.[1];
if (!markPath) throw new Error("siderio-mark.svg is missing a path");

function iconSvg(size, { rounded = false, maskable = false } = {}) {
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const heightRatio = maskable ? 0.52 : 0.64;
  const markHeight = size * heightRatio;
  const scale = markHeight / markH;
  const markWidth = markW * scale;
  const x = (size - markWidth) / 2;
  const y = (size - markHeight) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${RAL_2008}"/>
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(6)})">
    <path fill="#FFFFFF" d="${markPath}"/>
  </g>
</svg>`;
}

mkdirSync("public/icons", { recursive: true });
mkdirSync("public/brand", { recursive: true });

writeFileSync("public/brand/siderio-icon.svg", iconSvg(512, { rounded: true }));

// Le icone dell'app (manifest, iPhone, favicon) non nascono più da qui: dal
// 20 ottobre 2026 le disegna strumenti/icone.mjs, con le due lettere Sv come
// le altre app Siderio. Qui resta solo il marchio usato dentro l'interfaccia.
const jobs = [];

for (const [file, svg] of jobs) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  console.log("wrote", file);
}
