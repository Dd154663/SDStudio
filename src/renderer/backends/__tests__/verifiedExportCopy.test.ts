// [Android] 내보내기 옮기기의 크기 확인(2026-11-22 백업 견고성 P1) — 파일 시스템은 모킹.
import {
  copyVerifiedThenRemoveSource,
  exportTransferFailureText,
  ExportTransferError,
  EXPORT_TRANSFER_TEXT,
  isNotifiedExportTransferError,
  type VerifiedCopyOps,
} from '../verifiedExportCopy';

const makeOps = (over: Partial<VerifiedCopyOps> = {}) => {
  const calls: string[] = [];
  const ops: VerifiedCopyOps = {
    measureSource: jest.fn(async () => ({ bytes: 1000, files: 1 })),
    measureDest: jest.fn(async () => ({ bytes: 1000, files: 1 })),
    copy: jest.fn(async () => {
      calls.push('copy');
    }),
    removeDest: jest.fn(async () => {
      calls.push('removeDest');
    }),
    removeSource: jest.fn(async () => {
      calls.push('removeSource');
    }),
    freeSpace: jest.fn(async () => 10_000),
    ...over,
  };
  return { ops, calls };
};

const failKind = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExportTransferError);
    return (e as ExportTransferError).kind;
  }
  throw new Error('던지지 않음');
};

describe('copyVerifiedThenRemoveSource', () => {
  test('크기가 같으면 원본을 지운다(사본은 남김)', async () => {
    const { ops, calls } = makeOps();
    const r = await copyVerifiedThenRemoveSource('a.tar', ops);
    expect(calls).toEqual(['copy', 'removeSource']);
    expect(r.cleanupFailed).toBe(false);
  });

  test('폴더: 파일 수·바이트가 모두 같아야 같음', async () => {
    const { ops, calls } = makeOps({
      measureSource: jest.fn(async () => ({ bytes: 30, files: 3 })),
      measureDest: jest.fn(async () => ({ bytes: 30, files: 2 })),
    });
    expect(await failKind(copyVerifiedThenRemoveSource('d', ops))).toBe('size-mismatch');
    expect(calls).toEqual(['copy', 'removeDest']);
  });

  test('사본이 작으면(잘림) 원본 보존·사본 삭제·size-mismatch', async () => {
    const { ops, calls } = makeOps({ measureDest: jest.fn(async () => ({ bytes: 400, files: 1 })) });
    expect(await failKind(copyVerifiedThenRemoveSource('a.tar', ops))).toBe('size-mismatch');
    expect(calls).toEqual(['copy', 'removeDest']);
    expect(ops.removeSource).not.toHaveBeenCalled();
  });

  test('사본 크기를 잴 수 없으면 원본 보존·사본 삭제 시도·unverifiable', async () => {
    const { ops } = makeOps({
      measureDest: jest.fn(async () => {
        throw new Error('stat 실패');
      }),
      removeDest: jest.fn(async () => {
        throw new Error('지우기도 실패');
      }),
    });
    expect(await failKind(copyVerifiedThenRemoveSource('a.tar', ops))).toBe('unverifiable');
    expect(ops.removeDest).toHaveBeenCalled();
    expect(ops.removeSource).not.toHaveBeenCalled();
  });

  test('원본 크기를 잴 수 없으면 복사도 하지 않음', async () => {
    const { ops, calls } = makeOps({
      measureSource: jest.fn(async () => {
        throw new Error('x');
      }),
    });
    expect(await failKind(copyVerifiedThenRemoveSource('a.tar', ops))).toBe('unverifiable');
    expect(calls).toEqual([]);
  });

  test('복사 오류 = 원본 보존·사본 정리·copy-failed(사유 포함)', async () => {
    const { ops, calls } = makeOps({
      copy: jest.fn(async () => {
        throw new Error('ENOSPC');
      }),
    });
    try {
      await copyVerifiedThenRemoveSource('a.tar', ops);
      throw new Error('던지지 않음');
    } catch (e: any) {
      expect(e.kind).toBe('copy-failed');
      expect(e.message).toContain('ENOSPC');
    }
    expect(calls).toEqual(['removeDest']);
    expect(ops.removeSource).not.toHaveBeenCalled();
  });

  test('여유 공간 < 원본 크기 = 복사하지 않고 no-space', async () => {
    const { ops, calls } = makeOps({ freeSpace: jest.fn(async () => 999) });
    expect(await failKind(copyVerifiedThenRemoveSource('a.tar', ops))).toBe('no-space');
    expect(calls).toEqual([]);
  });

  test('여유 공간을 모르면(null·오류) 사전 확인만 건너뛰고 진행', async () => {
    const a = makeOps({ freeSpace: jest.fn(async () => null) });
    await copyVerifiedThenRemoveSource('a.tar', a.ops);
    expect(a.calls).toEqual(['copy', 'removeSource']);
    const b = makeOps({
      freeSpace: jest.fn(async () => {
        throw new Error('x');
      }),
    });
    await copyVerifiedThenRemoveSource('a.tar', b.ops);
    expect(b.calls).toEqual(['copy', 'removeSource']);
  });

  test('원본 정리 실패는 저장 성공을 뒤집지 않음(cleanupFailed)', async () => {
    const { ops } = makeOps({
      removeSource: jest.fn(async () => {
        throw new Error('x');
      }),
    });
    const r = await copyVerifiedThenRemoveSource('a.tar', ops);
    expect(r.cleanupFailed).toBe(true);
  });
});

describe('실패 문구', () => {
  test('전체 문구 = 머리·사유·남은 파일 위치·다음에 할 일', () => {
    const t = exportTransferFailureText({ kind: 'no-space', fileName: 'b.tar', needBytes: 2 * 1024 ** 3, freeBytes: 1024 ** 3 });
    expect(t).toContain(EXPORT_TRANSFER_TEXT.head);
    expect(t).toContain('필요 약 2.00 GB, 남은 공간 약 1.00 GB');
    expect(t).toContain('Documents/.SDStudio/exports');
    expect(t).toContain('b.tar');
    expect(t).toContain('exports 폴더 정리');
  });

  test('brief = 남은 파일 안내 없음(호출부가 원본을 따로 정리하는 경로)', () => {
    const t = exportTransferFailureText({ kind: 'size-mismatch', fileName: 'b.tar', brief: true });
    expect(t).toContain(EXPORT_TRANSFER_TEXT.head);
    expect(t).not.toContain('Documents/.SDStudio/exports');
  });

  test('notified 표시', () => {
    const e = new ExportTransferError('unverifiable', 'm');
    expect(isNotifiedExportTransferError(e)).toBe(false);
    e.notified = true;
    expect(isNotifiedExportTransferError(e)).toBe(true);
    expect(isNotifiedExportTransferError(new Error('x'))).toBe(false);
  });
});
