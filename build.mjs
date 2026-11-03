// Build: npm run build  →  dist/epm.js + dist/epm.min.js
// Bundles the CSS and every source file into ONE self-contained script for the Webflow embed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { minify } from 'terser';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const VERSION = process.env.EPM_VERSION || pkg.version;
const ORDER = ['core.js', 'charts.js', 'zoom.js', 'model.js', 'cohort.js', 'app.js', 'learner.js', 'main.js'];

const css = readFileSync(join(here, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim();
let src = ORDER.map(f => `/* ---- ${f} ---- */\n` + readFileSync(join(here, 'src', f), 'utf8')).join('\n');
src = src.replace('__CSS__', JSON.stringify(css)).replace("'__VERSION__'", JSON.stringify(VERSION));

const banner = `/*! Adizes · Exec Program Manager v${VERSION} · github.com/Adizes/exec-program-manager */\n`;
const out = banner + `(function(){\n'use strict';\n${src}\n})();\n`;
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/epm.js'), out);
const min = await minify(out, { compress: true, mangle: true, format: { comments: /^!/ } });
writeFileSync(join(here, 'dist/epm.min.js'), min.code);
console.log(`built v${VERSION} · ${(out.length / 1024).toFixed(1)} KB → ${(min.code.length / 1024).toFixed(1)} KB min`);
