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

describe('ResultDetailView — 해상도 칸', () => {
  const src = read('ResultViewer.tsx');
  const start = src.indexOf('const ResultDetailView = observer(');
  const view = src.slice(start);

  test('시드와 해상도가 한 줄 두 열(좁으면 한 열), 값은 tabular-nums·모르면 「-」', () => {
    const row = view.slice(view.indexOf('data-detail-seed-resolution'), view.indexOf('프롬프트 가이던스: '));
    expect(view).toContain('grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4');
    expect(row.indexOf('시드: ')).toBeLessThan(row.indexOf('해상도: '));
    expect(row).toContain('<span className="tabular-nums">');
    expect(row).toMatch(/imageSize && imageSize\.path === currentImagePath\s*\? `\$\{imageSize\.width\} × \$\{imageSize\.height\}`\s*: '-'/);
  });

  test('불러오기마다 비우고, 측정값은 최신 요청일 때만(getImageDimensions 재사용)', () => {
    const load = view.slice(view.indexOf('const fetchImage = async'), view.indexOf('[currentImagePath, imageRetryRevision]'));
    expect(load).toMatch(/setUpscaleInfo\(undefined\);\n\s*setImageSize\(undefined\);/);
    expect(load).toMatch(/\.then\(\(\{ width, height \}\) => \{\n\s*if \(isStale\(\)\) return;[\s\S]*?setImageSize\(\{ path: upscalePath, width, height \}\);/);
  });

  test('PC·모바일 V2 모두 같은 infoFields 를 쓴다', () => {
    expect((view.match(/\{infoFields\}/g) || []).length).toBe(2);
  });
});
