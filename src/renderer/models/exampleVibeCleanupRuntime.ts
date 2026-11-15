// 잔존 예제 프리셋 이미지 정리 — 실제 backend·세션 연결(순수 판정은 exampleVibeCleanup.ts).
// 검사 = 목록·읽기만(쓰기 없음). 정리 = 사용자 확인 뒤 미참조 항목만, PC OS 휴지통 / Android 영구 삭제.
// 퀵 생성 전용 프로젝트의 이지 모드 예제 프리셋은 프리셋 항목을 먼저 지우고(세션 메모리 → 기존 자동 저장 경로) 파일을 지운다.
// 되돌리기 기록 없음(OS 휴지통·영구 삭제 — 구 저장소 잔재 정리와 같은 범주, 숨김 프로젝트의 정리 도구).
import { backend, isMobile, sessionService, templateService } from '.';
import { appState } from './AppService';
import {
  collectProjectVibeRefs,
  deleteExampleVibes,
  EASY_PRESET_TYPE,
  normalizeVibeFileName,
  scanExampleVibes,
} from './exampleVibeCleanup';
import type {
  ExampleVibeItem,
  ExampleVibeScanDeps,
  ExampleVibeScanResult,
} from './exampleVibeCleanup';
import type { Session } from './types';

function loadedSession(name: string): Session | undefined {
  const cur = appState.curSession;
  if (cur && cur.name === name) return cur;
  return sessionService.getLoaded(name);
}

function runtimeScanDeps(): ExampleVibeScanDeps {
  return {
    listProjects: () => [...sessionService.list()],
    // 현재 열린 프로젝트는 appState.curSession(메모리), 그 밖에 로드된 세션도 메모리 기준(+디스크 합집합)
    loadedProject: (name) => loadedSession(name),
    readProjectJson: (name) => backend.readFile(sessionService.getPath(name)),
    listFilesWithStats: (dir) => backend.listFilesWithStats(dir),
    readDataFile: (path) => backend.readDataFile(path),
    quickGenProjectName: () => templateService.quickGenName,
  };
}

export async function scanExampleVibesNow(): Promise<ExampleVibeScanResult> {
  await templateService.ensureLoaded(); // quickGenName 은 사이드카를 읽은 뒤에만 정확
  return scanExampleVibes(runtimeScanDeps());
}

// 이지 모드 프리셋 항목 제거: 세션을 올려(열린 세션이면 그 객체) 같은 이름의 SDImageGenEasy 프리셋이
// 모두 이 파일을 profile 로 가리킬 때만 removePreset. 저장은 ResourceSyncService.watch 의 자동 저장.
async function removeEasyPreset(project: string, presetName: string, fileName: string): Promise<void> {
  const session = loadedSession(project) ?? (await sessionService.get(project));
  if (!session) throw new Error('세션을 불러오지 못함: ' + project);
  const list: any[] = session.presets.get(EASY_PRESET_TYPE) ?? [];
  const same = list.filter((p) => p?.name === presetName);
  if (same.length === 0) return; // 이미 없음(다른 경로로 지워짐) — 파일 정리는 계속
  if (!same.every((p) => typeof p.profile === 'string' && normalizeVibeFileName(p.profile) === fileName)) {
    throw new Error('같은 이름의 다른 프리셋이 있어 제거하지 않음: ' + presetName);
  }
  session.removePreset(EASY_PRESET_TYPE, presetName);
  // 지연 반응 저장에 기대지 않고 즉시 디스크에 반영(기존 단일 저장 지점 writeResource 경유). 저장소 불안정으로
  // 실패하면 throw → 호출부가 이 항목을 실패로 세고 파일은 지우지 않는다(프리셋만 남고 파일이 사라지는 상태 방지).
  await sessionService.flushProjectNow(project);
}

export async function deleteExampleVibesNow(
  items: readonly ExampleVibeItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ deleted: number; failed: string[]; presetsRemoved: number }> {
  await templateService.ensureLoaded();
  const scanDeps = runtimeScanDeps();
  return deleteExampleVibes(
    items,
    {
      isMobile,
      trashFile: (p) => backend.trashFile(p),
      deleteFile: (p) => backend.deleteFile(p),
      collectRefs: (project) => collectProjectVibeRefs(scanDeps, project),
      quickGenProjectName: () => templateService.quickGenName,
      removeEasyPreset,
    },
    onProgress,
  );
}
