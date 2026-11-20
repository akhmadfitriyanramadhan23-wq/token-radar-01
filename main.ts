// Token Radar, radar-2 (Node 22, standard library only).
//
// What this program does, end to end: it reads the sealed snapshot from
// /input/snapshot.json (or --input <file|dir>), scores every rankable pre-token
// protocol with the model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/
// to /output. Last it writes /output/dossier.json — the summary the judge
// reads — with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// /output/data.js this program writes from the same board. The board covers
// the whole watchlist, adds every rankable pre-token protocol below the floor,
// states its model, and gives every protocol a seven-step farm plan. Change
// the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback when it is absent. */
function readFlag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** The snapshot file out of the --input argument: a file itself, or the snapshot.json inside a directory. */
function snapshotPath(): string {
  const given = readFlag('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** Parse the snapshot, or leave with the same complaint the grader would read. */
function loadSnapshot(path: string) {
  if (!existsSync(path)) {
    process.stderr.write(`token radar: no snapshot at ${path}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return parseSnapshot(readFileSync(path, 'utf8'));
}

/** The board and its dashboard dataset, as the two files the output carries. */
function emitBoard(out: string, board: ReturnType<typeof buildRadar>['board'], radar: ReturnType<typeof buildRadar>['radar']): void {
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot; the copied names, in order. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile()) continue;
    copyFileSync(join(from, entry.name), join(to, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

/** Complain and leave unless every name in `needed` is among `copied`. */
function requireFiles(copied: string[], needed: string[], what: string): void {
  for (const name of needed) {
    if (!copied.includes(name)) {
      process.stderr.write(`token radar: ${what} is missing ${name}: the gate needs the page, its stylesheet and its script\n`);
      process.exit(1);
    }
  }
}

/** The dossier, written last: the scorer rebuilds it from this /output and compares bytes. */
function emitDossier(out: string): void {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
}

const inputFile = snapshotPath();
const snapshot = loadSnapshot(inputFile);
const out = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
emitBoard(out, board, radar);

const dashboardFiles = copyTree(join(rootDir, 'dashboard'), join(out, 'dashboard'));
requireFiles(dashboardFiles, ['index.html', 'app.css', 'app.js'], 'dashboard/');
const shots = copyTree(join(rootDir, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

emitDossier(out);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
