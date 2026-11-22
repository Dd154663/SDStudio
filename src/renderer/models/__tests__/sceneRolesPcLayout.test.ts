// 씬 편집 창 「씬 캐릭터 역할」 탭 PC 공간 개편(2026-11-22 「안 가」 — 두 열) 회귀 검사.
// 판정 함수는 직접, 배치는 소스 검사형(큰 컴포넌트·appState 의존이라 렌더 대신 — uiPolishGroup2c 와 같은 방식).
import * as fs from 'fs';
import * as path from 'path';
import {
  SCENE_ROLES_LEFT_COL_PX,
  SCENE_ROLES_SIDE_BY_SIDE_MIN_PX,
  SCENE_ROLES_TWO_COL_MIN_PX,
  sceneRolesPcLayout,
} from '../sceneRolesLayout';

const src = fs
  .readFileSync(path.resolve(__dirname, '../../componenets/SceneEditor.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

// 역할 탭 컴포넌트 본문만
const compStart = src.indexOf('const SceneCharacterPromptEditor = observer(');
const compEnd = src.indexOf('export const SlotEditor = observer(');
const comp = src.slice(compStart, compEnd);
// 모바일 분기 / PC 분기
const mobileStart = comp.indexOf('  if (isMobile) {\n    // 모바일 배치');
const pcStart = comp.indexOf('// ── PC 배치');
const mobile = comp.slice(mobileStart, pcStart);
const pc = comp.slice(pcStart);
// 공용 조각(역할 카드 등) — 분기 앞
const shared = comp.slice(0, mobileStart);
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('판정 함수 sceneRolesPcLayout', () => {
  test('폭을 모르면(null·0) 넓은 배치', () => {
    expect(sceneRolesPcLayout(null)).toEqual({ twoCol: true, sideBySide: true });
    expect(sceneRolesPcLayout(0)).toEqual({ twoCol: true, sideBySide: true });
  });
  test('760px 미만이면 한 열, 이상이면 두 열', () => {
    expect(SCENE_ROLES_TWO_COL_MIN_PX).toBe(760);
    expect(sceneRolesPcLayout(759).twoCol).toBe(false);
    expect(sceneRolesPcLayout(760).twoCol).toBe(true);
  });
  test('카드 안 나란히는 역할 목록 열 폭 기준(두 열이면 왼쪽 열 300 + 간격·여백을 뺀 폭)', () => {
    expect(SCENE_ROLES_LEFT_COL_PX).toBe(300);
    // 두 열, 목록 열 = w - 32 - 300 - 16
    expect(sceneRolesPcLayout(760).sideBySide).toBe(false); // 412
    expect(sceneRolesPcLayout(888).sideBySide).toBe(true); // 540
    expect(sceneRolesPcLayout(887).sideBySide).toBe(false);
    // 한 열, 목록 열 = w - 32
    expect(sceneRolesPcLayout(700).sideBySide).toBe(700 - 32 >= SCENE_ROLES_SIDE_BY_SIDE_MIN_PX);
    expect(sceneRolesPcLayout(500).sideBySide).toBe(false);
  });
});

describe('PC 배치(두 열)', () => {
  test('분기 자르기가 맞다', () => {
    expect(compStart).toBeGreaterThan(-1);
    expect(mobileStart).toBeGreaterThan(-1);
    expect(pcStart).toBeGreaterThan(mobileStart);
  });

  test('두 열 표식 — 뿌리 폭 측정 + 왼쪽 고정 폭 열 + 오른쪽 목록 열(이 열만 세로 스크롤)', () => {
    expect(pc).toContain('ref={pcRootRef}');
    expect(pc).toContain("data-scene-roles-layout={twoCol ? 'two-col' : 'one-col'}");
    expect(pc).toContain('data-scene-roles-col="side"');
    expect(pc).toContain('style={twoCol ? { width: SCENE_ROLES_LEFT_COL_PX } : undefined}');
    expect(pc).toContain('className="flex-1 min-w-0 min-h-0 overflow-y-auto pr-1" data-scene-roles-col="list"');
    // 뿌리는 스크롤하지 않는다(스크롤은 영역마다 하나)
    expect(pc).toContain("'flex flex-row gap-4 h-full p-4 overflow-hidden'");
    // 기본 캐릭터 목록은 두 열일 때 남는 높이 + 안쪽 스크롤, 종전 max-h-48 은 PC 에 없음
    expect(pc).toContain("twoCol ? 'space-y-1.5 flex-1 min-h-0 overflow-auto' : 'space-y-1.5'");
    expect(pc).not.toContain('max-h-48');
  });

  test('왼쪽 열 순서 — 방식 택일 → 공통 네거티브 → 기본 캐릭터 → 위치 지정 창 열기, 큰 제목 없음', () => {
    const iSeg = pc.indexOf('<div className="seg-group inline-flex">');
    const iNeg = pc.indexOf('data-scene-roles-common-neg=""');
    const iBase = pc.indexOf('data-scene-roles-base=""');
    const iPos = pc.indexOf('data-char-pos-open=""');
    const iList = pc.indexOf('data-scene-roles-col="list"');
    expect(iSeg).toBeGreaterThan(-1);
    expect(iSeg).toBeLessThan(iNeg);
    expect(iNeg).toBeLessThan(iBase);
    expect(iBase).toBeLessThan(iPos);
    expect(iPos).toBeLessThan(iList);
    expect(comp).not.toContain('씬 전용 캐릭터 프롬프트\n');
    expect(pc).toContain('<div className="text-xs text-muted">기본 캐릭터 프롬프트가 없습니다</div>');
  });

  test('프롬프트 칸 표준 — 역할 프롬프트·역할 네거티브·공통 네거티브 3칸 모두 min-h-20 max-h-40 + flex-1 min-h-0', () => {
    for (const box of ['prompt', 'uc']) {
      expect(shared).toContain(`<div className="flex flex-col min-h-20 max-h-40" data-scene-role-box="${box}">`);
    }
    expect(pc).toContain('<div className="flex flex-col min-h-20 max-h-40" data-scene-role-box="common-uc">');
    expect(count(comp, 'className="flex-1 min-h-0"')).toBe(3);
  });

  test('카드 안 프롬프트(넓게)·네거티브(좁게) 나란히 3:2, 좁으면 위아래', () => {
    expect(shared).toContain(
      "className={sideBySide ? 'grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3' : 'flex flex-col gap-2'}",
    );
    expect(shared).toContain("data-scene-role-fields={sideBySide ? 'row' : 'stack'}");
    expect(pc).toContain('roleCard(character, index, pcLayout.sideBySide)');
  });

  test('위치는 카드 머리 줄로(PC) — 머리 줄 안에 위치 버튼', () => {
    const head = shared.slice(shared.indexOf('data-scene-role-head=""'), shared.indexOf('data-scene-role-fields'));
    expect(head).toContain('rolePositionButton(character, index, `위치 ${positionText(character)}`)');
    expect(head).toContain('roleOrderButtons(character, index)');
  });

  test('캐릭터 추가 = 목록 끝 점선 칸(모바일과 같은 요소), 바닥 전 폭 초록 버튼 없음', () => {
    expect(comp).not.toContain('back-green');
    expect(count(comp, 'add-slot ')).toBe(1);
    expect(shared).toContain('data-scene-role-add=""');
    const list = pc.slice(pc.indexOf('data-scene-roles-col="list"'));
    expect(list).toContain('{addRoleSlot}');
    expect(list).toContain('씬 캐릭터 역할이 없습니다. 아래 칸을 눌러 추가하세요.');
    expect(pc).not.toContain('text-4xl');
  });
});

describe('켜기/끄기 토글 — 라벨 고정 + aria-pressed(PC·모바일 공통)', () => {
  test('roleToggle 하나로 두 분기가 쓰고 라벨은 「활성화」 한 가지', () => {
    const toggle = shared.slice(shared.indexOf('const roleToggle'), shared.indexOf('const roleOrderButtons'));
    expect(toggle).toContain('aria-pressed={on}');
    expect(toggle).toContain('data-scene-role-toggle=""');
    expect(toggle).not.toContain('비활성화');
    expect(count(toggle, '활성화')).toBe(1);
    expect(comp).not.toMatch(/<FaToggleOff className="mr-1" \/>\s*\n\s*비활성화/);
    expect(count(shared, '{roleToggle(character)}')).toBe(2);
  });
});

describe('모바일 분기 불변(2026-09-26 배치)', () => {
  test('뿌리·머리·접기 두 개·목록·카드 칸 높이 h-16·점선 추가 칸', () => {
    expect(mobile).toContain('<div className="flex flex-col h-full px-3 py-2 overflow-hidden">');
    expect(mobile).toContain('className="flex-none flex items-center gap-2 mb-2" data-scene-roles-head=""');
    expect(mobile).toContain('className="seg-group seg-fill flex flex-1 min-w-0"');
    expect(mobile).toContain('<FoldHead open={!foldBase} label="기본 캐릭터 프롬프트 (읽기 전용 · 순서 변경)"');
    expect(mobile).toContain('<FoldHead open={!foldNeg} label="씬 전용 캐릭터 공통 네거티브 프롬프트"');
    expect(mobile).toContain('<div className="space-y-1.5 max-h-48 overflow-auto">');
    expect(mobile).toContain('<div className="flex-1 overflow-auto">');
    expect(mobile).toContain('<div className="h-16 mb-2">');
    expect(mobile).toContain('roleCard(character, index, false)');
    expect(mobile).toContain('{addRoleSlot}');
    expect(mobile).not.toContain('min-h-20');
    // 모바일 카드: p-3, 두 칸 h-16, 카드 맨 아래 위치 줄(종전 문구)
    const mobileCard = shared.slice(shared.indexOf('{isMobile ? (\n        <>'), shared.indexOf('PC 머리 줄'));
    expect(count(mobileCard, '<div className="h-16">')).toBe(2);
    expect(mobileCard).toContain('· 위치 지정 창에서 조정`)');
    expect(mobileCard).toContain('씬 캐릭터 역할 {index + 1}');
    expect(mobileCard).not.toContain('FaGripVertical');
    expect(shared).toContain("${isMobile ? 'p-3' : 'p-4'}");
  });
});
