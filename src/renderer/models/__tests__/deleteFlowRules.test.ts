// deleteFlowRules 순수 판단 단위 테스트(2026-10-03 정비 묶음 U2).
// 의존성이 없는 모듈이라 mock 없이 직접 import 한다(isSafeImageToken 도 순수).

import {
  attachmentRemoveConfirmText,
  batchResultLine,
  deleteConfirmText,
  imageDeleteScopeLine,
  checkInpaintSceneRename,
  failedNamesLine,
  overlappingSceneNames,
  parseCustomResolution,
  pasteResultText,
  planGridImageDelete,
  projectDeleteResultText,
  runTrashDelete,
  safeImportedImageName,
  sceneImportOverwriteText,
  selectedImagesDeleteText,
  shouldSkipImageDeleteConfirm,
  showImageDeleteSkipOption,
} from '../deleteFlowRules';
import { isSafeImageToken } from '../projectTemplateBackup';

describe('「다시 묻지 않음」 적용 범위(X12)', () => {
  it('단일 이미지 삭제에서만 확인을 건너뛴다', () => {
    expect(shouldSkipImageDeleteConfirm(true, 1)).toBe(true);
    expect(shouldSkipImageDeleteConfirm(true, 2)).toBe(false);
    expect(shouldSkipImageDeleteConfirm(true, 0)).toBe(false);
    expect(shouldSkipImageDeleteConfirm(false, 1)).toBe(false);
  });
  it('체크박스는 단일 삭제 확인 창에만 보인다', () => {
    expect(showImageDeleteSkipOption(1)).toBe(true);
    expect(showImageDeleteSkipOption(3)).toBe(false);
  });
});

describe('이미지 그리드 「삭제」 대상(X3)', () => {
  const current = ['d/a.png', 'd/b.png', 'd/c.png'];
  it('선택 모드가 아니면 씬 전체 삭제 메뉴', () => {
    expect(planGridImageDelete(false, ['d/a.png'], current)).toEqual({
      kind: 'scene-menu',
    });
  });
  it('선택 모드면 선택분만 — 현재 목록 순서, 이미 지워진 선택은 버린다', () => {
    expect(
      planGridImageDelete(true, new Set(['d/c.png', 'd/gone.png', 'd/a.png']), current),
    ).toEqual({ kind: 'selected', paths: ['d/a.png', 'd/c.png'] });
  });
  it('선택 모드인데 남은 선택이 없으면 안내만', () => {
    expect(planGridImageDelete(true, [], current)).toEqual({ kind: 'empty-selection' });
    expect(planGridImageDelete(true, ['d/gone.png'], current)).toEqual({
      kind: 'empty-selection',
    });
  });
  it('확인 문구에 장수와 보관 기간(deleteConfirmText 로 위임, E1)', () => {
    expect(selectedImagesDeleteText(3, 3)).toBe(
      '이미지 3장을 삭제할까요?\n휴지통으로 이동되어 3일 동안 복원할 수 있습니다.',
    );
  });
});

describe('삭제 결과 판정(X4)', () => {
  it('목록에서 사라지면 성공', async () => {
    let listed = true;
    const out = await runTrashDelete({
      remove: async () => {
        listed = false;
      },
      stillExists: () => listed,
    });
    expect(out).toEqual({ kind: 'deleted' });
    expect(projectDeleteResultText(out, 30)).toEqual({
      ok: true,
      text: '프로젝트가 휴지통으로 이동되었습니다(30일 보관)',
    });
  });
  it('예외 없이 돌아왔는데 남아 있으면(다른 창 잠금) 실패', async () => {
    const out = await runTrashDelete({
      remove: async () => {},
      stillExists: () => true,
    });
    expect(out).toEqual({ kind: 'still-present' });
    const r = projectDeleteResultText(out, 30);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('다른 창에서 열려 있을 수 있습니다');
  });
  it('예외면 메시지를 그대로', async () => {
    const out = await runTrashDelete({
      remove: async () => {
        throw new Error('불러오지 못해 삭제하지 않았습니다.');
      },
      stillExists: () => false,
    });
    expect(out).toEqual({ kind: 'error', message: '불러오지 못해 삭제하지 않았습니다.' });
    expect(projectDeleteResultText(out, 30).ok).toBe(false);
  });
  it('씬 템플릿 문구', () => {
    expect(projectDeleteResultText({ kind: 'deleted' }, 30, 'scene-template').text).toBe(
      '씬 템플릿이 휴지통으로 이동되었습니다(30일 보관)',
    );
  });
});

describe('일괄 결과 문구(X13)', () => {
  it('삭제 N · 실패 N', () => {
    expect(batchResultLine(3, 0)).toBe('삭제 3');
    expect(batchResultLine(3, 2)).toBe('삭제 3 · 실패 2');
  });
  it('실패 이름은 5개까지 + 외 N개', () => {
    expect(failedNamesLine(['a', 'b'])).toBe('「a」, 「b」');
    expect(failedNamesLine(['1', '2', '3', '4', '5', '6', '7'])).toBe(
      '「1」, 「2」, 「3」, 「4」, 「5」 외 2개',
    );
    expect(failedNamesLine([])).toBe('');
  });
  it('붙여넣기 결과는 한 줄', () => {
    expect(pasteResultText(4, 0)).toBe('4장의 이미지가 붙여넣어졌습니다.');
    expect(pasteResultText(3, 1)).toBe('이미지 붙여넣기: 성공 3 · 실패 1');
  });
});

describe('커스텀 해상도 입력 검증(X15c)', () => {
  it('빈칸·문자·0·음수는 거부(예전에는 0x0 저장)', () => {
    expect(parseCustomResolution('', '512').ok).toBe(false);
    expect(parseCustomResolution('abc', '512').ok).toBe(false);
    expect(parseCustomResolution('0', '512').ok).toBe(false);
    expect(parseCustomResolution('-64', '512').ok).toBe(false);
    expect(parseCustomResolution('12.5', '512').ok).toBe(false);
    expect(parseCustomResolution(null, '512').ok).toBe(false);
  });
  it('64 배수 올림 보정과 보정 여부', () => {
    expect(parseCustomResolution('1024', '1536')).toEqual({
      ok: true,
      width: 1024,
      height: 1536,
      adjusted: false,
    });
    expect(parseCustomResolution(' 1000 ', '1')).toEqual({
      ok: true,
      width: 1024,
      height: 64,
      adjusted: true,
    });
  });
});

describe('가져온 이미지 파일명 정제(X15b)', () => {
  const makeNew = () => 'new-uuid.png';
  it('안전한 파일명은 그대로', () => {
    expect(safeImportedImageName('3f2a-1b.png', isSafeImageToken, makeNew)).toEqual({
      name: '3f2a-1b.png',
      renamed: false,
    });
  });
  it.each([
    '../../projects/x.json',
    '..',
    '/etc/passwd',
    'C:\\Windows\\a.png',
    'sub/a.png',
    '.hidden.png',
    '',
    undefined,
    42,
  ])('경로 이탈·이상한 값(%p)은 새 이름', (bad) => {
    expect(safeImportedImageName(bad, isSafeImageToken, makeNew)).toEqual({
      name: 'new-uuid.png',
      renamed: true,
    });
  });
});

describe('변형 씬 이름 확정(X15a)', () => {
  const taken = new Set(['B', 'C']);
  const exists = (n: string) => taken.has(n);
  it('같은 이름·끝 공백만 다른 이름은 변경 없음', () => {
    expect(checkInpaintSceneRename('A', 'A', exists)).toEqual({ kind: 'unchanged' });
    expect(checkInpaintSceneRename('A', 'A  ', exists)).toEqual({ kind: 'unchanged' });
  });
  it('빈 이름·구분자·점 시작은 거부', () => {
    expect(checkInpaintSceneRename('A', '   ', exists).kind).toBe('invalid');
    expect(checkInpaintSceneRename('A', 'x/y', exists).kind).toBe('invalid');
    expect(checkInpaintSceneRename('A', 'x\\y', exists).kind).toBe('invalid');
    expect(checkInpaintSceneRename('A', '.trash', exists).kind).toBe('invalid');
  });
  it('같은 종류 동명은 거부', () => {
    expect(checkInpaintSceneRename('A', 'B', exists).kind).toBe('duplicate');
  });
  it('정상 이름은 끝 공백을 뗀 이름으로', () => {
    expect(checkInpaintSceneRename('A', 'D ', exists)).toEqual({ kind: 'ok', name: 'D' });
  });
});

describe('삭제 확인 문구 단일 출처 deleteConfirmText(E1)', () => {
  it('휴지통 — 단건 이름·[삭제]·danger true·전달한 보존 일수', () => {
    expect(deleteConfirmText({ kind: 'scene', name: '숲', outcome: { trashDays: 14 } })).toEqual({
      text: '씬 "숲"을 삭제할까요?\n휴지통으로 이동되어 14일 동안 복원할 수 있습니다.',
      confirmText: '삭제',
      danger: true,
    });
    expect(
      deleteConfirmText({ kind: 'project', name: '바다', outcome: { trashDays: 30 } }).text,
    ).toBe('프로젝트 "바다"를 삭제할까요?\n휴지통으로 이동되어 30일 동안 복원할 수 있습니다.');
  });
  it('영구 — [영구 삭제]·danger permanent(Enter 무시)·되돌릴 수 없음', () => {
    expect(deleteConfirmText({ kind: 'pieceGroup', name: 'abc', outcome: 'permanent' })).toEqual({
      text: '조각그룹 "abc"을(를) 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.',
      confirmText: '영구 삭제',
      danger: 'permanent',
    });
  });
  it('이름 없으면 「이 {종류}」, 복수는 개수(이미지 장·작가 명·그 밖 개)', () => {
    expect(deleteConfirmText({ kind: 'image', outcome: { trashDays: 3 } }).text).toBe(
      '이 이미지를 삭제할까요?\n휴지통으로 이동되어 3일 동안 복원할 수 있습니다.',
    );
    expect(deleteConfirmText({ kind: 'image', count: 5, outcome: 'permanent' }).text).toMatch(
      /^이미지 5장을 영구 삭제할까요\?/,
    );
    expect(deleteConfirmText({ kind: 'artist', count: 2, outcome: 'permanent' }).text).toMatch(
      /^작가 2명을 영구 삭제할까요\?/,
    );
    expect(
      deleteConfirmText({ kind: 'globalPreset', count: 4, outcome: 'permanent' }).text,
    ).toMatch(/^글로벌 프리셋 4개를 영구 삭제할까요\?/);
    expect(
      deleteConfirmText({ kind: 'inpaintScene', count: 2, outcome: { trashDays: 14 } }).text,
    ).toMatch(/^변형 씬 2개를 삭제할까요\?/);
  });
  it('extra 는 본문 끝 줄', () => {
    const r = deleteConfirmText({
      kind: 'artist',
      name: '작가A',
      outcome: 'permanent',
      extra: '첨부된 이미지도 함께 삭제됩니다.',
    });
    expect(r.text.split('\n')).toEqual([
      '작가 "작가A"을(를) 영구 삭제할까요?',
      '이 작업은 되돌릴 수 없습니다.',
      '첨부된 이미지도 함께 삭제됩니다.',
    ]);
  });
  it('여러 장 이미지 범위 줄 — n등 이하는 즐겨찾기 제외를 함께', () => {
    expect(imageDeleteScopeLine({})).toBeUndefined();
    expect(imageDeleteScopeLine({ excludeFav: true })).toBe('대상: 즐겨찾기 제외');
    expect(imageDeleteScopeLine({ rankBelow: 5 })).toBe('대상: 5등 이하 · 즐겨찾기 제외');
    expect(imageDeleteScopeLine({ sceneCount: 3, rankBelow: 2 })).toBe(
      '대상: 씬 3개 · 2등 이하 · 즐겨찾기 제외',
    );
    // n등 이하 확인 창(E1-3) — 개수·범위가 함께 보인다
    const t = deleteConfirmText({
      kind: 'image',
      count: 7,
      outcome: { trashDays: 3 },
      extra: imageDeleteScopeLine({ rankBelow: 5 }),
    });
    expect(t.danger).toBe(true);
    expect(t.text).toBe(
      '이미지 7장을 삭제할까요?\n휴지통으로 이동되어 3일 동안 복원할 수 있습니다.\n대상: 5등 이하 · 즐겨찾기 제외',
    );
  });
  it('템플릿 첨부 제거(E1-4) — [제거]·danger true(Enter 허용)', () => {
    expect(attachmentRemoveConfirmText({ what: '이미지', name: '바이브 1' })).toEqual({
      text: '첨부 이미지 "바이브 1"을(를) 제거할까요?\n파일이 영구 삭제됩니다.',
      confirmText: '제거',
      danger: true,
    });
    expect(
      attachmentRemoveConfirmText({ what: '캐릭터 프리셋', name: '하나' }).text,
    ).toBe('첨부 캐릭터 프리셋 "하나"를 제거할까요?\n딸린 이미지 파일이 영구 삭제됩니다.');
  });
});

describe('씬만 가져오기 덮어쓰기 확인(X10)', () => {
  it('겹치는 씬만 가져올 파일 순서로', () => {
    const cur = new Set(['s1', 's3']);
    expect(overlappingSceneNames(['s3', 's2', 's1'], (n) => cur.has(n))).toEqual([
      's3',
      's1',
    ]);
    expect(overlappingSceneNames(['x'], (n) => cur.has(n))).toEqual([]);
  });
  it('문구에 개수·이름 일부·되돌릴 수 없음', () => {
    const t = sceneImportOverwriteText(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(t).toContain('6개');
    expect(t).toContain('「a」');
    expect(t).toContain('외 1개');
    expect(t).toContain('기존 씬의 프롬프트 구성이 바뀝니다. 되돌릴 수 없습니다.');
  });
});
