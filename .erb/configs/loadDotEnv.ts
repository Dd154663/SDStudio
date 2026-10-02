// 저장소 루트 .env 읽기 — 외부 의존성 없는 최소 파서 (2026-10-02)
//
// 용도: Google OAuth 클라이언트 값처럼 공개 저장소에 둘 수 없는 빌드 설정을 로컬 .env(gitignore)
// 에서 읽어 process.env 에 채운다. 호출부는 둘뿐이다.
//   - webpack.config.main.prod.ts: 프로덕션 main 번들 빌드 직전(EnvironmentPlugin 이 문자열로 치환)
//   - src/main/devDotEnv.ts: 개발 실행(npm start, ts-node 로 main 을 번들 없이 실행)
// 형식: KEY=VALUE 한 줄씩. 빈 줄·# 주석 줄 무시, 앞의 export 무시, 키·값 앞뒤 공백 제거,
// 값을 감싼 따옴표('…' 또는 "…") 제거. 따옴표 없는 값의 「 #」 뒤는 주석으로 본다.
// 이미 설정된 환경 변수(CI Secrets·셸에서 지정한 값)는 덮어쓰지 않는다.
// 위치 주의: .erb/scripts/ 는 .gitignore 의 `scripts/` 규칙에 걸려 새 파일이 추적되지 않으므로 configs 에 둔다.

import fs from 'fs';
import path from 'path';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (!KEY_RE.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

// 이미 값이 있는 변수(빈 문자열 포함)는 그대로 둔다. 실제로 채운 키 이름 목록을 돌려준다(값은 돌려주지 않음).
export function applyDotEnv(
  parsed: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

// 파일이 없으면 아무것도 하지 않는다(미설정 빌드). 읽기 오류도 조용히 무시한다.
export function loadDotEnv(
  filePath: string = path.resolve(__dirname, '../../.env'),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  return applyDotEnv(parseDotEnv(text), env);
}
