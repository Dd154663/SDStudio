// 저장 경로 설치 폴더 금지 — main·renderer 공용 코드·타입·문구 (2026-10-06)
//
// 업데이트 설치는 프로그램 설치 폴더의 앱 파일을 교체한다(5.5.0 이하 언인스톨러는 설치 폴더 안의
// 모든 파일을 지운다). 그래서 저장 경로(config.saveLocation)를 설치 폴더 안으로 지정하지 못하게
// 하고(check-writable 거부), 이미 그렇게 쓰고 있으면 부팅 때 경고한다. 판정은 main 의
// installDirGuard.isSameOrInside 가 맡는다.

// check-writable 이 저장 경로 후보가 설치 폴더와 같거나 그 아래일 때 돌려주는 코드.
export const INSIDE_INSTALL_DIR_CODE = 'inside-install-dir';

// get-boot-warnings 의 saveLocationInsideInstall — 현재 데이터 루트가 설치 폴더 안이면 채워진다.
export interface SaveLocationInsideInstall {
  path: string;
  installDir: string;
}

export const INSTALL_DIR_TEXT = {
  // 환경설정 「저장경로」에서 설치 폴더(또는 그 하위)를 고른 경우.
  selectRejected:
    '이 폴더는 프로그램 설치 폴더 안에 있어 저장 위치로 사용할 수 없습니다.\n' +
    '업데이트를 설치할 때 설치 폴더의 파일이 교체되면서 데이터가 삭제될 수 있습니다.\n\n' +
    '설치 폴더 밖의 다른 위치를 선택해 주세요.',
  // 드라이브 동기화 폴더(같은 check-writable 사용)로 설치 폴더 안을 고른 경우.
  syncFolderRejected:
    '이 폴더는 프로그램 설치 폴더 안에 있어 사용할 수 없습니다.\n' +
    '업데이트를 설치할 때 설치 폴더의 파일이 교체되면서 내보낸 파일이 삭제될 수 있습니다.\n\n' +
    '설치 폴더 밖의 다른 위치를 선택해 주세요.',
  // 부팅 후 1회 안내 — 이미 설치 폴더 안을 저장 위치로 쓰고 있는 경우(자동으로 옮기지 않는다).
  bootWarning: (dataPath: string, installDir: string) =>
    '현재 저장 위치가 프로그램 설치 폴더 안에 있습니다.\n' +
    `· 저장 위치: ${dataPath}\n` +
    `· 설치 폴더: ${installDir}\n\n` +
    '이대로 두면 업데이트를 설치할 때 데이터가 삭제될 수 있습니다. ' +
    '데이터를 백업한 뒤 환경설정의 「저장경로」에서 설치 폴더 밖의 다른 위치로 옮겨 주세요.',
};
