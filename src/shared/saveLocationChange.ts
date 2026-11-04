// 저장 경로 변경 안전장치 — main·renderer 공용 상수·타입·문구 (2026-11-04)
//
// 저장 경로(config.saveLocation)는 main 의 initFolder 가 부팅 때만 데이터 루트(APP_DIR)로 반영한다.
// 그래서 경로를 바꾸면 재시작 전까지는 이전 위치에 계속 저장되고, 기존 데이터도 자동으로 옮겨지지
// 않는다. 이 모듈은 그 사실을 알리는 선택 창·보류 표시 문구와, 하위 폴더 쓰기 검사(check-writable
// 확장·부팅 경고)의 코드·타입을 한곳에 둔다(installDir.ts 와 같은 형식). 판정·프로브 자체는
// main 의 saveLocationProbe.ts 가 맡는다.

// 하위 폴더 쓰기 검사에서 한 번에 프로브하는 폴더 수의 상한(고른 폴더 자신 포함).
// 넘으면 나머지는 검사하지 않고 통과로 본다 — 부팅·선택이 느려지지 않게 한다.
export const SAVE_LOCATION_PROBE_LIMIT = 200;

// check-writable 두 번째 인자. dataSubdirs=true 면 고른 폴더에 SDStudio 데이터 배치가 있을 때
// 그 데이터 폴더와 직계 자식(프로젝트 폴더)까지 쓰기 검사한다(저장 경로 지정 전용 —
// 동기화 폴더 선택은 루트만).
export interface CheckWritableOptions {
  dataSubdirs?: boolean;
}

// check-writable 결과. failedPath = 쓰기에 실패한 하위 폴더(고른 폴더 자신이 실패하면 비움).
export interface CheckWritableResult {
  ok: boolean;
  code?: string;
  failedPath?: string;
}

// get-boot-warnings 의 saveLocationSubdirWarning — 부팅 때 데이터 루트 안의 일부 데이터 폴더에
// 쓸 수 없으면 채워진다(폴백하지 않고 경고만).
export interface SaveLocationSubdirWarning {
  path: string;
  code: string;
}

// 경로 변경 선택 창의 선택지 값.
export const SAVE_LOCATION_CHOICE = {
  restartNow: 'restart-now',
  restartLater: 'restart-later',
} as const;

export const SAVE_LOCATION_CHANGE_TEXT = {
  // 쓰기 검사 통과 뒤, 저장 전 선택 창 본문.
  changeDialog: (currentRoot: string, nextRoot: string) =>
    '저장 위치가 바뀝니다. 기존 데이터는 자동으로 옮겨지지 않습니다.\n' +
    `· 지금 위치: ${currentRoot || '(확인 불가)'}\n` +
    `· 새 위치: ${nextRoot}\n\n` +
    '기존 데이터를 새 위치에서 쓰려면 다음 중 한 가지 방법으로 옮겨 주세요.\n' +
    '① 「전체 백업」을 만든 뒤, 재시작하고 새 위치에서 복원\n' +
    '② 앱을 끈 뒤 이전 폴더의 내용을 새 폴더로 복사하고, 그다음 새 폴더를 지정\n\n' +
    '재시작하기 전까지는 이전 위치에 계속 저장됩니다.',
  restartNow: '지금 재시작',
  restartLater: '나중에 재시작',
  // 고른 폴더가 지금 쓰고 있는 위치와 같을 때 — 재시작이 필요 없다.
  sameAsCurrent: '지금 사용 중인 저장 위치와 같은 폴더입니다. 재시작하지 않아도 됩니다.',
  restartFailed: (message: string) =>
    `새 저장 위치는 저장했지만 앱을 다시 시작하지 못했습니다.\n(${message})\n\n` +
    '앱을 직접 껐다 켜 주세요. 재시작하기 전까지는 이전 위치에 계속 저장됩니다.',
  // 루트 쓰기 실패(기존 문구 유지).
  notWritable: (code?: string) =>
    `이 폴더에는 쓰기 권한이 없어 저장 위치로 사용할 수 없습니다.\n(${code ?? '알 수 없는 오류'})\n\n` +
    '다른 위치를 선택하거나, 해당 드라이브의 쓰기 권한을 먼저 확인해 주세요.',
  // 하위 데이터 폴더 쓰기 실패.
  subdirNotWritable: (failedPath: string, code?: string) =>
    '이 폴더에 들어 있는 SDStudio 데이터 폴더 중 일부에 쓸 수 없어 저장 위치로 사용할 수 없습니다.\n' +
    `· 쓸 수 없는 폴더: ${failedPath}\n` +
    `· 오류: ${code ?? '알 수 없는 오류'}\n\n` +
    '그 폴더의 쓰기 권한(읽기 전용 속성·보안 프로그램·다른 사용자 소유 등)을 먼저 확인해 주세요.',
  // 보류 상태(「나중에 재시작」) — 설정 화면 저장 경로 줄·화면 위 한 줄 안내.
  pendingNotice: (previousRoot: string) =>
    `아직 이전 위치(${previousRoot || '확인 불가'})에 저장 중입니다 — 재시작하면 새 위치가 적용됩니다.`,
  pendingNextRootLabel: '다음 부팅부터 쓸 위치',
  // 부팅 후 1회 안내 — 데이터 루트 안의 일부 폴더에 쓸 수 없음(폴백하지 않음).
  bootSubdirWarning: (failedPath: string, code: string) =>
    '저장 위치 안의 일부 데이터 폴더에 쓸 수 없습니다.\n' +
    `· 쓸 수 없는 폴더: ${failedPath}\n` +
    `· 오류: ${code}\n\n` +
    '이대로 쓰면 그 폴더의 프로젝트·이미지가 저장되지 않을 수 있습니다. ' +
    '폴더의 쓰기 권한(읽기 전용 속성·보안 프로그램·다른 사용자 소유 등)을 확인한 뒤 앱을 다시 시작해 주세요.',
};
