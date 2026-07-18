import {
  ToolbarButtonPlacement,
  UiToolbarConfig,
} from '../../main/config';
import {
  moveToolbarButton,
  ToolbarButtonMeta,
  ToolbarRegistryEntry,
} from '../models/uiLayout';

// 환경설정 → 테마 탭의 "툴바 버튼 구성" 에디터.
// 상단 클래식 롤백 토글 + 레지스트리별 버튼 배치 select 목록.
// 저장은 ConfigScreen 의 handleSave 흐름(저장 시 반영) — 실시간 미리보기 아님.

export interface ToolbarEditorGroup {
  title: string;
  // 레지스트리의 영역 id('scene'/'project' 등) — moveToolbarButton 경유에 필요
  area: string;
  registry: ToolbarButtonMeta[];
}

interface ToolbarLayoutEditorProps {
  value: UiToolbarConfig;
  onChange: (v: UiToolbarConfig) => void;
  groups: ToolbarEditorGroup[];
  mobileMode: boolean;
}

// 미설정('default') 시 실제로 놓이는 곳 — select 라벨 힌트용
const defaultPlaceLabel = (b: ToolbarButtonMeta, mobileMode: boolean) => {
  if (b.tier === 'primary') return '툴바';
  if (b.tier === 'secondary') return mobileMode ? '메뉴' : '툴바';
  if (b.tier === 'mobile-primary') return mobileMode ? '툴바' : '메뉴';
  return '메뉴';
};

const ToolbarLayoutEditor = ({
  value,
  onChange,
  groups,
  mobileMode,
}: ToolbarLayoutEditorProps) => {
  // 배치 변경은 반드시 moveToolbarButton(v2 인지) 경유 — 예전처럼 v1 buttons 만
  // 쓰면, 화면 드래그/⋯이동/숨김이 한 번이라도 만든 schema v2 areas 배열이 우선이라
  // select 변경이 조용히 무시된다(특히 hidden 배열의 버튼을 영영 꺼낼 수 없었음 —
  // 2026-07-18 모바일 버그). moveToolbarButton 은 전 영역 배열에서 제거 후 재배치
  // +v1 buttons dual-write 까지 처리하므로 두 편집 경로가 일관된다.
  const registries: ToolbarRegistryEntry[] = groups.map((g) => ({
    area: g.area,
    registry: g.registry,
  }));
  const setPlacement = (id: string, placement: ToolbarButtonPlacement) => {
    const home = registries.find((r) => r.registry.some((b) => b.id === id));
    if (!home) return;
    const slot =
      placement === 'pinned'
        ? ('inline' as const)
        : placement === 'menu'
          ? ('menu' as const)
          : placement === 'hidden'
            ? ('hidden' as const)
            : ('default' as const);
    onChange(moveToolbarButton(registries, value, { id, toArea: home.area, slot }));
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="cfgClassicToolbar"
            checked={!!value.classic}
            onChange={(e) =>
              onChange({ ...value, classic: e.target.checked || undefined })
            }
          />
          <label htmlFor="cfgClassicToolbar" className="text-sm gray-label">
            클래식 툴바 사용 (이전 배치로 되돌리기)
          </label>
        </div>
        <p className="text-xs text-faint mt-1 ml-6">
          켜면 모든 버튼을 예전처럼 툴바에 나란히 표시합니다(⋯ 메뉴·아래 개별
          설정 무시). 이 설정은 저장 시 반영됩니다.
        </p>
      </div>

      <div className={value.classic ? 'opacity-50 pointer-events-none' : ''}>
        {groups.map((group) => (
          <div key={group.title} className="mb-3">
            <div className="text-sm font-semibold text-default mb-1.5">
              {group.title}
            </div>
            <div className="space-y-1">
              {group.registry
                .filter((b) => !(mobileMode && b.pcOnly))
                .map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <span className="text-sm text-body flex-1 min-w-0 truncate">
                      {b.name}
                    </span>
                    <select
                      className="gray-input text-sm py-1 px-2 flex-none"
                      value={value.buttons?.[b.id] ?? 'default'}
                      onChange={(e) =>
                        setPlacement(
                          b.id,
                          e.target.value as ToolbarButtonPlacement,
                        )
                      }
                    >
                      <option value="default">
                        기본 ({defaultPlaceLabel(b, mobileMode)})
                      </option>
                      <option value="pinned">툴바 고정</option>
                      <option value="menu">⋯ 메뉴로</option>
                      <option value="hidden">숨김</option>
                    </select>
                  </div>
                ))}
            </div>
          </div>
        ))}
        <button
          className="round-button back-gray btn-sm"
          onClick={() => onChange({ classic: value.classic })}
        >
          버튼 배치 초기화
        </button>
        <p className="text-xs text-faint mt-1">
          위 개별 설정과 화면에서 직접 옮긴 버튼 순서까지 모두 기본 배치로
          되돌립니다. (저장 시 반영)
        </p>
      </div>
    </div>
  );
};

export default ToolbarLayoutEditor;
