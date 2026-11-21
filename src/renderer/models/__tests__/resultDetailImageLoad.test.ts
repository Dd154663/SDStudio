// 이미지 상세 보기(ResultDetailView) 불러오기 결함 수정(2026-11-21) 회귀 검사.
// ① 목록 배열만 새로 만들어지면(생성 중 'updated') 같은 이미지를 다시 읽고 비우지 않는다
// ② 캐시 무효화는 보고 있는 이미지 것일 때만 다시 읽는다(판정 = 순수 함수)
// ③ 늦게 온 응답(이전 이미지·겹친 요청)은 상태를 건드리지 않는다
// 컴포넌트가 매우 커서 렌더 대신 판정 함수 단위 테스트 + 소스 검사형.
import * as fs from 'fs';
import * as path from 'path';
import {
  isImageCacheInvalidationFor,
  normalizeImageEventPath,
} from '../imageCacheInvalidation';

describe('isImageCacheInvalidationFor — 보고 있는 이미지 것인가', () => {
  const viewing = 'workspace/p1/outs/씬 1/12_34.png';

  test('단건 detail.path 가 같으면 참, 다르면 거짓', () => {
    expect(isImageCacheInvalidationFor({ path: viewing }, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ path: 'workspace/p1/outs/씬 1/99.png' }, viewing)).toBe(false);
    // 같은 이름의 다른 씬 이미지는 아님
    expect(isImageCacheInvalidationFor({ path: 'workspace/p1/outs/씬 2/12_34.png' }, viewing)).toBe(false);
  });

  test('일괄 detail.paths 에 들어 있으면 참(path 가 첫 항목이 아니어도)', () => {
    expect(
      isImageCacheInvalidationFor({ path: 'a/b.png', paths: ['a/b.png', viewing] }, viewing),
    ).toBe(true);
    expect(
      isImageCacheInvalidationFor({ path: 'a/b.png', paths: ['a/b.png', 'a/c.png'] }, viewing),
    ).toBe(false);
  });

  test('detail 이 없거나 경로 정보가 없으면 안전하게 다시 읽는다(참)', () => {
    expect(isImageCacheInvalidationFor(undefined, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor(null, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({}, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ path: 42 }, viewing)).toBe(true);
  });

  test('표기 차이(역슬래시·./·앞 슬래시·NFD)는 같은 이미지로 본다', () => {
    expect(isImageCacheInvalidationFor({ path: viewing.replace(/\//g, '\\') }, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ path: './' + viewing }, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ path: '/' + viewing }, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ path: viewing.normalize('NFD') }, viewing)).toBe(true);
    expect(isImageCacheInvalidationFor({ paths: [viewing.normalize('NFD')] }, viewing)).toBe(true);
  });

  test('보고 있는 경로가 없으면 다시 읽지 않는다', () => {
    expect(isImageCacheInvalidationFor({ path: viewing }, undefined)).toBe(false);
    expect(isImageCacheInvalidationFor(undefined, '')).toBe(false);
  });

  test('normalizeImageEventPath', () => {
    expect(normalizeImageEventPath('.\\outs\\a\\\\b.png')).toBe('outs/a/b.png');
    expect(normalizeImageEventPath('outs/a/b.png')).toBe('outs/a/b.png');
  });
});

describe('ResultDetailView 소스 — 불러오기 effect 분리', () => {
  const src = fs
    .readFileSync(path.resolve(__dirname, '../../componenets/ResultViewer.tsx'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = src.indexOf('const ResultDetailView = observer(');
  const view = src.slice(start, src.indexOf('const [showPrompt, setShowPrompt]', start));

  test('이미지 불러오기 effect 는 보고 있는 경로 문자열과 다시 시도 번호에만 의존한다', () => {
    expect(view).toMatch(/const currentImagePath = paths\[selectedIndex\];/);
    expect(view).toMatch(/\}, \[currentImagePath, imageRetryRevision\]\);/);
    // 불러오기와 목록 배열이 같은 의존성에 묶이지 않는다
    expect(view).not.toMatch(/\[selectedIndex, paths, imageRetryRevision\]/);
    const loadEffect = view.slice(view.indexOf('const fetchImage = async'), view.indexOf('[currentImagePath, imageRetryRevision]'));
    expect(loadEffect).not.toMatch(/paths\[selectedIndex\]/);
  });

  test('무효화 리스너는 판정 함수를 거친다(무관한 이미지 무효화에 다시 읽지 않음)', () => {
    expect(view).toMatch(/isImageCacheInvalidationFor\(\s*\(e as CustomEvent\)\.detail,\s*imagePath,?\s*\)/);
    expect(view).not.toMatch(/addEventListener\('image-cache-invalidated', fetchImage\)/);
    expect(view).toMatch(/addEventListener\('image-cache-invalidated', onImageInvalidated\)/);
  });

  test('모든 await 뒤와 비동기 콜백에서 최신 요청인지 확인한다', () => {
    const loadEffect = view.slice(view.indexOf('const fetchImage = async'), view.indexOf('[currentImagePath, imageRetryRevision]'));
    expect(loadEffect).toMatch(/const requestId = \+\+imageRequestRef\.current;/);
    expect(loadEffect).toMatch(/await imageService\.fetchImage\(imagePath\);\n\s*if \(isStale\(\)\) return;/);
    expect(loadEffect).toMatch(/await extractPromptDataFromBase64\(base64Image\);\n\s*if \(isStale\(\)\) return;/);
    expect(loadEffect).toMatch(/\.then\(\(\{ width, height \}\) => \{\n\s*if \(isStale\(\)\) return;/);
    expect(loadEffect).toMatch(/\.catch\(\(e\) => \{\n\s*if \(isStale\(\)\) return;/);
    // 바깥·안쪽 catch 모두
    expect((loadEffect.match(/\} catch \(e: any\) \{\n\s*if \(isStale\(\)\) return;/g) || []).length).toBe(2);
    // effect 정리 때 무효화
    expect(loadEffect).toMatch(/return \(\) => \{\n\s*imageRequestRef\.current\+\+;/);
    // 예전 단일 cancelled 표식은 쓰지 않는다
    expect(loadEffect).not.toMatch(/cancelled/);
  });

  test('리스너 effect 는 여전히 [selectedIndex, paths] 에 묶이고 refreshPaths·filenameRef 는 그대로', () => {
    expect(view).toMatch(/\}, \[selectedIndex, paths\]\);/);
    expect(view).toMatch(/gameService\.addEventListener\('updated', refreshPaths\)/);
    expect(view).toMatch(/filenameRef\.current,\n\s*\);/);
    // 목록이 줄어드는 사이 경로가 비어도 예외 없음
    expect(view).toMatch(/paths\[selectedIndex\]\?\.split\('\/'\)\.pop\(\)/);
  });
});
