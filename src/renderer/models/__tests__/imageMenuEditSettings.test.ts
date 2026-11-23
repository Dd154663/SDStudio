// 이미지 우클릭 메뉴 「이미지 편집」(PC)·「생성 설정 적용」(PC·모바일) + 상세 보기 해상도 칸(2026-11-22) — 소스 검사.
import fs from 'fs';
import path from 'path';

const read = (f: string) =>
  fs.readFileSync(path.join(__dirname, '../../componenets', f), 'utf8').replace(/\r\n/g, '\n');

describe('AppContextMenu — 이미지 메뉴 세 종에 두 항목', () => {
  const src = read('AppContextMenu.tsx');
  const menuOf = (type: string) => {
    const s = src.indexOf(`<Menu id={ContextMenuType.${type}}`);
    return src.slice(s, src.indexOf('</Menu>', s));
  };

  test.each([
    ['GallaryImage', 'handleImageItemClick2'],
    ['Image', 'handleImageItemClick'],
    ['HistoryImage', 'handleHistoryItemClick'],
  ])('%s 메뉴: 이미지 편집 = PC 전용·edit 아이콘, 생성 설정 적용 = 게이트 없음·gen-settings 아이콘', (type, handler) => {
    const menu = menuOf(type);
    const edit = menu.indexOf('<Item id="image-edit"');
    const settings = menu.indexOf('<Item id="image-settings"');
    expect(edit).toBeGreaterThan(0);
    expect(settings).toBeGreaterThan(edit);
    // 이미지 편집은 {!isMobile && ( 안
    expect(menu.slice(edit - 40, edit)).toMatch(/\{!isMobile && \(\s*$/);
    // 생성 설정 적용은 게이트 없이(모바일 길게 누르기 메뉴에도)
    expect(menu.slice(settings - 40, settings)).not.toMatch(/isMobile/);
    expect(menu).toContain(`<Item id="image-edit" onClick={${handler}}`);
    expect(menu).toContain(`<Item id="image-settings" onClick={${handler}}`);
    expect(menu).toContain('<MenuItemLabel icon={<ActionIcon id="edit" size={I} />}>이미지 편집</MenuItemLabel>');
    expect(menu).toContain('<MenuItemLabel icon={<ActionIcon id="gen-settings" size={I} />}>생성 설정 적용</MenuItemLabel>');
    // 자리: 「파일 탐색기에서 열기」 바로 뒤
    expect(menu.indexOf('<Item id="reveal"')).toBeLessThan(edit);
  });

  test('그리드 선택 메뉴는 한 장일 때만 보인다', () => {
    const menu = menuOf('GallaryImage');
    expect(menu).toMatch(/<Item id="image-edit" onClick=\{handleImageItemClick2\} hidden=\{\(p\) => !singleGalleryPath\(p\)\}>/);
    expect(menu).toMatch(/<Item id="image-settings" onClick=\{handleImageItemClick2\} hidden=\{\(p\) => !singleGalleryPath\(p\)\}>/);
    expect(src).toMatch(/Array\.isArray\(props\?\.ctx\?\.path\) && props\.ctx\.path\.length === 1/);
  });

  test('동작 = 상세 보기와 같은 경로(편집기 열기 → 감시, 외부 이미지 창), 실패는 알림', () => {
    const edit = src.slice(src.indexOf('const openImageInEditor'), src.indexOf('const openImageSettings'));
    expect(edit).toMatch(/await backend\.openImageEditor\(path\);/);
    expect(edit).toMatch(/backend\.watchImage\(path\)/);
    expect(edit.indexOf('openImageEditor')).toBeLessThan(edit.indexOf('watchImage'));
    expect(edit).toMatch(/appState\.pushMessage\([^)]*'error'\)/);
    const settings = src.slice(src.indexOf('const openImageSettings'), src.indexOf('const singleGalleryPath'));
    expect(settings).toMatch(/await imageService\.fetchImage\(path\)/);
    expect(settings).toMatch(/appState\.openExternalImage\(dataUriToBase64\(image\), scene\)/);
    expect(settings).toMatch(/appState\.pushMessage\('이미지를 읽지 못했습니다\.', 'error'\)/);
    // 히스토리는 지금 프로젝트 씬일 때만 씬 맥락을 넘긴다
    expect(src).toMatch(/resolved\.session === appState\.curSession\) scene = resolved\.scene/);
  });
});

describe('AppContextMenu — 히스토리 이미지 메뉴 「글로벌 프리셋으로 복사」(2026-11-22)', () => {
  const src = read('AppContextMenu.tsx');
  const menuOf = (type: string) => {
    const s = src.indexOf(`<Menu id={ContextMenuType.${type}}`);
    return src.slice(s, src.indexOf('</Menu>', s));
  };
  const LABEL = '<MenuItemLabel icon={<ActionIcon id="copy-to-global" size={I} />}>글로벌 프리셋으로 복사</MenuItemLabel>';

  test('그리드·이미지 메뉴와 같은 이름·아이콘, 게이트 없음(PC·모바일), 자리 = 「생성 설정 적용」 뒤 구분선 다음·삭제 앞', () => {
    const grid = menuOf('GallaryImage');
    expect(grid).toContain(LABEL);
    const menu = menuOf('HistoryImage');
    const item = menu.indexOf('<Item id="save-global" onClick={handleHistoryItemClick}>');
    expect(item).toBeGreaterThan(0);
    expect(menu).toContain(LABEL);
    expect(menu.slice(item - 200, item)).not.toMatch(/isMobile/);
    const settings = menu.indexOf('<Item id="image-settings"');
    const between = menu.slice(settings, item);
    expect(between).toContain('<Separator />');
    expect(item).toBeLessThan(menu.indexOf('<Item id="delete"'));
    // 그리드에서도 「생성 설정 적용」 다음 구분선 뒤
    expect(grid.indexOf('<Item id="image-settings"')).toBeLessThan(grid.indexOf('<Item id="save-global"'));
  });

  test('동작 = 그리드 메뉴와 같은 saveImageAsGlobalPreset(→ appState.saveImageAsGlobalPreset)', () => {
    const handler = src.slice(src.indexOf('const handleHistoryItemClick'), src.indexOf('const historyImageSettings'));
    expect(handler).toMatch(/id === 'save-global'\) \{[\s\S]*?saveImageAsGlobalPreset\(\{ path: ctx\.entry\.path \}\);/);
    const grid = src.slice(src.indexOf('const handleImageItemClick2'), src.indexOf('const exportStyle'));
    expect(grid).toContain('saveImageAsGlobalPreset(props.ctx);');
    const fn = src.slice(src.indexOf('const saveImageAsGlobalPreset'), src.indexOf('const saveImageToArtistLibrary'));
    expect(fn).toContain('await appState.saveImageAsGlobalPreset(path);');
    expect(fn).toMatch(/Array\.isArray\(ctx\.path\) \? ctx\.path\[0\] : ctx\.path/);
  });
});

describe('「이미지 편집」 호출부 — 실패는 알림, 감시는 성공했을 때만(2026-11-22)', () => {
  test.each([
    ['ResultViewer.tsx', 'await backend.openImageEditor(editPath);', 'backend.watchImage(editPath);'],
    ['PreSetEdtior.tsx', 'await backend.openImageEditor(path);', 'backend.watchImage(path);'],
  ])('%s', (file, open, watch) => {
    const src = read(file);
    const at = src.indexOf(open);
    expect(at).toBeGreaterThan(0);
    const block = src.slice(src.lastIndexOf('try {', at), src.indexOf(watch, at) + watch.length);
    expect(block).toMatch(/\} catch \(e: any\) \{\n\s*appState\.pushMessage\(e\?\.message \|\| '이미지 편집기를 열지 못했습니다\.', 'error'\);\n\s*return;\n\s*\}/);
    expect(block.indexOf('return;')).toBeLessThan(block.indexOf(watch));
  });
});

describe('ResultDetailView — 해상도 칸', () => {
  const src = read('ResultViewer.tsx');
  const start = src.indexOf('const ResultDetailView = observer(');
  const view = src.slice(start);

  // 2026-11-22 상세 보기 개편: 해상도는 정보 칸의 요약 칩(메타 없으면 파일 묶음)으로 옮김 — 표기·숨김은 imageDetailInfo.test.ts.
  // 여기서는 「실제 파일 픽셀 측정값을, 보고 있는 정보와 같은 경로일 때만」 넘기는지만 고정한다.
  test('해상도 = 실제 파일 픽셀 측정값(경로가 같을 때만 넘김, 모르면 칸 없음)', () => {
    expect(view).toMatch(/pixel: imageSize && imageSize\.path === meta\.path \? imageSize : undefined,/);
  });

  test('불러오기마다 비우고, 측정값은 최신 요청일 때만(getImageDimensions 재사용)', () => {
    const load = view.slice(view.indexOf('const fetchImage = async'), view.indexOf('[currentImagePath, imageRetryRevision]'));
    expect(load).toMatch(/setUpscaleInfo\(undefined\);\n\s*setImageSize\(undefined\);/);
    expect(load).toMatch(/\.then\(\(\{ width, height \}\) => \{\n\s*if \(isStale\(\)\) return;[\s\S]*?setImageSize\(\{ path: upscalePath, width, height \}\);/);
  });

  test('PC 넓은 폭(프롬프트 열·상세 열)·좁은 폭·모바일 V2 모두 같은 정보 칸(renderInfo)을 쓴다', () => {
    // 2026-11-23 열 배치: PC 는 프롬프트 열('prompt', 합치면 'all')·상세 열('detail'), 좁은 폭·V2 는 한 열 전부('all')
    expect((view.match(/\{renderInfo\(wideCols\.merged \? 'all' : 'prompt'\)\}/g) || []).length).toBe(1);
    expect((view.match(/\{renderInfo\('detail'\)\}/g) || []).length).toBe(1);
    expect((view.match(/\{renderInfo\('all'\)\}/g) || []).length).toBe(2);
  });
});
