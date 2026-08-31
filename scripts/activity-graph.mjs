#!/usr/bin/env node
// Renders assets/activity-graph.svg from the last 31 days of GitHub contributions.
// No dependencies: uses the GraphQL API and writes a hand-built SVG that matches
// the palette of assets/header.svg.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.GRAPH_USER || 'momenbasel';
const TOKEN = process.env.GITHUB_TOKEN || process.env.TOKEN;
const DAYS = 31;

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'activity-graph.svg');

const C = {
  bg: '#0d1117',
  bar: '#161b22',
  border: '#30363d',
  grid: '#21262d',
  accent: '#39d353',
  text: '#e6edf3',
  muted: '#8b949e',
  dim: '#484f58',
};
const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Courier New', monospace";

if (!TOKEN) {
  console.error('GITHUB_TOKEN (or TOKEN) is required');
  process.exit(1);
}

const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

const to = new Date();
const from = new Date(to.getTime() - (DAYS - 1) * 86400000);

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'activity-graph-generator',
  },
  body: JSON.stringify({
    query,
    variables: { login: USER, from: from.toISOString(), to: to.toISOString() },
  }),
});

if (!res.ok) {
  console.error(`GitHub API returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
if (body.errors) {
  console.error(JSON.stringify(body.errors, null, 2));
  process.exit(1);
}

const days = body.data.user.contributionsCollection.contributionCalendar.weeks
  .flatMap((w) => w.contributionDays)
  .filter((d) => d.date >= from.toISOString().slice(0, 10))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-DAYS);

if (days.length === 0) {
  console.error('no contribution days returned');
  process.exit(1);
}

// Layout — viewBox matches header.svg width so both cards render at the same scale.
const W = 842;
const H = 270;
const PLOT = { x: 56, y: 74, w: W - 56 - 26, h: 138 };
const peak = Math.max(...days.map((d) => d.contributionCount), 1);
const ceiling = niceCeiling(peak);
const total = days.reduce((sum, d) => sum + d.contributionCount, 0);

const px = (i) => PLOT.x + (i * PLOT.w) / (days.length - 1);
const py = (v) => PLOT.y + PLOT.h - (v / ceiling) * PLOT.h;
const pts = days.map((d, i) => [px(i), py(d.contributionCount)]);

const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ');
const area = `${line} L${round(PLOT.x + PLOT.w)} ${PLOT.y + PLOT.h} L${PLOT.x} ${PLOT.y + PLOT.h} Z`;

const yTicks = [0, 0.5, 1].map((f) => Math.round(ceiling * f));
const gridLines = yTicks
  .map((v) => {
    const y = round(py(v));
    return `  <line x1="${PLOT.x}" y1="${y}" x2="${PLOT.x + PLOT.w}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>
  <text x="${PLOT.x - 10}" y="${y + 4}" fill="${C.dim}" font-family="${MONO}" font-size="10" text-anchor="end">${v}</text>`;
  })
  .join('\n');

const xLabels = days
  .map((d, i) => ({ d, i }))
  .filter(({ i }) => i % 6 === 0 || i === days.length - 1)
  .map(({ d, i }) => {
    const anchor = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
    return `  <text x="${round(px(i))}" y="${PLOT.y + PLOT.h + 20}" fill="${C.dim}" font-family="${MONO}" font-size="10" text-anchor="${anchor}">${label(d.date)}</text>`;
  })
  .join('\n');

const dots = pts
  .map(([x, y], i) => {
    const active = days[i].contributionCount > 0;
    return `  <circle cx="${round(x)}" cy="${round(y)}" r="${active ? 2.6 : 1.6}" fill="${active ? C.accent : C.dim}"/>`;
  })
  .join('\n');

const svg = `<svg viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">

  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Terminal window -->
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="11" fill="${C.bg}" stroke="${C.border}" stroke-width="1"/>

  <!-- Title bar -->
  <rect x="1" y="1" width="${W - 2}" height="36" rx="11" fill="${C.bar}"/>
  <rect x="1" y="26" width="${W - 2}" height="11" fill="${C.bar}"/>
  <line x1="1" y1="37" x2="${W - 1}" y2="37" stroke="${C.border}" stroke-width="0.5"/>

  <!-- Traffic lights -->
  <circle cx="24" cy="19" r="6" fill="#ff5f56"/>
  <circle cx="44" cy="19" r="6" fill="#ffbd2e"/>
  <circle cx="64" cy="19" r="6" fill="#27c93f"/>

  <!-- Title bar text -->
  <text x="${W / 2}" y="23" fill="${C.muted}" font-family="${MONO}" font-size="12" text-anchor="middle">moamen@github: ~/contributions</text>

  <!-- Command line -->
  <text x="22" y="60" font-family="${MONO}" font-size="13" xml:space="preserve">
    <tspan fill="${C.accent}" font-weight="bold">$</tspan><tspan fill="${C.text}"> git log --since=${DAYS}.days --oneline | wc -l</tspan>
  </text>

  <!-- Grid -->
${gridLines}

  <!-- Series -->
  <path d="${area}" fill="url(#fade)"/>
  <path d="${line}" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
${dots}

  <!-- Axis labels -->
${xLabels}

  <!-- Footer -->
  <text x="22" y="${H - 16}" font-family="${MONO}" font-size="12" xml:space="preserve">
    <tspan fill="${C.text}" font-weight="bold">${total}</tspan><tspan fill="${C.dim}"> contributions</tspan><tspan fill="${C.dim}">  //  peak ${peak}/day</tspan>
  </text>
  <text x="${W - 22}" y="${H - 16}" fill="${C.dim}" font-family="${MONO}" font-size="11" text-anchor="end">updated ${to.toISOString().slice(0, 10)}</text>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${days.length} days, ${total} contributions, peak ${peak})`);

function niceCeiling(n) {
  if (n <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / mag) * mag;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function label(iso) {
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}
