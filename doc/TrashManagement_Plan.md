# Project Data Trash Management Plan

> **목표**: 프로젝트 삭제 시 `outs/` 등 데이터 디렉토리를 `outs/.trash/`로 이동하고, 사이드바에 휴지통 관리 버튼 추가  
> **기존 상황**: `moveProjectToTrash()`는 trash.json에 타임스탬프만 기록. 디렉토리는 방치됨.  
> **충돌 안전성**: `.trash/` 이동은 동명 프로젝트 재생성 시 이름 충돌을 방지하므로 기존 설계보다 개선됨.

---

## Changes

### 1. TrashService.ts

| Method | Change |
|---|---|
| `moveProjectToTrash()` | 디렉토리 이동 추가: `outs/<name>/` → `outs/.trash/<name>/` 등 5개 디렉토리 |
| `restoreProject()` | 복원 시 `.trash/<name>/` → 원위치 |
| `permanentlyDeleteProject()` | `.trash/<name>/` 도 함께 삭제 |
| `getTrashedProjectsWithSize()` (신규) | 휴지통 내 프로젝트 목록 + 용량 반환 |
| `emptyProjectTrashDirs(name)` (신규) | 특정 프로젝트 휴지통 디렉토리 영구 삭제 |
| Constants | `PROJECT_DATA_DIRS` = `['outs','inpaints','vibes','inpaint_masks','inpaint_orgs']` |

### 2. ProjectDrawer.tsx

| Location | Change |
|---|---|
| Action bar (line ~958) | "휴지통" 버튼 추가 (FaTrashAlt, "백업" 버튼 오른쪽) |
| sidebar width (line ~849) | `max-w-[400px]` → `max-w-[440px]` |
| State | `trashListOpen` 추가 |
| Dialog | ProjectTrashListModal (inline or new component) |

### 3. ProjectTrashListModal.tsx (신규)

- 삭제된 프로젝트 목록 (이름, 삭제일, 용량)
- 개별 복구 / 개별 영구삭제 / 모두 비우기
- 기존 `ProjectTrashModal`(이미지 단위 휴지통)과는 별개
