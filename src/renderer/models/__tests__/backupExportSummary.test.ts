// 전체·폴더 백업 만들기 완료 문구(2026-11-22 P3·3-1·3-7) — 순수 함수.
import { buildBackupDoneText, BACKUP_EXPORT_TEXT, formatNameList } from '../backupExportSummary';

describe('formatNameList', () => {
  test('다섯 개까지는 그대로, 넘으면 「외 N개」', () => {
    expect(formatNameList(['a', 'b'])).toBe('a, b');
    expect(formatNameList(['1', '2', '3', '4', '5', '6', '7'])).toBe('1, 2, 3, 4, 5 외 2개');
  });
});

describe('buildBackupDoneText', () => {
  test('전체 백업, 빠진 것 없음 = 종전 첫 줄 + 들어가지 않는 것 한 줄', () => {
    expect(
      buildBackupDoneText({ kind: 'full', mode: 'full', includedCount: 3, skipped: [], imagesUnread: [] }),
    ).toBe('전체 백업이 완료되었습니다. (3개 프로젝트)\n' + BACKUP_EXPORT_TEXT.notIncluded);
  });

  test('이미지 제외·설정만 첫 줄', () => {
    expect(
      buildBackupDoneText({ kind: 'full', mode: 'noimg', includedCount: 1, skipped: [], imagesUnread: [] }).split('\n')[0],
    ).toBe('전체 백업이 완료되었습니다. (1개 프로젝트, 이미지 제외)');
    const s = buildBackupDoneText({ kind: 'full', mode: 'settings', includedCount: 0, skipped: [], imagesUnread: [] });
    expect(s.split('\n')).toEqual(['설정 백업이 완료되었습니다.', BACKUP_EXPORT_TEXT.notIncluded]);
  });

  test('빠진 프로젝트·이미지 폴더 못 읽은 프로젝트 줄(개수는 들어간 개수 그대로)', () => {
    const t = buildBackupDoneText({
      kind: 'full',
      mode: 'full',
      includedCount: 2,
      skipped: ['깨짐1', '깨짐2', '깨짐1'],
      imagesUnread: ['P', '깨짐2'],
    });
    expect(t.split('\n')).toEqual([
      '전체 백업이 완료되었습니다. (2개 프로젝트)',
      '2개 프로젝트는 읽지 못해 빠졌습니다: 깨짐1, 깨짐2',
      '1개 프로젝트는 이미지 폴더를 읽지 못해 일부 이미지가 빠졌을 수 있습니다: P',
      BACKUP_EXPORT_TEXT.notIncluded,
    ]);
  });

  test('폴더 백업 = 들어가지 않는 것 줄 없음', () => {
    const t = buildBackupDoneText({
      kind: 'folder',
      folder: 'F',
      includedCount: 1,
      skipped: ['X'],
      imagesUnread: [],
    });
    expect(t).toBe('폴더 "F" 백업이 완료되었습니다. (1개 프로젝트)\n1개 프로젝트는 읽지 못해 빠졌습니다: X');
  });

  test('들어가지 않는 것 문구는 작가 라이브러리 탭의 실제 버튼 이름 「백업」을 가리킴', () => {
    expect(BACKUP_EXPORT_TEXT.notIncluded).toContain('작가 라이브러리 탭의 「백업」');
    expect(BACKUP_EXPORT_TEXT.notIncluded).toContain('환경설정');
  });
});
