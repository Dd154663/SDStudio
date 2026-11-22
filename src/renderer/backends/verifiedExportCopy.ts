// [Android] 내보내기 산출물(exports/…)을 기기 「Download/」 로 옮길 때의 확인 절차(2026-11-22 백업 견고성 P1).
//
// Android 의 옮기기는 이동이 아니라 「복사 → 원본 삭제」다. Capacitor Filesystem.copy 는 내부에서
// FileChannel.transferFrom 을 한 번만 부르고 쓴 바이트 수를 보지 않으므로, 저장 공간이 모자라 잘린
// 사본이 생겨도 오류 없이 끝날 수 있다(기기 확인 전 추측). 그래서 확인 여부와 무관하게:
//   ① 옮기기 전 여유 공간이 원본 크기보다 작으면 복사하지 않는다(원본 그대로).
//   ② 복사 뒤 사본의 크기(폴더면 파일 수 + 전체 바이트)를 원본과 비교한다.
//   ③ 같을 때만 원본을 지운다. 다르거나 잴 수 없으면 원본은 지우지 않고, 잘린 사본은 지울 수
//      있으면 지운 뒤 ExportTransferError 를 던진다.
// 사본은 Download/ 아래 「지금 비어 있음을 확인한 새 이름」이라 지워도 사용자 파일을 건드리지 않는다.
// 파일 시스템 호출은 주입받는다(이 파일은 Capacitor 를 모름 — jest 로 분기 검증).

export interface TreeSize {
  bytes: number;
  files: number;
}

export interface VerifiedCopyOps {
  // 원본·사본의 크기. 폴더면 하위 전체(파일 수 + 바이트 합).
  measureSource(): Promise<TreeSize>;
  measureDest(): Promise<TreeSize>;
  copy(): Promise<void>;
  removeDest(): Promise<void>;
  removeSource(): Promise<void>;
  // 대상 볼륨의 여유 공간(bytes). 모르면 null(사전 확인을 건너뛴다).
  freeSpace(): Promise<number | null>;
}

export type ExportTransferFailure =
  | 'no-space' // 사전 확인: 여유 공간 < 원본 크기 (복사하지 않음)
  | 'copy-failed' // 복사 자체가 오류로 끝남
  | 'size-mismatch' // 복사는 끝났지만 사본 크기가 다름(잘림 의심)
  | 'unverifiable'; // 원본 또는 사본의 크기를 잴 수 없음

export const EXPORT_TRANSFER_TEXT = {
  // 앱 안 내보내기 폴더(사용자에게 보이는 경로). APP_DIR = Documents/.SDStudio
  appExportsDir: 'Documents/.SDStudio/exports',
  head: '다운로드 폴더에 저장하지 못했습니다',
  reason: {
    'no-space': (need: string, free: string) =>
      `저장 공간이 부족합니다(필요 약 ${need}, 남은 공간 약 ${free}).`,
    'copy-failed': (detail: string) =>
      `복사 중 오류가 났습니다(저장 공간이 부족할 수 있습니다)${detail ? `: ${detail}` : '.'}`,
    'size-mismatch': '복사된 파일의 크기가 원본과 달라 지웠습니다(저장 공간이 부족할 수 있습니다).',
    unverifiable: '복사한 파일의 크기를 확인할 수 없어 저장을 멈췄습니다(저장 공간이 부족할 수 있습니다).',
  },
  kept: (dir: string, name: string) =>
    `백업 파일은 앱 폴더(${dir})에 그대로 남아 있습니다: ${name}`,
  // 지금 앱에는 exports/ 의 파일을 다시 꺼내는 메뉴가 없다 — 할 수 있는 일만 적는다.
  nextSteps:
    '저장 공간을 비운 뒤 다시 내보내 주세요. 파일 관리자 앱에서 숨김 파일 보기를 켜면 남은 파일을 직접 옮길 수도 있습니다.\n' +
    '남은 파일이 필요 없으면 환경설정 → 시스템의 「exports 폴더 정리」에서 지울 수 있습니다.',
};

export function formatTransferBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 실패 알림 문구(머리 + 사유 + 남은 파일 + 다음에 할 일).
export function exportTransferFailureText(opts: {
  kind: ExportTransferFailure;
  fileName: string;
  needBytes?: number;
  freeBytes?: number;
  detail?: string;
  // true = 머리 + 사유만(원본을 호출부가 따로 정리하는 조용한 저장 경로용).
  brief?: boolean;
}): string {
  const T = EXPORT_TRANSFER_TEXT;
  let reason: string;
  if (opts.kind === 'no-space') {
    reason = T.reason['no-space'](
      formatTransferBytes(opts.needBytes ?? -1),
      formatTransferBytes(opts.freeBytes ?? -1),
    );
  } else if (opts.kind === 'copy-failed') {
    reason = T.reason['copy-failed'](opts.detail || '');
  } else {
    reason = T.reason[opts.kind];
  }
  if (opts.brief) return `${T.head}. ${reason}`;
  return `${T.head}.\n${reason}\n${T.kept(T.appExportsDir, opts.fileName)}\n${T.nextSteps}`;
}

export class ExportTransferError extends Error {
  readonly kind: ExportTransferFailure;
  // 사용자에게 이미 알렸는지(publishExport 는 스스로 창을 띄운 뒤 던진다 — 호출부 중복 안내 방지)
  notified = false;
  constructor(kind: ExportTransferFailure, message: string) {
    super(message);
    this.name = 'ExportTransferError';
    this.kind = kind;
  }
}

export function isNotifiedExportTransferError(e: unknown): boolean {
  return e instanceof ExportTransferError && e.notified;
}

function sameSize(a: TreeSize, b: TreeSize): boolean {
  return a.bytes === b.bytes && a.files === b.files;
}

// 복사 → 크기 확인 → (같을 때만) 원본 삭제. 반환 cleanupFailed = 저장은 됐지만 원본 정리 실패.
// 실패는 ExportTransferError(원본은 항상 그대로).
export async function copyVerifiedThenRemoveSource(
  fileName: string,
  ops: VerifiedCopyOps,
  textOpts: { brief?: boolean } = {},
): Promise<{ cleanupFailed: boolean; size: TreeSize }> {
  const fail = (
    kind: ExportTransferFailure,
    extra: { needBytes?: number; freeBytes?: number; detail?: string } = {},
  ) =>
    new ExportTransferError(
      kind,
      exportTransferFailureText({ kind, fileName, ...extra, brief: textOpts.brief }),
    );

  let src: TreeSize;
  try {
    src = await ops.measureSource();
  } catch (e) {
    // 원본 크기를 모르면 사본을 확인할 수 없다 — 복사하지 않는다.
    throw fail('unverifiable');
  }

  let free: number | null = null;
  try {
    free = await ops.freeSpace();
  } catch (e) {
    free = null;
  }
  if (typeof free === 'number' && Number.isFinite(free) && free >= 0 && free < src.bytes) {
    throw fail('no-space', { needBytes: src.bytes, freeBytes: free });
  }

  const dropDest = async () => {
    try {
      await ops.removeDest();
    } catch (e) {}
  };

  try {
    await ops.copy();
  } catch (e: any) {
    await dropDest();
    throw fail('copy-failed', { detail: e?.message ? String(e.message) : '' });
  }

  let dst: TreeSize | null = null;
  try {
    dst = await ops.measureDest();
  } catch (e) {
    dst = null;
  }
  if (!dst) {
    await dropDest();
    throw fail('unverifiable');
  }
  if (!sameSize(src, dst)) {
    await dropDest();
    throw fail('size-mismatch');
  }

  let cleanupFailed = false;
  try {
    await ops.removeSource();
  } catch (e) {
    cleanupFailed = true;
  }
  return { cleanupFailed, size: src };
}
