/**
 * 프로젝트 백업 불러오기·덮어쓰기(드라이브 동기화 C안 ⑤, 2026-09-28) — 파일명 규칙,
 * 이름 제안·검사, 정책 계획, 덮어쓰기 절차 분기(임시 백업 실패·가져오기 실패·삭제
 * 미반영 → 중단), 대화상자 없는 임시 백업 저장(saveExportSilently).
 */
const backend = {
  getConfig: jest.fn(),
  copyFileToAbsolute: jest.fn(),
  deleteFile: jest.fn(),
  existFileAbsolute: jest.fn(),
  saveExportToDownloads: jest.fn(),
};
const platform = { supportsTargetFolder: true };
jest.mock('..', () => ({ backend }));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../platform', () => ({ platform }));

import {
  checkNewProjectName,
  fileStemOf,
  localDateLabel,
  overwriteFailureText,
  planProjectImport,
  projectBackupFileName,
  projectBeforeOverwriteFileName,
  projectImportSummary,
  PROJECT_IMPORT_TEXT,
  runProjectOverwrite,
  suggestProjectName,
  uniqueProjectName,
  type OverwriteDeps,
} from '../projectOverwrite';
import { namedSyncFileName, saveExportSilently } from '../driveSync';

const DATE = new Date('2026-09-28T01:02:03.456Z');

beforeEach(() => {
  jest.resetAllMocks();
  platform.supportsTargetFolder = true;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('파일명 규칙', () => {
  it('프로젝트 백업 = sdstudio-project-<안전한 이름>-<날짜>.tar', () => {
    expect(projectBackupFileName('내 프로젝트', DATE)).toBe(
      'sdstudio-project-내_프로젝트-2026-09-28T01-02-03.tar',
    );
    expect(projectBackupFileName('a/b:c*?', DATE)).toBe(
      'sdstudio-project-a_b_c-2026-09-28T01-02-03.tar',
    );
  });
  it('덮어쓰기 전 임시 백업에는 before-overwrite 표시', () => {
    expect(projectBeforeOverwriteFileName('작품 A', DATE)).toBe(
      'sdstudio-project-작품_A-before-overwrite-2026-09-28T01-02-03.tar',
    );
  });
  it('정제 결과가 빈 이름은 이름 자리를 생략', () => {
    expect(namedSyncFileName('project', '...', DATE, '.tar')).toBe(
      'sdstudio-project-2026-09-28T01-02-03.tar',
    );
  });
  it('로컬 날짜 표시는 콜론 없이', () => {
    const label = localDateLabel(new Date(2026, 8, 28, 7, 5));
    expect(label).toBe('2026-09-28 07-05');
    expect(label).not.toMatch(/[:\\/]/);
  });
});

describe('이름 제안·검사', () => {
  it('uniqueProjectName: 비어 있으면 그대로, 아니면 (2)(3)…', () => {
    expect(uniqueProjectName('A', ['B'])).toBe('A');
    expect(uniqueProjectName('A', ['A', 'A (2)'])).toBe('A (3)');
  });
  it('suggestProjectName: project.json 이름 → 파일 이름 → 기본 이름', () => {
    expect(suggestProjectName('  원본 ', 'file')).toBe('원본');
    expect(suggestProjectName('a/b', 'file')).toBe('file');
    expect(suggestProjectName(undefined, '.hidden')).toBe('가져온 프로젝트');
  });
  it('fileStemOf: PC 경로·content URI', () => {
    expect(fileStemOf('C:\\Drive\\sdstudio-project-A-x.tar')).toBe(
      'sdstudio-project-A-x',
    );
    expect(fileStemOf('content://x/document/primary%3ADownload%2Fmy.tar')).toBe(
      'my',
    );
    expect(fileStemOf(undefined)).toBeUndefined();
  });
  it('checkNewProjectName: 잘못된 이름·같은 이름 거부', () => {
    expect(checkNewProjectName('ok', ['a'])).toBeNull();
    expect(checkNewProjectName('a', ['a'])).toBe(PROJECT_IMPORT_TEXT.nameTaken);
    expect(checkNewProjectName('.x', [])).toMatch('사용할 수 없는');
  });
  it('planProjectImport: 이미지 없는 백업은 덮어쓰기 숨김, 충돌 시 새 이름 기본값', () => {
    expect(
      planProjectImport({ suggested: 'A', existing: ['A'], hasImages: true }),
    ).toEqual({ conflict: true, allowOverwrite: true, renameDefault: 'A (2)' });
    expect(
      planProjectImport({ suggested: 'A', existing: ['A'], hasImages: false })
        .allowOverwrite,
    ).toBe(false);
    expect(
      planProjectImport({ suggested: 'A', existing: [], hasImages: true }),
    ).toEqual({ conflict: false, allowOverwrite: false, renameDefault: 'A' });
  });
  it('projectImportSummary: 정책별 추가/갱신/건너뜀 1', () => {
    expect(projectImportSummary('rename')).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(projectImportSummary('overwrite')).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(projectImportSummary('skip')).toEqual({ added: 0, updated: 0, skipped: 1 });
  });
});

// ───── 덮어쓰기 절차 ─────
function makeDeps(opts: {
  names?: string[];
  folders?: Record<string, string | null>;
  lockedAt?: number[]; // isLockedElsewhere 몇 번째 호출(1부터)에서 잠김
  fail?: Partial<Record<'flush' | 'export' | 'save' | 'import' | 'rename1' | 'remove' | 'rename2', boolean>>;
  silent?: Partial<Record<'rename1' | 'remove' | 'rename2' | 'move', boolean>>;
  trashed?: string[];
}) {
  const names = new Set(opts.names ?? ['A', 'B']);
  const folders: Record<string, string | null> = { ...(opts.folders ?? {}) };
  const calls: string[] = [];
  let lockCalls = 0;
  let renameCalls = 0;
  const deps: OverwriteDeps = {
    listNames: () => [...names],
    trashedNames: async () => opts.trashed ?? [],
    isLockedElsewhere: async (n) => {
      lockCalls++;
      calls.push('lock:' + n);
      return (opts.lockedAt ?? []).includes(lockCalls);
    },
    folderOf: (n) => folders[n] ?? null,
    folderExists: (f) => f === 'F',
    flush: async (n) => {
      calls.push('flush:' + n);
      if (opts.fail?.flush) throw new Error('flush 실패');
    },
    exportBackup: async (n, p) => {
      calls.push('export:' + n + ':' + p);
      if (opts.fail?.export) throw new Error('export 실패');
    },
    saveBackup: async (p) => {
      calls.push('save:' + p);
      if (opts.fail?.save) throw new Error('저장 실패');
      return 'D:/Drive/' + p.split('/').pop();
    },
    discardStaging: async (p) => {
      calls.push('discard:' + p);
    },
    importAs: async (n) => {
      calls.push('import:' + n);
      if (opts.fail?.import) throw new Error('import 실패');
      names.add(n);
    },
    beforeSwap: (n) => {
      calls.push('beforeSwap:' + n);
    },
    rename: async (o, n) => {
      renameCalls++;
      const key = renameCalls === 1 ? 'rename1' : 'rename2';
      calls.push('rename:' + o + '->' + n);
      if (opts.fail?.[key]) throw new Error(key + ' 실패');
      if (opts.silent?.[key]) return; // 교차 창 잠금 등으로 조용히 돌아옴
      names.delete(o);
      names.add(n);
      if (o in folders) {
        folders[n] = folders[o];
        delete folders[o];
      }
    },
    remove: async (n) => {
      calls.push('remove:' + n);
      if (opts.fail?.remove) throw new Error('remove 실패');
      if (opts.silent?.remove) return;
      names.delete(n);
    },
    moveToFolder: async (n, f) => {
      calls.push('move:' + n + '->' + f);
      if (opts.silent?.move) return;
      folders[n] = f;
    },
  };
  return { deps, calls, names, folders };
}

const NOW = new Date(2026, 8, 28, 10, 30);
const TRASH = 'A (덮어쓰기 전 2026-09-28 10-30)';
const TEMP = 'A (가져오는 중)';
const STAGING =
  'exports/' + projectBeforeOverwriteFileName('A', NOW);

describe('runProjectOverwrite', () => {
  it('성공: 잠금 확인 → flush → 백업 → 저장 → 임시 가져오기 → 휴지통 이름 → 삭제 → 원래 이름 → 원래 폴더', async () => {
    const { deps, calls, names, folders } = makeDeps({
      folders: { A: 'F' },
    });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toEqual({
      ok: true,
      backupLocation: 'D:/Drive/' + STAGING.split('/').pop(),
      trashName: TRASH,
    });
    expect(calls).toEqual([
      'lock:A',
      'flush:A',
      'export:A:' + STAGING,
      'save:' + STAGING,
      'import:' + TEMP,
      'beforeSwap:A',
      'lock:A',
      'rename:A->' + TRASH,
      'remove:' + TRASH,
      'rename:' + TEMP + '->A',
      'move:A->F',
    ]);
    expect([...names].sort()).toEqual(['A', 'B']);
    expect(folders.A).toBe('F');
  });

  it('대상이 없으면 아무것도 하지 않음', async () => {
    const { deps, calls } = makeDeps({ names: ['B'] });
    expect(await runProjectOverwrite('A', NOW, deps)).toEqual({
      ok: false,
      stage: 'missing',
    });
    expect(calls).toEqual([]);
  });

  it('다른 창에서 열려 있으면 처음부터 중단(무변경)', async () => {
    const { deps, calls } = makeDeps({ lockedAt: [1] });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toEqual({ ok: false, stage: 'locked' });
    expect(calls).toEqual(['lock:A']);
  });

  it.each(['flush', 'export', 'save'] as const)(
    '임시 백업 단계(%s) 실패 → 스테이징 정리 후 중단, 가져오기·이름변경·삭제 없음',
    async (step) => {
      const { deps, calls, names } = makeDeps({ fail: { [step]: true } });
      const r = await runProjectOverwrite('A', NOW, deps);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.stage).toBe('backup');
      expect(r.ok === false && r.backupLocation).toBeUndefined();
      expect(calls).toContain('discard:' + STAGING);
      expect(calls.some((c) => /^(import|rename|remove|beforeSwap)/.test(c))).toBe(false);
      expect([...names].sort()).toEqual(['A', 'B']);
    },
  );

  it('가져오기 실패 → 기존 무변경으로 중단, 임시 백업 위치는 알려 줌', async () => {
    const { deps, calls, names } = makeDeps({ fail: { import: true } });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({ ok: false, stage: 'import' });
    expect(r.ok === false && r.backupLocation).toMatch('before-overwrite');
    expect(calls.some((c) => /^(rename|remove|beforeSwap)/.test(c))).toBe(false);
    expect(calls).not.toContain('discard:' + STAGING);
    expect([...names].sort()).toEqual(['A', 'B']);
  });

  it('가져오는 동안 다른 창이 열었으면 이름변경 전에 중단(임시 프로젝트는 남김)', async () => {
    const { deps, calls, names } = makeDeps({ lockedAt: [2] });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({ ok: false, stage: 'trash-rename', tempName: TEMP });
    expect(calls.some((c) => /^(rename|remove)/.test(c))).toBe(false);
    expect(names.has('A')).toBe(true);
    expect(names.has(TEMP)).toBe(true);
  });

  it('휴지통용 이름변경이 조용히 반영되지 않으면 삭제하지 않고 중단', async () => {
    const { deps, calls, names } = makeDeps({ silent: { rename1: true } });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({ ok: false, stage: 'trash-rename' });
    expect(calls.some((c) => c.startsWith('remove'))).toBe(false);
    expect(names.has('A')).toBe(true);
  });

  it('삭제(휴지통 이관)가 반영되지 않으면 원래 이름 복원을 하지 않고 중단', async () => {
    const { deps, calls, names } = makeDeps({ silent: { remove: true } });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({
      ok: false,
      stage: 'trash',
      tempName: TEMP,
      trashName: TRASH,
    });
    expect(calls).not.toContain('rename:' + TEMP + '->A');
    expect(names.has(TRASH)).toBe(true);
    expect(names.has(TEMP)).toBe(true);
  });

  it('삭제 예외도 같은 중단', async () => {
    const { deps } = makeDeps({ fail: { remove: true } });
    expect(await runProjectOverwrite('A', NOW, deps)).toMatchObject({
      ok: false,
      stage: 'trash',
    });
  });

  it('원래 이름 복원 실패 → 임시 이름·휴지통 이름을 알려 주고 중단', async () => {
    const { deps } = makeDeps({ fail: { rename2: true } });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({
      ok: false,
      stage: 'restore-name',
      tempName: TEMP,
      trashName: TRASH,
    });
    expect(overwriteFailureText(r as any)).toContain(TEMP);
  });

  it('휴지통·목록에 같은 휴지통 이름이 있으면 (2) 접미', async () => {
    const { deps } = makeDeps({ trashed: [TRASH] });
    const r = await runProjectOverwrite('A', NOW, deps);
    expect(r).toMatchObject({ ok: true, trashName: TRASH + ' (2)' });
  });

  it('원래 폴더로 못 옮기면 성공 + 폴더 안내', async () => {
    const { deps } = makeDeps({ folders: { A: 'F' }, silent: { move: true } });
    expect(await runProjectOverwrite('A', NOW, deps)).toMatchObject({
      ok: true,
      folderRestoreFailed: 'F',
    });
    const gone = makeDeps({ folders: { A: 'G' } });
    expect(await runProjectOverwrite('A', NOW, gone.deps)).toMatchObject({
      ok: true,
      folderRestoreFailed: 'G',
    });
  });

  it('실패 안내에는 제목·임시 백업 위치·사유', () => {
    const text = overwriteFailureText({
      ok: false,
      stage: 'import',
      reason: 'x',
      backupLocation: 'D:/b.tar',
    });
    expect(text.split('\n')).toEqual([
      PROJECT_IMPORT_TEXT.failedTitle,
      PROJECT_IMPORT_TEXT.failed.import,
      '임시 백업 파일: D:/b.tar',
      '(x)',
    ]);
  });
});

describe('saveExportSilently (대화상자 없는 임시 백업 저장)', () => {
  it('드라이브 폴더가 있으면 그 폴더(같은 이름은 (1) 접미) + 존재 확인', async () => {
    backend.getConfig.mockResolvedValue({ syncFolder: 'D:\\Drive\\' });
    // x.tar=있음, x (1).tar=없음 → x (1).tar 로 저장 → 저장 후 확인=있음
    let checkedFinal = false;
    backend.existFileAbsolute.mockImplementation(async (p: string) => {
      if (p === 'D:\\Drive/x.tar') return true;
      if (p === 'D:\\Drive/x (1).tar') return checkedFinal;
      return false;
    });
    backend.copyFileToAbsolute.mockImplementation(async () => {
      checkedFinal = true;
      return 'copied';
    });
    backend.deleteFile.mockResolvedValue(undefined);
    await expect(saveExportSilently('exports/x.tar')).resolves.toBe(
      'D:\\Drive/x (1).tar',
    );
    expect(backend.saveExportToDownloads).not.toHaveBeenCalled();
    expect(backend.deleteFile).toHaveBeenCalledWith('exports/x.tar');
  });

  it('드라이브 복사 실패 → 다운로드 폴더(대화상자 없음)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    backend.getConfig.mockResolvedValue({ syncFolder: 'D:/Drive' });
    backend.existFileAbsolute.mockResolvedValue(false);
    backend.copyFileToAbsolute.mockRejectedValue(new Error('권한'));
    backend.saveExportToDownloads.mockResolvedValue('C:/Users/u/Downloads/x.tar');
    await expect(saveExportSilently('exports/x.tar')).resolves.toBe(
      'C:/Users/u/Downloads/x.tar',
    );
  });

  it('폴더 미설정·모바일 → 다운로드 폴더, 실패는 throw', async () => {
    platform.supportsTargetFolder = false;
    backend.saveExportToDownloads.mockResolvedValue('Download/x.tar');
    await expect(saveExportSilently('exports/x.tar')).resolves.toBe('Download/x.tar');
    expect(backend.getConfig).not.toHaveBeenCalled();
    backend.saveExportToDownloads.mockRejectedValue(new Error('저장 공간 부족'));
    await expect(saveExportSilently('exports/x.tar')).rejects.toThrow('저장 공간 부족');
  });
});
