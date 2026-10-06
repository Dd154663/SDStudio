import path from 'path';

// 저장 경로 설치 폴더 금지(2026-10-06): 업데이트 설치는 설치 폴더의 앱 파일을 교체한다.
// electron-builder 5.5.0 이하 언인스톨러는 설치 폴더 안의 모든 파일을 지우므로, 저장 경로가
// 설치 폴더와 같거나 그 아래이면 업데이트 한 번에 데이터가 사라진다(실사고). 이 모듈은 그
// 포함 관계를 판정하는 순수 함수만 둔다 — main.ts 가 check-writable 거부와 부팅 경고에 쓴다.
// 거부 코드·경고 문구는 renderer 와 함께 쓰므로 src/shared/installDir.ts 에 둔다.

// child 가 parent 와 같은 폴더이거나 그 아래이면 true.
// - 구분자(/, \) 혼용과 상대 세그먼트(., ..)는 path.resolve 로 정규화한다.
// - Windows(win32)만 대소문자를 무시한다(NTFS 기본 동작). 그 밖의 플랫폼은 그대로 비교한다.
// - 다른 드라이브면 path.relative 가 절대 경로를 돌려주므로 false.
// - 빈 문자열은 판정하지 않는다(false) — resolve 가 현재 폴더로 바꿔 오판하는 것을 막는다.
export function isSameOrInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!child || !parent) return false;
  const p = platform === 'win32' ? path.win32 : path.posix;
  let c = p.resolve(child);
  let par = p.resolve(parent);
  if (platform === 'win32') {
    c = c.toLowerCase();
    par = par.toLowerCase();
  }
  const rel = p.relative(par, c);
  if (rel === '') return true;
  if (p.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith('..' + p.sep);
}

// 패키징된 앱의 설치 폴더(실행 파일이 있는 폴더). 개발 실행(electron .)은 실행 파일이
// node_modules 의 electron 이므로 판정 대상이 아니다(null).
export function resolveInstallDir(
  isPackaged: boolean,
  execPath: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!isPackaged || !execPath) return null;
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.dirname(execPath);
}
