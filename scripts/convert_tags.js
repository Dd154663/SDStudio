/**
 * Civitai/DraconicDragon 형식 → SDStudio 형식 변환 스크립트
 *
 * 입력 형식 (Civitai): tag,category,count,"alias1,alias2,..."
 *   - tag: 언더스코어 구분 (예: long_hair)
 *   - category: 0=General, 1=Artist, 3=Copyright, 4=Character, 5=Meta
 *   - count: post_count
 *   - aliases: 따옴표 안에 쉼표로 나열
 *
 * 출력 형식 (SDStudio): word,category,frequency,redirect
 *   - word: 공백 구분 (예: long hair)
 *   - 별칭은 각각 별도 줄, redirect=정규태그
 *   - 정규 태그는 redirect=null
 *   - post_count 내림차순 정렬
 *
 * 기존 DB의 한국어 별칭도 병합합니다.
 *
 * 사용법: node scripts/convert_tags.js
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'assets', 'danbooru_20250501_raw.csv');
const OLD_DB_FILE = path.join(__dirname, '..', 'assets', 'db.txt');
const OUTPUT_FILE = path.join(__dirname, '..', 'assets', 'db_new.txt');

function parseCivitaiCSV(content) {
  const tags = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // CSV 파싱: tag,category,count,"alias1,alias2,..."
    // 따옴표 안에 쉼표가 있을 수 있음
    let tag, category, count, aliasStr;

    const quotedMatch = line.match(/^([^,]+),(\d+),(\d+),"(.*)"$/);
    if (quotedMatch) {
      tag = quotedMatch[1];
      category = parseInt(quotedMatch[2]);
      count = parseInt(quotedMatch[3]);
      aliasStr = quotedMatch[4];
    } else {
      const simpleMatch = line.match(/^([^,]+),(\d+),(\d+),?(.*)$/);
      if (!simpleMatch) continue;
      tag = simpleMatch[1];
      category = parseInt(simpleMatch[2]);
      count = parseInt(simpleMatch[3]);
      aliasStr = simpleMatch[4] || '';
    }

    const aliases = aliasStr
      ? aliasStr.split(',').map(a => a.trim()).filter(a => a)
      : [];

    tags.push({ tag, category, count, aliases });
  }

  return tags;
}

function parseOldDB(content) {
  // 기존 DB에서 한국어 별칭 추출
  // 형식: word,category,frequency,redirect
  const koreanAliases = new Map(); // redirect_target -> [korean_alias, ...]

  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;

    // 간단한 파싱: 마지막 필드가 redirect
    const parts = line.split(',');
    if (parts.length < 4) continue;

    const redirect = parts[parts.length - 1];
    if (redirect === 'null') continue;

    const word = parts.slice(0, parts.length - 3).join(',');

    // 한국어 문자가 포함된 별칭만 추출
    if (/[\uAC00-\uD7AF\u3131-\u3163\u3040-\u309F\u30A0-\u30FF]/.test(word)) {
      const targetKey = redirect.replace(/ /g, '_');
      if (!koreanAliases.has(targetKey)) {
        koreanAliases.set(targetKey, []);
      }
      koreanAliases.get(targetKey).push(word);
    }
  }

  return koreanAliases;
}

function buildSDStudioDB(tags, koreanAliases) {
  const lines = [];
  const tagNameSet = new Set(tags.map(t => t.tag));
  const addedAliases = new Set(); // 중복 방지

  for (const { tag, category, count, aliases } of tags) {
    const displayName = tag.replace(/_/g, ' ');

    // 별칭 라인 추가 (redirect → 정규 태그)
    for (const alias of aliases) {
      const aliasDisplay = alias.replace(/_/g, ' ');
      // 별칭이 이미 정규 태그인 경우 스킵
      if (tagNameSet.has(alias)) continue;
      // / 로 시작하는 단축키형 별칭 제외 (sd-webui 전용)
      if (alias.startsWith('/')) continue;
      const key = `${aliasDisplay}->${displayName}`;
      if (addedAliases.has(key)) continue;
      addedAliases.add(key);
      lines.push(`${aliasDisplay},${category},${count},${displayName}`);
    }

    // 한국어 별칭 추가 (기존 DB에서)
    const krAliases = koreanAliases.get(tag);
    if (krAliases) {
      for (const krAlias of krAliases) {
        const key = `${krAlias}->${displayName}`;
        if (addedAliases.has(key)) continue;
        addedAliases.add(key);
        lines.push(`${krAlias},${category},${count},${displayName}`);
      }
    }

    // 정규 태그 라인 (redirect=null)
    lines.push(`${displayName},${category},${count},null`);
  }

  // post_count 기준 내림차순 정렬
  lines.sort((a, b) => {
    const partsA = a.split(',');
    const partsB = b.split(',');
    const countA = parseInt(partsA[partsA.length - 2]);
    const countB = parseInt(partsB[partsB.length - 2]);
    return countB - countA;
  });

  return lines.join('\n') + '\n';
}

function main() {
  console.log('=== SDStudio 태그 DB 변환 ===');
  console.log('');

  // 1. Civitai CSV 파싱
  console.log('1. Civitai CSV 파싱...');
  const rawContent = fs.readFileSync(INPUT_FILE, 'utf-8');
  const tags = parseCivitaiCSV(rawContent);
  console.log(`   정규 태그: ${tags.length}개`);

  const totalAliases = tags.reduce((sum, t) => sum + t.aliases.length, 0);
  console.log(`   별칭 (Danbooru): ${totalAliases}개`);

  // 카테고리 분포
  const cats = {};
  for (const t of tags) {
    cats[t.category] = (cats[t.category] || 0) + 1;
  }
  console.log('   카테고리 분포:');
  console.log(`     0(General): ${cats[0] || 0}`);
  console.log(`     1(Artist): ${cats[1] || 0}`);
  console.log(`     3(Copyright): ${cats[3] || 0}`);
  console.log(`     4(Character): ${cats[4] || 0}`);
  console.log(`     5(Meta): ${cats[5] || 0}`);

  // 2. 기존 DB에서 한국어 별칭 추출
  console.log('');
  console.log('2. 기존 DB에서 한국어/일본어 별칭 추출...');
  const oldContent = fs.readFileSync(OLD_DB_FILE, 'utf-8');
  const koreanAliases = parseOldDB(oldContent);
  let totalKr = 0;
  for (const [, aliases] of koreanAliases) {
    totalKr += aliases.length;
  }
  console.log(`   한국어/일본어 별칭: ${totalKr}개 (${koreanAliases.size}개 태그에 대해)`);

  // 3. SDStudio 형식으로 변환
  console.log('');
  console.log('3. SDStudio 형식으로 변환...');
  const result = buildSDStudioDB(tags, koreanAliases);

  // 4. 저장
  fs.writeFileSync(OUTPUT_FILE, result, 'utf-8');
  const lineCount = result.split('\n').filter(l => l.trim()).length;
  const sizeKB = (Buffer.byteLength(result, 'utf-8') / 1024).toFixed(0);
  console.log(`   총 라인: ${lineCount}개`);
  console.log(`   파일 크기: ${sizeKB} KB`);

  // 5. 기존 DB와 비교
  const oldLines = oldContent.split('\n').filter(l => l.trim());
  console.log('');
  console.log('=== 비교 ===');
  console.log(`기존 DB: ${oldLines.length}개 라인`);
  console.log(`신규 DB: ${lineCount}개 라인`);
  console.log(`차이: ${lineCount - oldLines.length > 0 ? '+' : ''}${lineCount - oldLines.length}개`);

  console.log('');
  console.log(`저장 완료: ${OUTPUT_FILE}`);
}

main();
