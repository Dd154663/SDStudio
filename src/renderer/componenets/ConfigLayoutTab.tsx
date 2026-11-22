// 설정 화면 탭: 레이아웃(key 'layout', 라벨 「레이아웃」) + 툴바(key 'toolbar', 라벨 「툴바」, 모바일) — LayoutTab·ToolbarTab(+QuickMenuEditor·LayoutWireframe·resetLayoutArrangement·CompanionButtonsSection·FloatScopeWireframe·floatViewModes)
import { V2_PART_OPTIONS } from '../models/mobileV2';
import {
  backend,
  isMobile,
} from '../models';
import ToolbarLayoutEditor from './ToolbarLayoutEditor';
import { projectToolbarRegistry, sceneToolbarRegistry, portableButtonMetas } from '../models/uiLayout';
import {
  GLOBAL_ACTIONS,
  globalActionMeta,
  DEFAULT_QUICK_MENU,
  addToQuickMenu,
  expandQuickMenu,
  isQuickMenuRemovedMarker,
  removeFromQuickMenu,
} from '../models/globalActions';
import { layoutTemplates } from '../models/layoutTemplates';
import {
  assignCompanion,
  removeCompanion,
  companionOwnerOf,
  COMPANION_HOSTS,
  COMPANION_HOST_LABELS,
  MODERN_COMPANION_DEFAULTS,
} from '../models/companionSlots';
import { applyCompanionSlots } from './CompanionDnd';
import { observer } from 'mobx-react-lite';
import { UI_ZOOM_PERCENT_OPTIONS, UI_ZOOM_TEXT, normalizeUiZoomPercent } from '../../shared/uiZoom';
import { appState } from '../models/AppService';
import {
  FaChevronDown,
  FaChevronUp,
  FaSlidersH,
  FaTimes,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import Tooltip from './Tooltip';
import { SettingCheckRow, SettingField, SettingGroup } from './SettingControls';

/* ── 탭: 툴바 버튼 구성 (테마 탭에서 분리 — 두 기능이 한 탭에 있으면 스크롤이 과도) ── */
/* ── 퀵 메뉴 구성 (트랙2 ① P3) ── */
// config.quickMenu 편집기. undefined = 추천 기본(DEFAULT_QUICK_MENU) 사용 상태.
// 표시명은 uiLayout 레지스트리 단일 출처(globalActionMeta), 모바일은 pcOnly 후보 제외.
const QuickMenuEditor = ({
  value,
  onChange,
  showButton,
  setShowButton,
  inGroup,
}: {
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
  showButton: boolean;
  setShowButton: (v: boolean) => void;
  // 묶음 상자(SettingGroup 「퀵 메뉴 구성」) 안 — 제목은 상자가 그린다(레이아웃 탭 PC). 모바일 툴바 탭은 종전처럼 자체 제목.
  inGroup?: boolean;
}) => {
  // 따라가는 액션(backup-import)까지 보이는 그대로 편집한다 — 「!id」 표식(빼 둔 따라가는 액션)은 목록에 안 보이게 끝에 둔다.
  const expanded = expandQuickMenu(value ?? DEFAULT_QUICK_MENU);
  const markers = expanded.filter(isQuickMenuRemovedMarker);
  const list = expanded.filter((id) => !isQuickMenuRemovedMarker(id));
  const commit = (next: string[]) => {
    const nextMarkers = next.filter(isQuickMenuRemovedMarker);
    const ids = next.filter((id) => !isQuickMenuRemovedMarker(id));
    onChange([...ids, ...nextMarkers]);
  };
  const included = new Set(list);
  const candidates = GLOBAL_ACTIONS.filter((a) => {
    const m = globalActionMeta(a.id);
    return !!m && !(isMobile && m.pcOnly);
  });
  const nameOf = (id: string) => globalActionMeta(id)?.name ?? id;
  const move = (id: string, dir: -1 | 1) => {
    const idx = list.indexOf(id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    next.splice(idx, 1);
    next.splice(to, 0, id);
    commit([...next, ...markers]);
  };
  return (
    <div className={inGroup ? 'setting-field' : undefined}>
      {!inGroup && <div className="text-sm font-semibold gray-label mb-1">퀵 메뉴 구성</div>}
      <p className="text-xs text-muted mb-2">
        우하단 ⚡ 버튼{isMobile ? '' : ' 또는 단축키(기본 Ctrl+K)'}로 여는 퀵
        메뉴에 담을 기능을 고릅니다. 위에서부터 나열 순서대로 표시됩니다.
      </p>
      {/* ⚡ 플로팅 버튼 옵트인 (2026-07-18 피드백 — 기본 숨김). 줄 전체 누름(2026-11-19 SettingCheckRow) —
          체크 줄 안쪽 여백만큼 바깥으로 당겨 위아래 글과 왼쪽 끝을 맞춘다. */}
      <div className="-mx-2.5 mb-2">
        <SettingCheckRow
          id="cfgQuickMenuButton"
          checked={showButton}
          onChange={setShowButton}
          label={
            <>
              <ActionIcon id="quick-menu" className="inline-block mr-1 align-[-0.125em]" />
              플로팅 버튼 표시
            </>
          }
          description={
            '끄면(기본) 화면의 퀵 메뉴 버튼이 숨겨집니다.' +
            (isMobile
              ? ' 모바일에서는 버튼이 유일한 진입점이므로 사용하려면 켜세요.'
              : ' 버튼 없이도 단축키(기본 Ctrl+K)로 계속 열 수 있습니다.')
          }
        />
      </div>
      {/* 순서 목록(2026-11-19 UI 정돈 시범 ③): ▲▼✕ 글자 → 아이콘 버튼(.setting-icon-btn, 제거는 hover 때 위험색). 이름·동작 불변. */}
      <div className="rounded-md border line-color divide-y divide-[var(--c-line)] mb-2" data-quick-menu-list="">
        {list.filter((id) => candidates.some((a) => a.id === id)).length === 0 && (
          <div className="text-xs text-muted p-2">비어 있음 — 아래에서 추가하세요</div>
        )}
        {list.map((id) =>
          candidates.some((a) => a.id === id) ? (
            <div key={id} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1">
              <span className="flex-1 text-sm text-default truncate">{nameOf(id)}</span>
              <Tooltip content="위로">
                <button type="button" className="setting-icon-btn ui-press" onClick={() => move(id, -1)}>
                  <FaChevronUp size={14} aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="아래로">
                <button type="button" className="setting-icon-btn ui-press" onClick={() => move(id, 1)}>
                  <FaChevronDown size={14} aria-hidden="true" />
                </button>
              </Tooltip>
              <button
                type="button"
                className="setting-icon-btn setting-icon-btn-danger ui-press"
                aria-label="제거"
                onClick={() => commit(removeFromQuickMenu([...list, ...markers], id))}
              >
                <FaTimes size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {candidates
          .filter((a) => !included.has(a.id))
          .map((a) => (
            <button
              key={a.id}
              className="btn rounded-full border line-color px-2.5 py-1 text-xs text-default bg-[var(--c-input-bg)]"
              onClick={() => commit(addToQuickMenu([...list, ...markers], a.id))}
            >
              + {nameOf(a.id)}
            </button>
          ))}
      </div>
      <button
        className="btn-link text-xs"
        onClick={() => onChange(undefined)}
        disabled={value === undefined}
      >
        추천 기본값으로 되돌리기
      </button>
    </div>
  );
};

// 모바일 「툴바」 탭 — 묶음 상자(2026-11-20 UI 정돈 그룹 1-a): 툴바 / 씬 툴바 / 프로젝트 바(ToolbarLayoutEditor 가 그림) / 퀵 메뉴 구성.
const ToolbarTab = ({ uiToolbar, setUiToolbar, quickMenu, setQuickMenu, quickMenuButton, setQuickMenuButton }: any) => (
  <div className="space-y-4">
    <ToolbarLayoutEditor
      value={uiToolbar}
      onChange={setUiToolbar}
      groups={[
        { title: '씬 툴바', area: 'scene', registry: sceneToolbarRegistry },
        { title: '프로젝트 바', area: 'project', registry: projectToolbarRegistry },
      ]}
      mobileMode={isMobile}
    />
    <SettingGroup title="퀵 메뉴 구성">
      <QuickMenuEditor inGroup value={quickMenu} onChange={setQuickMenu} showButton={quickMenuButton} setShowButton={setQuickMenuButton} />
    </SettingGroup>
  </div>
);

/* ── 탭: 레이아웃 ── */
// 각 템플릿의 미니 와이어프레임 도안(라이브 프리뷰가 아닌 순수 CSS 사각형 배치 도안).
// 색은 테마 토큰만 사용하고, 하단바 위치만 상태 강조색(sky)으로 표현한다.
const LayoutWireframe = ({
  variant,
}: {
  variant: 'classic' | 'compact' | 'sidebar' | 'modern' | 'mobile-v2';
}) => {
  if (variant === 'mobile-v2') {
    // 모바일 V2: 세로 화면 도안 — 조작 영역이 아래(엄지 범위)에 모인 모습(하단 강조 2줄).
    return (
      <div className="w-28 h-16 flex justify-center">
        <div className="h-full w-9 rounded-sm border line-color flex flex-col gap-0.5 p-0.5">
          <div className="h-1 rounded-sm bg-[var(--c-zone)] flex-none" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
          <div className="h-1.5 rounded-sm bg-sky-500/60 flex-none" />
          <div className="h-1.5 rounded-sm bg-sky-500 flex-none" />
        </div>
      </div>
    );
  }
  if (variant === 'modern') {
    // 모던: 좌측 아주 얇은 스트립(강조) + 프리셋 + 본문, 하단바 없음 + 플로팅 위젯.
    return (
      <div className="w-28 h-16 relative">
        <div className="h-full rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-1 rounded-sm bg-sky-500" />
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        <div className="absolute bottom-1 right-1 w-5 h-2.5 rounded-sm bg-sky-500 shadow-sm" />
      </div>
    );
  }
  if (variant === 'sidebar') {
    // 사이드바: 좌측 두꺼운 프로젝트 바(강조색) + 프리셋 + 본문 + 아래 얇은 바.
    return (
      <div className="w-28 h-16 flex flex-col gap-1">
        <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-2 rounded-sm bg-sky-500" />
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        <div className="h-2 rounded-sm bg-[var(--c-zone)] flex-none" />
      </div>
    );
  }
  if (variant === 'compact') {
    // 컴팩트: 하단바 없이 콘텐츠가 세로로 꽉 참(패널+본문 분할) + 우하단 작은 플로팅 위젯 도안.
    return (
      <div className="w-28 h-16 relative">
        <div className="h-full rounded-sm border line-color flex gap-0.5 p-0.5">
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
        </div>
        {/* 떠 있는 생성 컨트롤 위젯(우하단 작은 사각형) */}
        <div className="absolute bottom-1 right-1 w-5 h-2.5 rounded-sm bg-sky-500 shadow-sm" />
      </div>
    );
  }
  // classic: 위 큰 콘텐츠(좌측 좁은 패널 + 우측 넓은 본문) + 아래 가로 얇은 바
  return (
    <div className="w-28 h-16 flex flex-col gap-1">
      <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
        <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
        <div className="flex-1 rounded-sm bg-[var(--c-zone)]" />
      </div>
      <div className="h-2 rounded-sm bg-sky-500 flex-none" />
    </div>
  );
};

// 직접 편집(EditModeShell)으로 바뀐 레이아웃 배치를 템플릿 기본값으로 되돌린다.
// 대상: 패널 좌/우(history·preset·project) + 생성 컨트롤 슬롯(uiLayoutSlots) + 분리형
// 위젯 위치(genWidget) + 동반 슬롯(uiCompanionSlots — ② A 실기 피드백 3). 동반 슬롯의
// "기본값"은 템플릿 의존: 모던이면 모던 기본 배치, 그 외에는 배정 없음(전부 툴바 복귀).
// 배정 없음({})이면 PC 기본 동반 배치(프롬프트조각 → 사전세팅선택 행, companionSlots COMPANION_DEFAULT_PLACEMENTS)가
// 다시 가상 적용된다 — 툴바 유지 표(_toolbar)도 함께 비워지므로. 단 툴바에서 그 버튼을 직접 옮긴 기록(uiToolbar.buttons)은
// 툴바 쪽 「버튼 배치 초기화」 소관이라 여기서 지우지 않는다(그 기록이 있으면 툴바 자리 유지).
// 모던 해제 후 흩어진 버튼을 일괄 복귀시키는 유일한 수단이라 여기 포함한다.
// 선택한 템플릿(uiLayoutTemplate)은 사용자가 명시적으로 고른 값이라 건드리지 않는다.
// 이 필드들은 ConfigScreen 저장 흐름 밖(편집 모드/드래그가 즉시 반영)이라 여기서도
// 즉시 반영한다(applyLayoutSlots·applyGenWidget·applyCompanionSlots 패턴과 동일).
async function resetLayoutArrangement() {
  appState.uiLayoutSlots = {};
  appState.genWidget = {};
  const companionDefaults: Record<string, string[]> =
    appState.uiLayoutTemplate === 'modern'
      ? JSON.parse(JSON.stringify(MODERN_COMPANION_DEFAULTS))
      : {};
  appState.uiCompanionSlots = companionDefaults;
  try {
    const config = await backend.getConfig();
    await backend.setConfig({
      ...config,
      uiLayoutSlots: {},
      genWidget: {},
      uiCompanionSlots: companionDefaults,
    });
  } catch (e) {
    console.error('레이아웃 배치 초기화 저장 실패:', e);
  }
}

// 동반 슬롯(L3-3 → E3) — 프리셋 에디터 "호스트 행" 옆 전역 버튼 배치의 편집 배선.
// E2 에서 계약이 "호스트 목록 + portable 전체 풀 + 유일성"으로 확대됐고, E3 에서 이 화면의
// 편집 UI 를 단일 토글 → 버튼별 위치 선택(CompanionButtonsSection)으로 일반화한다. 쓰기는
// 단일 출처 헬퍼(assign/removeCompanion)를 경유하며, 표시명은 uiLayout·companionSlots 의
// 레지스트리/라벨을 조회한다(여기서 중복 정의하지 않음).

// 영속 헬퍼 applyCompanionSlots 는 E4 에서 CompanionDnd 로 이관(드래그·드롭다운 공유
// 단일 출처). 여기서는 그걸 import 해 쓴다 — 동작·저장 패턴 동일(새 객체 할당 + 병합 저장).

// 동반 버튼 편집(E3) — portable 버튼 8종 각각에 "위치"를 고른다. 이동 의미론상 한 버튼은
// 최대 한 곳이라 select 단일 선택이 자연스럽다: '기본 (툴바)' = 슬롯 배정 없음(removeCompanion),
// 그 외 = 해당 호스트 행에 배정(assignCompanion). observer 라 appState.uiCompanionSlots 변경
// 시 이 목록도 즉시 갱신되고, applyCompanionSlots 가 열려 있는 프리셋 에디터에도 함께 반영한다.
// 슬롯 내 순서(같은 호스트 여러 버튼)는 배정 순 — 순서 조정은 E4 드래그 소관이라 여기선 없다.
// 2026-11-19 UI 정돈 시범 ③: 구획 → 묶음 상자, 위치 select → 앱 모양 선택 칸(.app-select).
const CompanionButtonsSection = observer(() => (
  <SettingGroup title="동반 버튼">
   <SettingField>
    <p className="text-xs text-muted mb-2">
      행에 배치한 버튼은 툴바에서 그 위치로 이동합니다. 저장 없이 바로 적용됩니다.
    </p>
    <div className="space-y-2">
      {portableButtonMetas().map(({ id, name }) => {
        const owner = companionOwnerOf(id, appState.companionSlotsView) ?? '';
        return (
          <div key={id} className="flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-sm text-default">{name}</span>
            <select
              className="app-select flex-none w-36 text-sm"
              aria-label={`${name} 위치`}
              value={owner}
              onChange={(e) => {
                const host = e.target.value;
                const next = host
                  ? assignCompanion(appState.uiCompanionSlots, host, id)
                  : removeCompanion(appState.uiCompanionSlots, id);
                applyCompanionSlots(next);
              }}
            >
              <option value="">기본 (툴바)</option>
              {COMPANION_HOSTS.map((h) => (
                <option key={h} value={h}>
                  {COMPANION_HOST_LABELS[h] ?? h}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
   </SettingField>
  </SettingGroup>
));

// 창 배치(FloatView 노출 범위) 도안 — sky 사각형이 뷰어가 덮는 영역.
const FloatScopeWireframe = ({ variant }: { variant: 'cover' | 'center' }) => (
  <div className="w-28 h-16 flex flex-col gap-1">
    <div className="flex-1 rounded-sm border line-color flex gap-0.5 p-0.5">
      {variant === 'center' ? (
        <>
          <div className="w-1/4 rounded-sm bg-[var(--c-zone)]" />
          <div className="flex-1 rounded-sm bg-sky-500" />
          <div className="w-1/5 rounded-sm bg-[var(--c-zone)]" />
        </>
      ) : (
        <>
          <div className="flex-1 rounded-sm bg-sky-500" />
          <div className="w-1/5 rounded-sm bg-[var(--c-zone)]" />
        </>
      )}
    </div>
    <div className="h-2 rounded-sm bg-[var(--c-zone)] flex-none" />
  </div>
);

// 창 배치 선택지 — id 는 config 저장 키(uiFloatViewMode)라 배포 후 불변.
const floatViewModes: {
  id: 'cover' | 'center';
  name: string;
  description: string;
}[] = [
  {
    id: 'cover',
    name: '넓게 펼침',
    description:
      '이미지 뷰어 등 큰 화면이 좌우 패널 위까지 넓게 열립니다. 히스토리 패널은 유지됩니다.',
  },
  {
    id: 'center',
    name: '중앙 영역만',
    description:
      '큰 화면이 중앙 영역 안에만 열려, 좌우 패널(프롬프트 등)을 같이 보며 작업할 수 있습니다.',
  },
];

const LayoutTab = ({ uiLayoutTemplate, setUiLayoutTemplate, uiMobileV2Parts, setUiMobileV2Parts, setModernExitReset, uiPresetIconRow, setUiPresetIconRow, uiToolbarButtonNames, setUiToolbarButtonNames, showShortcutHelpOnStartup, setShowShortcutHelpOnStartup, uiZoomPercent, setUiZoomPercent, uiToolbar, setUiToolbar, quickMenu, setQuickMenu, quickMenuButton, setQuickMenuButton, uiFloatViewMode, setUiFloatViewMode, mobileMode, onClose }: any) => (
  // 묶음 상자(2026-11-19 UI 정돈 시범 ③): 화면 배치 / 패널과 창 / (PC) PC 화면과 툴바 · 퀵 메뉴 구성 / (모바일) 동반 버튼.
  // 항목·순서·문구·id·저장 방식은 그대로, 상자와 체크 줄(SettingCheckRow)·선택 칸(.app-select) 모양만 바꿨다. 한 열 유지.
  <div className="space-y-4">
   <SettingGroup title="화면 배치">
    <SettingField>
      <p className="text-xs text-muted">
        작업 화면의 하단 바 위치를 바꿉니다. 누르고 <b>저장</b>하면 적용됩니다.
      </p>
    </SettingField>

    {/* 편집 모드 진입점(PC 전용) — 실제 화면 위에서 버튼·패널 배치를 드래그로 조정.
        모바일은 클래식 강제라 비활성 + "PC 전용" 표시(위 템플릿 칩과 동일 패턴). */}
    <SettingField>
      <button
        type="button"
        disabled={mobileMode}
        onClick={async () => {
          if (mobileMode) return;
          // 닫기 요청(미저장 가드 포함, 2026-11-12 H3)을 태우고, 실제로 닫혔을 때만 편집 모드로 들어간다.
          // 거절하면 창과 저장 안 된 변경이 그대로 남는다.
          if (await onClose()) appState.editMode = true;
        }}
        className={
          'flex w-full items-center gap-3 rounded-md r-card border p-2.5 text-left clickable line-color ' +
          (mobileMode ? 'opacity-50 cursor-not-allowed ' : '')
        }
      >
        <FaSlidersH size={16} className="flex-none text-muted" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-default">화면에서 직접 편집</span>
            {mobileMode && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                PC 전용
              </span>
            )}
          </div>
          <div className="text-xs text-muted mt-0.5">
            실제 화면에서 버튼·패널 배치를 드래그로 조정합니다
          </div>
        </div>
      </button>
    </SettingField>

    <SettingField className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {/* 이 기기에서 고를 수 있는 템플릿을 먼저 보여준다(모바일에서 PC 전용 4종 아래로
          모바일 V2 가 밀리지 않게). 같은 그룹 안에서는 레지스트리 순서 유지. */}
      {[...layoutTemplates]
        .sort((a, b) => {
          const off = (t: (typeof layoutTemplates)[number]) =>
            (mobileMode ? !t.mobileAllowed : !t.desktopAllowed) ? 1 : 0;
          return off(a) - off(b);
        })
        .map((t) => {
        const selected = uiLayoutTemplate === t.id;
        // 모바일에서 미허용 템플릿은 resolveLayout 이 어차피 classic 으로 강제하므로
        // UI 는 안내용으로만 비활성 처리한다.
        // PC 에서 모바일 전용 템플릿도 같은 이유(desktopAllowed=false → classic 폴백)로 비활성.
        const disabled = mobileMode ? !t.mobileAllowed : !t.desktopAllowed;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              // 모던 사이드바 = 저장 시 버튼 배치를 초기화하고 모던 기본 배치를 강제
              // 적용하므로(② A 결정 2), 선택 시점에 미리 경고·동의를 받는다.
              if (t.id === 'modern' && uiLayoutTemplate !== 'modern') {
                appState.pushDialog({
                  type: 'confirm',
                  danger: true,
                  text: '모던 사이드바를 적용하면 저장 시 프로젝트 툴바가 사라지고, 버튼 배치(툴바·동반 슬롯)가 초기화된 뒤 모던 기본 배치가 적용됩니다. 계속할까요?',
                  callback: () => {
                    setModernExitReset(false);
                    setUiLayoutTemplate('modern');
                  },
                });
                return;
              }
              // 모던 → 다른 템플릿(② A 2차 피드백 후속 1): 흩어진 버튼·레이아웃 배치를
              // 초기화할지 묻는다. 아니요(취소) = 전환만 하고 현재 배치 유지.
              if (uiLayoutTemplate === 'modern' && t.id !== 'modern') {
                setUiLayoutTemplate(t.id);
                appState.pushDialog({
                  type: 'confirm',
                  danger: true,
                  text: '모던 사이드바를 해제합니다. 저장 시 버튼과 레이아웃 배치를 기본값으로 초기화할까요? (취소 = 현재 배치 유지)',
                  callback: () => setModernExitReset(true),
                });
                return;
              }
              setUiLayoutTemplate(t.id);
            }}
            className={
              'flex items-center gap-3 rounded-md border p-2.5 text-left clickable ' +
              (selected ? 'ring-2 ring-sky-400 border-sky-400 ' : 'line-color ') +
              (disabled ? 'opacity-50 cursor-not-allowed ' : '')
            }
          >
            <LayoutWireframe
              variant={t.id as 'classic' | 'compact' | 'sidebar' | 'modern' | 'mobile-v2'}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-default">{t.name}</span>
                {!t.mobileAllowed && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                    PC 전용
                  </span>
                )}
                {!t.desktopAllowed && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                    모바일 전용
                  </span>
                )}
              </div>
              <div className="text-xs text-muted mt-0.5">{t.description}</div>
            </div>
          </button>
        );
      })}
    </SettingField>

    {mobileMode && (
      <SettingField>
        <p className="text-xs text-muted">
          모바일에서는 클래식과 모바일 V2 중에서 고를 수 있습니다. 모바일 V2 는 선택 사항이며,
          여기서 클래식을 다시 고르고 저장하면 언제든 이전 배치로 돌아갑니다.
        </p>
      </SettingField>
    )}
    {/* 모바일 V2 일부 적용(2026-09-27): 부위별 켬/끔. 끈 부위는 클래식 배치. 저장 시 적용. */}
    {mobileMode && uiLayoutTemplate === 'mobile-v2' && (
      <div className="pt-2" data-cfg-v2-parts="">
        <div className="text-sm gray-label mb-1 px-2.5">모바일 V2 적용 범위</div>
        {V2_PART_OPTIONS.map((p) => (
          <SettingCheckRow
            key={p.key}
            id={`cfgV2Part-${p.key}`}
            checked={uiMobileV2Parts[p.key]}
            onChange={(checked) => setUiMobileV2Parts({ ...uiMobileV2Parts, [p.key]: checked })}
            label={p.label}
            description={p.desc}
          />
        ))}
        <p className="text-xs text-muted mt-1 px-2.5">끈 부위는 클래식 배치로 그려집니다. 저장 시 적용.</p>
      </div>
    )}
   </SettingGroup>

    {/* 프리셋 패널 버튼 하단 아이콘 행(릴리스 준비 ② B) — 템플릿과 독립인 선택
        옵션(PC·모바일 공용, 저장 시 적용). */}
   <SettingGroup title="패널과 창">
    <SettingCheckRow
      id="cfgPresetIconRow"
      checked={uiPresetIconRow}
      onChange={setUiPresetIconRow}
      label="프리셋 패널 버튼을 하단 아이콘 행으로 정리"
      description="캐릭터 프롬프트·샘플링/모델·바이브·캐릭터 레퍼런스 버튼을 패널 최하단의 아이콘 한 줄로 모아 프롬프트 공간을 넓힙니다."
    />

    {/* 창 배치 — FloatView(이미지 뷰어 등 큰 화면)가 덮는 영역. PC 전용
        (모바일은 좌우 패널이 없어 항상 중앙 영역과 동일). 저장 시 적용. */}
    <SettingField className="pt-2">
      <label className="block text-sm gray-label mb-1">창 배치</label>
      <p className="text-xs text-muted mb-2">
        씬 이미지 목록·뷰어처럼 화면을 덮는 창이 차지할 영역을 정합니다.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {floatViewModes.map((m) => {
          const selected = (uiFloatViewMode ?? 'cover') === m.id;
          return (
            <button
              key={m.id}
              type="button"
              disabled={mobileMode}
              onClick={() => { if (!mobileMode) setUiFloatViewMode(m.id); }}
              className={
                'flex items-center gap-3 rounded-md border p-2.5 text-left clickable ' +
                (selected ? 'ring-2 ring-sky-400 border-sky-400 ' : 'line-color ') +
                (mobileMode ? 'opacity-50 cursor-not-allowed ' : '')
              }
            >
              <FloatScopeWireframe variant={m.id} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-default">{m.name}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--c-zone)] text-muted flex-none">
                    PC 전용
                  </span>
                </div>
                <div className="text-xs text-muted mt-0.5">{m.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </SettingField>

    {/* 직접 편집으로 옮긴 패널·생성 컨트롤 배치를 되돌리는 초기화(즉시 반영, 저장 불필요).
        슬롯/위젯 위치는 저장 흐름 밖이라 여기서 바로 config 에 쓴다. */}
    <SettingField className="pt-2">
      <button
        type="button"
        className="round-button back-gray btn-sm"
        onClick={() => {
          appState.pushDialog({
            type: 'confirm',
            danger: true,
            text: '화면에서 직접 편집으로 옮긴 패널 좌/우 배치·생성 컨트롤 위치·동반 버튼 배치를 현재 템플릿의 기본값으로 되돌립니다. (선택한 템플릿은 유지됩니다.) 계속할까요?',
            callback: async () => {
              await resetLayoutArrangement();
              appState.pushMessage('레이아웃 배치를 초기화했습니다');
            },
          });
        }}
      >
        레이아웃 배치 초기화
      </button>
      <p className="text-xs text-muted mt-1">
        화면에서 직접 편집으로 옮긴 패널·생성 컨트롤 배치를 되돌립니다. 저장 없이
        즉시 적용됩니다.
      </p>
    </SettingField>
   </SettingGroup>

    {/* 툴바 전역 조작(② A 2차 피드백 후속 2 — 툴바 탭 흡수, PC 전용): 버튼별 배치
        select·동반 버튼 select 는 편집 모드 드래그(고정/⋯메뉴/숨김/동반 배정)가 전부
        대체해 제거. 남는 전역 조작 3종(클래식 토글·버튼 배치 초기화·퀵 메뉴 구성)만
        이관. 모바일은 편집 모드가 없어 기존 툴바 탭이 유지된다. */}
    {!mobileMode && (
     <>
      <SettingGroup title="PC 화면과 툴바">
        {/* PC 화면 배율(시험 기능, 2026-11-19 — shared/uiZoom.ts). Electron 창 배율로 글자·버튼·간격을 함께 줄인다.
            모바일은 항목 없음(이 블록 전체가 PC 전용). 저장 시 main 이 열린 모든 창에 반영. */}
        <SettingField>
          <label htmlFor="cfgUiZoom" className="block text-sm gray-label">
            {UI_ZOOM_TEXT.label}
          </label>
          <select
            id="cfgUiZoom"
            className="app-select mt-1 block w-40 sm:text-sm"
            value={uiZoomPercent}
            onChange={(e) => setUiZoomPercent(normalizeUiZoomPercent(e.target.value))}
          >
            {UI_ZOOM_PERCENT_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {UI_ZOOM_TEXT.option(p)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1">{UI_ZOOM_TEXT.description}</p>
        </SettingField>
        <SettingCheckRow
          id="cfgClassicToolbar"
          checked={!!uiToolbar.classic}
          onChange={(checked) => setUiToolbar({ ...uiToolbar, classic: checked || undefined })}
          label="클래식 툴바 사용 (이전 배치로 되돌리기)"
          description="켜면 모든 버튼을 예전처럼 툴바에 나란히 표시합니다(⋯ 메뉴·개별 배치 무시). 저장 시 반영됩니다."
        />
        {/* PC 툴바 버튼 이름(2026-11-18) — 씬 툴바·이미지 그리드 머리줄 아이콘 아래 작은 이름. 기본 켬, 저장 시 반영. */}
        <SettingCheckRow
          id="cfgToolbarButtonNames"
          checked={!!uiToolbarButtonNames}
          onChange={setUiToolbarButtonNames}
          label="버튼 이름 표시"
          description="씬 툴바와 이미지 목록 위 아이콘 버튼 아래에 짧은 이름을 보입니다. 창이 좁으면 이름이 먼저 숨겨집니다. 저장 시 반영됩니다."
        />
        {/* 시작 시 씬 단축키 도움말(2026-11-22, 기본 끔 — 사용자 결정). 도움말 패널이 PC 전용이라 이 블록(PC 전용) 안.
            설정은 「시작할 때 열지」만 정한다 — 실행 중 여닫음(H 키·버튼)은 저장하지 않는다(models/shortcutHelpStartup.ts). */}
        <SettingCheckRow
          id="cfgShortcutHelpOnStartup"
          checked={!!showShortcutHelpOnStartup}
          onChange={setShowShortcutHelpOnStartup}
          label="시작 시 단축키 도움말 표시"
          description="다음 실행부터 적용됩니다. 꺼 두어도 씬 툴바의 「단축키 도움말」 버튼(기본 위치는 ⋯ 메뉴)이나 H 키로 언제든 열 수 있습니다."
        />
        <SettingField className="pt-2">
          <button
            type="button"
            className="round-button back-gray btn-sm"
            onClick={() => setUiToolbar({ classic: uiToolbar.classic })}
          >
            버튼 배치 초기화
          </button>
          <p className="text-xs text-muted mt-1">
            화면에서 직접 편집으로 옮긴 버튼 배치(고정/⋯메뉴/숨김·순서)를 모두 기본
            배치로 되돌립니다. (저장 시 반영)
          </p>
        </SettingField>
      </SettingGroup>
      <SettingGroup title="퀵 메뉴 구성">
        <QuickMenuEditor inGroup value={quickMenu} onChange={setQuickMenu} showButton={quickMenuButton} setShowButton={setQuickMenuButton} />
      </SettingGroup>
     </>
    )}

    {/* 동반 버튼(E3) — portable 버튼을 프리셋 에디터 특정 행 옆으로 옮기는 위치 선택.
        모바일 전용(② A 2차 피드백 후속 2): PC 는 편집 모드 드래그(E4)가 대체. 모바일은
        편집 모드가 없어 이 select 가 유일한 배정 수단이라 유지한다. */}
    {mobileMode && <CompanionButtonsSection />}
  </div>
);

export { ToolbarTab };
export default LayoutTab;
