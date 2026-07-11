// 트랙1 B4 — 구 저장소(7루트) 고아 잔재 스캔·정리.
//
// 마이그레이션(workspace 활성) 후 구 루트에 남는 것들:
//   · json 없는 고아 이미지 폴더 — 스펙 §3-4에서 의도적으로 이동하지 않음
//   · 잔여 파일(고아 .bak 등)·빈 폴더 껍데기
//
// 안전 원칙 (project_data_root_guard·스펙 §6-3):
//   · workspace 활성 + 구 projects/ 에 json/.deleted 잔존 0 일 때만 정리 허용
//     — json 잔존 = 미이동(실패/롤백 중 생성) 프로젝트로, 부팅 증분 마이그레이션의
//     대상이지 고아가 아니다. 하나라도 있으면 전체 정리를 차단한다.
//   · 삭제 단위는 구 루트 "직하 1단 항목"만. 루트 자체는 dataPathGuard 가 보호
//     (단일 세그먼트 삭제 거부) — 빈 루트 껍데기는 남긴다.
//   · PC 는 OS 휴지통 이동(trashFile, 복구 가능) 우선, 실패 시에만 직접 삭제.
//     Android 는 휴지통이 없어 영구 삭제(deleteDir 는 가드 경유).

import { backend, isMobile } from '.';
import { FileStatEntry } from '../backend';
import { isWorkspaceLayout } from './storageLayout';
import { PROJECT_DATA_ROOTS, PROJECT_JSON_ROOT } from './projectPaths';

export interface LegacyRemnant {
  path: string; // 데이터 루트 상대 경로 (루트/이름, 2세그먼트)
  isDir: boolean;
  size: number; // 재귀 합산 bytes
  files: number; // 재귀 파일 수 (0 = 빈 폴더)
}

export interface LegacyScanResult {
  remnants: LegacyRemnant[];
  totalSize: number;
  totalFiles: number;
  // 정리 불가 사유 (null = 정리 가능). 미이동 프로젝트 잔존 등.
  blocked: string | null;
}

// 디렉터리 목록에서 파일/하위 디렉터리를 구분해 읽는다.
// (listFiles = 전체 이름, listFilesWithStats = 파일만 — 차집합이 디렉터리)
async function listSplit(
  rel: string,
): Promise<{ files: FileStatEntry[]; dirs: string[] } | null> {
  try {
    const names = await backend.listFiles(rel);
    const stats = await backend.listFilesWithStats(rel);
    const fileSet = new Set(stats.map((s) => s.name));
    return {
      files: stats,
      dirs: names.filter((n) => !fileSet.has(n)),
    };
  } catch (e) {
    return null; // 폴더 없음
  }
}

// 디렉터리 재귀 용량·파일 수 합산.
async function measureDir(
  rel: string,
): Promise<{ size: number; files: number }> {
  const split = await listSplit(rel);
  if (!split) return { size: 0, files: 0 };
  let size = 0;
  let files = 0;
  for (const f of split.files) {
    size += f.size;
    files++;
  }
  for (const d of split.dirs) {
    const sub = await measureDir(rel + '/' + d);
    size += sub.size;
    files += sub.files;
  }
  return { size, files };
}

// projects/ 재귀에서 미이동 프로젝트 json(.json/.deleted) 존재 여부.
async function hasResidualProjectJson(rel: string): Promise<boolean> {
  const split = await listSplit(rel);
  if (!split) return false;
  for (const f of split.files) {
    if (f.name.endsWith('.json') || f.name.endsWith('.deleted')) return true;
  }
  for (const d of split.dirs) {
    if (await hasResidualProjectJson(rel + '/' + d)) return true;
  }
  return false;
}

export async function scanLegacyRemnants(): Promise<LegacyScanResult> {
  if (!isWorkspaceLayout()) {
    return {
      remnants: [],
      totalSize: 0,
      totalFiles: 0,
      blocked: '구 저장소 구조 사용 중입니다. 마이그레이션 완료 후 사용할 수 있습니다.',
    };
  }
  if (await hasResidualProjectJson(PROJECT_JSON_ROOT)) {
    return {
      remnants: [],
      totalSize: 0,
      totalFiles: 0,
      blocked:
        '아직 이동되지 않은 프로젝트가 있어 정리할 수 없습니다. 프로그램을 다시 시작하면 남은 이동이 자동으로 재개됩니다.',
    };
  }
  const remnants: LegacyRemnant[] = [];
  for (const root of PROJECT_DATA_ROOTS) {
    const split = await listSplit(root);
    if (!split) continue;
    for (const f of split.files) {
      remnants.push({
        path: root + '/' + f.name,
        isDir: false,
        size: f.size,
        files: 1,
      });
    }
    for (const d of split.dirs) {
      const m = await measureDir(root + '/' + d);
      remnants.push({
        path: root + '/' + d,
        isDir: true,
        size: m.size,
        files: m.files,
      });
    }
  }
  return {
    remnants,
    totalSize: remnants.reduce((s, r) => s + r.size, 0),
    totalFiles: remnants.reduce((s, r) => s + r.files, 0),
    blocked: null,
  };
}

// 잔재 삭제. PC = OS 휴지통 우선(디렉터리 포함 shell.trashItem), 실패 시 직접
// 삭제 폴백. Android = 영구 삭제(deleteDir 는 dataPathGuard 경유 — 2세그먼트라 통과).
export async function deleteLegacyRemnants(
  remnants: LegacyRemnant[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];
  for (let i = 0; i < remnants.length; i++) {
    const r = remnants[i];
    try {
      let trashed = false;
      if (!isMobile) {
        try {
          await backend.trashFile(r.path);
          trashed = true;
        } catch (e) {}
      }
      if (!trashed) {
        if (r.isDir) await backend.deleteDir(r.path);
        else await backend.deleteFile(r.path);
      }
      deleted++;
    } catch (e) {
      failed.push(r.path);
    }
    onProgress?.(i + 1, remnants.length);
  }
  return { deleted, failed };
}
