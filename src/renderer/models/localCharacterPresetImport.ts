// 프로젝트 로컬 캐릭터 프리셋 파일 불러오기 — 이름이 같은 항목 처리(2026-11-16 M5 묶음 b R1-b)
//
// 종전에는 CharacterPresetEditor 안에서 묻지 않고 「X (2)」(numberedName)로 조용히 바꿨다. 이제 다른 불러오기
// (글로벌 캐릭터·씬 템플릿·글로벌 프리셋·템플릿·작가)와 같이 공용 흐름(importFlow.askImportPolicyWithConfirm)으로
// 정책을 묻는다 — 겹치는 이름이 없으면 묻지 않는다. 선택지 의미는 글로벌 캐릭터(GlobalCharacterPresetService
// .importFromFileData)와 같다:
//   - rename   : 새 이름으로 추가 — 「X (2)」 (numberedName, 종전 동작)
//   - skip     : 불러오기 시작 때 이미 있던 이름은 추가하지 않음(이미지도 쓰지 않음)
//   - overwrite: 같은 이름 프리셋의 내용을 자리에서 교체(이름·목록 순서 유지 — 적용 태그가 이어진다).
//                기존 한 항목은 한 번만 덮어쓰고, 파일 안 같은 이름이 또 나오면 새 이름으로 추가.
// 충돌 판정 기준은 시작 시점의 기존 목록이다(파일 안 같은 이름끼리는 충돌 아님 — 뒤의 것은 새 이름).
//
// 파일 형식(ExportedPresetData v1)·이미지 저장 규칙(원래 파일명 그대로, 안전하지 않은 이름만 새 이름 —
// 2026-10-03 X15b)은 종전 그대로. 덮어쓰기로 더 이상 참조되지 않는 기존 바이브·레퍼런스 파일은 지우지 않는다
// (로컬 프리셋 삭제와 같은 수준 — 파일 정리는 하지 않음).
//
// 서비스 의존 없음(jest 로 직접 검증 — __tests__/localCharacterPresetImport.test.ts). 프로젝트·파일 쓰기는 target 으로 주입.

import { v4 } from 'uuid';
import { imageFileExt, imageTokenBase, isSafeImageToken } from './projectTemplateBackup';
import { safeImportedImageName } from './deleteFlowRules';
import { numberedName } from './nameInput';
import type { ImportPolicy, ImportSummary } from './importFlow';

export interface LocalCharacterImportTarget {
  /** 지금 프로젝트에 그 이름의 캐릭터 프리셋이 있는가(불러오는 중 추가된 것 포함) */
  has(name: string): boolean;
  /** 새 프리셋 추가 — json.name 은 이미 확정된 이름 */
  add(json: any): void;
  /** 같은 이름 프리셋의 내용을 자리에서 교체 — json.name === name */
  replace(name: string, json: any): void;
  writeVibe(fileName: string, data: string): Promise<void>;
  writeReference(fileName: string, data: string): Promise<void>;
  /** 안전하지 않은 이미지 이름 대신 쓸 새 이름(테스트 주입용, 기본 = uuid + 원래 확장자) */
  newImageName?: (orig: unknown) => string;
}

export function isLocalCharacterPresetFile(data: any): boolean {
  return !!data && Array.isArray(data.presets);
}

function entryName(raw: any): string {
  return typeof raw?.name === 'string' ? raw.name : '';
}

/** 파일 안 항목 중 지금 프로젝트의 캐릭터 프리셋과 이름이 같은 개수(정책 선택용) */
export function countLocalCharacterPresetConflicts(
  data: any,
  has: (name: string) => boolean,
): number {
  if (!isLocalCharacterPresetFile(data)) return 0;
  let n = 0;
  for (const raw of data.presets) {
    if (raw && typeof raw === 'object' && has(entryName(raw))) n++;
  }
  return n;
}

/**
 * 파일 데이터 → 프로젝트 로컬 캐릭터 프리셋. 형식이 아니면 throw. 항목 단위 파손(객체 아님)은 건너뛴다.
 * 이미지 쓰기 실패는 종전처럼 조용히 넘어간다(프리셋은 들어간다).
 */
export async function applyLocalCharacterPresetImport(
  data: any,
  policy: ImportPolicy,
  target: LocalCharacterImportTarget,
): Promise<ImportSummary> {
  if (!isLocalCharacterPresetFile(data)) {
    throw new Error('올바른 캐릭터 프리셋 파일이 아닙니다');
  }
  const newImageName =
    target.newImageName ?? ((orig: unknown) => v4() + '.' + imageFileExt(imageTokenBase(orig)));
  // 충돌 판정 기준 = 시작 시점의 기존 이름
  const existingAtStart = new Set<string>();
  for (const raw of data.presets) {
    const n = entryName(raw);
    if (raw && typeof raw === 'object' && target.has(n)) existingAtStart.add(n);
  }
  const overwritten = new Set<string>();
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of data.presets) {
    if (!raw || typeof raw !== 'object') continue;
    const fileName = entryName(raw);
    const conflict = existingAtStart.has(fileName);
    if (conflict && policy === 'skip') {
      skipped++;
      continue;
    }
    const overwriteName =
      conflict && policy === 'overwrite' && !overwritten.has(fileName) && target.has(fileName)
        ? fileName
        : undefined;

    const presetJson: any = { ...raw };
    const renamedVibes = new Map<string, string>();
    const renamedRefs = new Map<string, string>();
    const remapRef = (path: unknown, map: Map<string, string>) => {
      if (typeof path !== 'string') return path;
      return map.get(path) ?? map.get(imageTokenBase(path)) ?? path;
    };

    // 바이브 이미지 복원 (원래 파일명으로 직접 저장 — 안전하지 않은 이름만 새 이름)
    if (Array.isArray(presetJson.vibeImages)) {
      for (const img of presetJson.vibeImages) {
        const safe = safeImportedImageName(img?.filename, isSafeImageToken, () =>
          newImageName(img?.filename),
        );
        if (safe.renamed && typeof img?.filename === 'string') {
          renamedVibes.set(img.filename, safe.name);
        }
        try {
          await target.writeVibe(safe.name, img.data);
        } catch (e) {}
      }
    }

    // 레퍼런스 이미지 복원
    if (Array.isArray(presetJson.referenceImages)) {
      for (const img of presetJson.referenceImages) {
        const safe = safeImportedImageName(img?.filename, isSafeImageToken, () =>
          newImageName(img?.filename),
        );
        if (safe.renamed && typeof img?.filename === 'string') {
          renamedRefs.set(img.filename, safe.name);
        }
        try {
          await target.writeReference(safe.name, img.data);
        } catch (e) {}
      }
    }

    // 대표 이미지 복원
    if (presetJson.representativeImageData && presetJson.representativeImage) {
      const safe = safeImportedImageName(presetJson.representativeImage, isSafeImageToken, () =>
        newImageName(presetJson.representativeImage),
      );
      if (safe.renamed) {
        renamedVibes.set(String(presetJson.representativeImage), safe.name);
        presetJson.representativeImage = safe.name;
      }
      try {
        await target.writeVibe(safe.name, presetJson.representativeImageData);
      } catch (e) {}
    }

    // 새 이름으로 저장한 이미지의 참조를 맞춘다(바이브·레퍼런스 경로)
    if (renamedVibes.size > 0 && Array.isArray(presetJson.vibes)) {
      presetJson.vibes = presetJson.vibes.map((v: any) =>
        v && typeof v === 'object' ? { ...v, path: remapRef(v.path, renamedVibes) } : v,
      );
    }
    if (renamedRefs.size > 0 && Array.isArray(presetJson.characterReferences)) {
      presetJson.characterReferences = presetJson.characterReferences.map((r: any) =>
        r && typeof r === 'object' ? { ...r, path: remapRef(r.path, renamedRefs) } : r,
      );
    }

    // 임시 필드 제거
    delete presetJson.vibeImages;
    delete presetJson.referenceImages;
    delete presetJson.representativeImageData;

    if (overwriteName !== undefined) {
      presetJson.name = overwriteName;
      target.replace(overwriteName, presetJson);
      overwritten.add(overwriteName);
      updated++;
      continue;
    }
    // 새 이름으로 추가 — 「X」→「X (2)」(numberedName, 2026-11-14 M2 I4)
    presetJson.name = numberedName(fileName, (n) => target.has(n));
    target.add(presetJson);
    added++;
  }
  return { added, updated, skipped };
}
