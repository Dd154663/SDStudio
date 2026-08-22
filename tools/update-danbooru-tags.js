/* eslint-disable no-console */

/**
 * Danbooru AI 자동완성 CSV를 SDStudio 태그 DB 형식으로 변환한다.
 *
 * 기본 입력은 V5 학습 시점에 맞춘 2026-06-01 스냅샷이다.
 * 원본: DraconicDragon/dbr-e621-lists-archive
 *       tag-list-processor-output-06 / danbooru_2026-06-01_pt20-ia-dd.csv
 *
 * 입력:  tag,category,post_count,"alias1,alias2,..."
 * 출력:  word,category,frequency,redirect
 *
 * 실행:
 *   node tools/update-danbooru-tags.js
 *   node tools/update-danbooru-tags.js <원본 CSV> <기존 DB> <최소 게시물 수>
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_FILE = path.resolve(
  process.argv[2] || path.join(ROOT, 'assets', 'danbooru_20260601_raw.csv'),
);
const LEGACY_DB_FILE = path.resolve(
  process.argv[3] || path.join(ROOT, 'assets', 'db.txt'),
);
const MIN_POST_COUNT = Number(process.argv[4] || 25);
const DEFAULT_INPUT_FILE = path.join(
  ROOT,
  'assets',
  'danbooru_20260601_raw.csv',
);
const DEFAULT_INPUT_SHA256 =
  'DFC13491C865E8AA6A51209F5541AAEC9C4F78CD84F0A9EB93F70649E0B36EFA';
const OUTPUT_FILES = [
  path.join(ROOT, 'assets', 'db_v5.txt'),
  path.join(ROOT, 'src', 'native', 'db_v5.csv'),
  path.join(ROOT, 'release', 'app', 'data', 'db_v5.csv'),
];

const LOCAL_ALIAS_RE = /[\u3040-\u30ff\u3131-\u3163\uac00-\ud7af]/;
const VALID_CATEGORIES = new Set([0, 1, 3, 4, 5]);

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  if (quoted) throw new Error(`닫히지 않은 따옴표가 있는 CSV 행: ${line}`);
  return fields;
}

function displayName(name) {
  return name.replace(/_/g, ' ');
}

function assertRuntimeSafeField(value, label) {
  if (value.includes(',') || value.includes('\n') || value.includes('\r')) {
    throw new Error(
      `${label}에 런타임 CSV가 처리할 수 없는 문자가 있습니다: ${value}`,
    );
  }
}

function readSourceTags(content) {
  const tags = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (fields.length !== 4) {
      throw new Error(`${i + 1}행의 열 수가 4가 아닙니다: ${fields.length}`);
    }
    const [name, categoryRaw, countRaw, aliasRaw] = fields;
    const category = Number(categoryRaw);
    const count = Number(countRaw);
    if (!name || !Number.isInteger(category) || !Number.isInteger(count)) {
      throw new Error(`${i + 1}행의 필수 값이 올바르지 않습니다.`);
    }
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`${i + 1}행의 알 수 없는 카테고리: ${category}`);
    }
    if (count < MIN_POST_COUNT) continue;
    tags.push({
      name,
      category,
      count,
      aliases: aliasRaw ? aliasRaw.split(',').filter(Boolean) : [],
    });
  }
  return tags;
}

function readLocalAliases(content) {
  const aliasesByTarget = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split(',');
    if (fields.length !== 4) continue;
    const [word, , , redirect] = fields;
    if (redirect === 'null' || !LOCAL_ALIAS_RE.test(word)) continue;
    const target = redirect.replace(/ /g, '_');
    const aliases = aliasesByTarget.get(target) || [];
    aliases.push(word);
    aliasesByTarget.set(target, aliases);
  }
  return aliasesByTarget;
}

function buildDatabase(tags, localAliases) {
  const canonicalNames = new Set(tags.map((tag) => tag.name));
  const seenRows = new Set();
  const rows = [];

  const addRow = (word, category, count, redirect) => {
    assertRuntimeSafeField(word, '태그');
    assertRuntimeSafeField(redirect, '리디렉션');
    const key = `${word}\u0000${redirect}`;
    if (seenRows.has(key)) return;
    seenRows.add(key);
    rows.push({ word, category, count, redirect });
  };

  for (const tag of tags) {
    const canonical = displayName(tag.name);
    for (const alias of tag.aliases) {
      if (alias.startsWith('/') || canonicalNames.has(alias)) continue;
      addRow(displayName(alias), tag.category, tag.count, canonical);
    }
    for (const alias of localAliases.get(tag.name) || []) {
      addRow(alias, tag.category, tag.count, canonical);
    }
    addRow(canonical, tag.category, tag.count, 'null');
  }

  rows.sort(
    (a, b) =>
      b.count - a.count ||
      a.word.localeCompare(b.word, 'en') ||
      a.redirect.localeCompare(b.redirect, 'en'),
  );
  return `${rows
    .map(
      ({ word, category, count, redirect }) =>
        `${word},${category},${count},${redirect}`,
    )
    .join('\n')}\n`;
}

function sha256(content) {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .toUpperCase();
}

function main() {
  if (!Number.isInteger(MIN_POST_COUNT) || MIN_POST_COUNT < 1) {
    throw new Error(`최소 게시물 수가 올바르지 않습니다: ${MIN_POST_COUNT}`);
  }
  const source = fs.readFileSync(INPUT_FILE, 'utf8');
  if (
    INPUT_FILE === DEFAULT_INPUT_FILE &&
    sha256(source) !== DEFAULT_INPUT_SHA256
  ) {
    throw new Error('2026-06-01 원본 CSV의 SHA-256이 예상값과 다릅니다.');
  }
  const legacy = fs.readFileSync(LEGACY_DB_FILE, 'utf8');
  const tags = readSourceTags(source);
  const localAliases = readLocalAliases(legacy);
  const output = buildDatabase(tags, localAliases);

  for (const outputFile of OUTPUT_FILES) {
    fs.writeFileSync(outputFile, output, 'utf8');
  }

  const lineCount = output.trimEnd().split('\n').length;
  console.log(`원본: ${INPUT_FILE}`);
  console.log(`최소 게시물 수: ${MIN_POST_COUNT}`);
  console.log(`정규 태그: ${tags.length}`);
  console.log(`출력 행: ${lineCount}`);
  console.log(`출력 크기: ${Buffer.byteLength(output)} bytes`);
  console.log(`SHA-256: ${sha256(output)}`);
  for (const outputFile of OUTPUT_FILES) console.log(`저장: ${outputFile}`);
}

main();
