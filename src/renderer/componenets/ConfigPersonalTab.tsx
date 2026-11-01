// 설정 화면 탭: 커스텀(key 'personal', 라벨 「커스텀」) — PersonalTab

/* ── 탭: 커스텀 (취향 토글, 2026-10-01 라벨 「개인 설정」→「커스텀」) ── */
// 앱 글꼴 선택지 — id 는 config 저장 키(uiFont)라 배포 후 불변. preview 는 각
// 선택지 라벨을 해당 글꼴로 렌더해 고르기 전에 차이를 눈으로 보게 한다.
const appFonts: { id: 'pretendard' | 'system'; name: string; family: string }[] = [
  { id: 'system', name: '시스템 기본', family: "'Noto Sans KR', sans-serif" },
  {
    id: 'pretendard',
    name: 'Pretendard',
    family: "'Pretendard Variable', 'Noto Sans KR', sans-serif",
  },
];

const PersonalTab = ({
  classicSceneCard, setClassicSceneCard,
  fullWordAc, setFullWordAc,
  legacyProjectMode, setLegacyProjectMode,
  legacySceneEditor, setLegacySceneEditor,
  legacyWorkflowMode, setLegacyWorkflowMode,
  sceneToolbarLegacyText, setSceneToolbarLegacyText,
  uiFont, setUiFont,
  uiClassicFinish, setUiClassicFinish,
  uiPillButtons, setUiPillButtons,
  allowDuplicateProjectOpen, setAllowDuplicateProjectOpen,
}: any) => (
  <div className="space-y-4">
    <div>
      <label className="block text-sm gray-label mb-1">글꼴</label>
      <div className="flex flex-wrap gap-2">
        {appFonts.map((f) => {
          const selected = (uiFont ?? 'system') === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setUiFont(f.id)}
              className={
                'px-3 py-1.5 rounded-md border text-sm clickable text-default ' +
                (selected ? 'ring-2 ring-sky-400 border-sky-400' : 'line-color')
              }
              style={{ fontFamily: f.family }}
            >
              {f.name} — 가나다 123
            </button>
          );
        })}
      </div>
      <p className="text-xs text-faint mt-1">
        앱 전체에 쓰이는 글꼴입니다. 저장하면 바로 적용됩니다.
      </p>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgClassicScene" checked={classicSceneCard}
        onChange={(e) => setClassicSceneCard(e.target.checked)} />
      <label htmlFor="cfgClassicScene" className="text-sm gray-label">클래식 씬 카드 디자인 사용</label>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgClassicFinish" checked={uiClassicFinish}
          onChange={(e) => setUiClassicFinish(e.target.checked)} />
        <label htmlFor="cfgClassicFinish" className="text-sm gray-label">클래식 마감 사용</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 테두리·구분선 등 세부 마감을 디자인 개선 이전 모양으로 되돌립니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        {/* 글자 버튼은 항상 알약형, 이 옵션은 아이콘만 있는 작은 버튼(.icon-only)의 반경만 바꾼다.
            클래식 마감이 켜져 있으면 아이콘 버튼도 항상 알약형이라 효과가 없다 — 비활성 표시. */}
        <input type="checkbox" id="cfgPillButtons"
          checked={uiClassicFinish || uiPillButtons}
          disabled={uiClassicFinish}
          onChange={(e) => setUiPillButtons(e.target.checked)} />
        <label htmlFor="cfgPillButtons"
          className={'text-sm gray-label' + (uiClassicFinish ? ' opacity-50' : '')}>
          알약형 버튼
        </label>
        {uiClassicFinish && (
          <span className="text-xs text-faint">클래식 마감에서는 항상 알약형</span>
        )}
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        아이콘만 있는 작은 버튼도 둥근 사각형 대신 알약형으로 표시합니다. 클래식 마감에서는 항상 알약형입니다.
      </p>
    </div>
    <hr className="line-color" />
    <div className="flex items-center gap-2">
      <input type="checkbox" id="cfgFullWordAc" checked={fullWordAc}
        onChange={(e) => setFullWordAc(e.target.checked)} />
      <label htmlFor="cfgFullWordAc" className="text-sm gray-label">자동완성 시 콤마 사이 전체 단어 사용</label>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyProject" checked={legacyProjectMode}
          onChange={(e) => setLegacyProjectMode(e.target.checked)} />
        <label htmlFor="cfgLegacyProject" className="text-sm gray-label">레거시 프로젝트 모드</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 기존 프로젝트 선택 드롭다운을 유지합니다(드로어·드롭다운·그리드 공존). 끄면 드롭다운 대신 드로어 열기 버튼으로 표시됩니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyScene" checked={legacySceneEditor}
          onChange={(e) => setLegacySceneEditor(e.target.checked)} />
        <label htmlFor="cfgLegacyScene" className="text-sm gray-label">레거시 씬 편집 모드</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 씬 에디터 첫 탭(프롬프트 에디터)을 예전 프리셋 형태의 전체 폼으로 표시합니다. 끄면 중간 프롬프트와 씬 전용 네거티브 두 입력만 노출합니다. (조합 에디터·씬 캐릭터 프롬프트·미리보기 탭은 항상 표시)
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgLegacyWorkflow" checked={legacyWorkflowMode}
          onChange={(e) => setLegacyWorkflowMode(e.target.checked)} />
        <label htmlFor="cfgLegacyWorkflow" className="text-sm gray-label">레거시 작업모드 활성화</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 이지모드·이미지 수정 작업모드와 작업모드 선택 드롭다운을 다시 표시합니다. 끄면(기본) 작업모드가 "이미지 생성" 하나로 고정되고 드롭다운이 숨겨집니다. 기존 이지모드 사전설정 데이터는 삭제되지 않습니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgSceneToolbarText" checked={sceneToolbarLegacyText}
          onChange={(e) => setSceneToolbarLegacyText(e.target.checked)} />
        <label htmlFor="cfgSceneToolbarText" className="text-sm gray-label">씬 툴바 텍스트 버튼 사용 (레거시)</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        켜면 PC 씬 툴바 버튼을 예전처럼 텍스트로 표시합니다. 끄면(기본) 아이콘으로 표시되고 이름은 마우스를 올리면 뜹니다. 모바일에는 영향이 없습니다.
      </p>
    </div>
    <hr className="line-color" />
    <div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="cfgAllowDupOpen" checked={allowDuplicateProjectOpen}
          onChange={(e) => setAllowDuplicateProjectOpen(e.target.checked)} />
        <label htmlFor="cfgAllowDupOpen" className="text-sm gray-label">같은 프로젝트 중복 열기 허용 (읽기 전용 미러)</label>
      </div>
      <p className="text-xs text-faint mt-1 ml-6">
        다른 창에서 열린 프로젝트를 읽기 전용 미러로 열 수 있습니다. 미러에서는 열람·비교·생성 예약·이미지 즐겨찾기·이미지 삭제만 가능하고 그 외 편집은 저장되지 않습니다.
      </p>
    </div>
  </div>
);

export default PersonalTab;
