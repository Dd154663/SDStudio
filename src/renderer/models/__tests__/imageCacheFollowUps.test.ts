// 2026-11-21 작은 수정 3건 회귀 검사.
// ① 환경설정 「외부 편집 반영」 문구(옛 라벨이 UI 에 남지 않음)
// ② 이미지 그리드가 image-cache-invalidated 를 하나의 리스너로 듣고 그 경로의 칸만 다시 읽음
// ③ 「이미지 캐시 초기화」가 이미지생성 씬·변형 씬의 fastcache 만 지움
import * as fs from 'fs';
import * as path from 'path';
import {
  imageCacheInvalidationPaths,
  pickInvalidatedEntries,
} from '../imageCacheInvalidation';
import { collectProjectFastcacheDirs } from '../imageCacheClear';

const readComp = (name: string) =>
  fs
    .readFileSync(path.resolve(__dirname, '../../componenets', name), 'utf8')
    .replace(/\r\n/g, '\n');

describe('① 외부 편집 반영 문구', () => {
  const src = readComp('ConfigStorageTab.tsx');

  test('새 묶음 제목·라벨·설명이 기존 SettingCheckRow description 으로 붙는다', () => {
    expect(src).toContain('<SettingGroup title="외부 편집 반영">');
    expect(src).toMatch(
      /<SettingCheckRow\s+id="cfgRefresh"[\s\S]*?label="밖에서 고친 이미지 자동 반영"\s+description="탐색기나 외부 편집기로 이미 있는 이미지를 고쳐 저장하면 화면에 다시 반영합니다\. 파일을 넣거나 지우거나 이름을 바꾼 것, 폴더를 옮긴 것은 감지하지 않습니다\. 켜거나 끈 뒤 앱을 다시 시작해야 적용됩니다\."/,
    );
  });

  test('옛 라벨은 UI 코드에 남지 않는다', () => {
    const dir = path.resolve(__dirname, '../../componenets');
    for (const f of fs.readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(s).not.toContain('이미지 폴더 직접 편집 감지');
      expect(s).not.toContain('title="폴더 변경 감지"');
    }
  });
});

describe('② 그리드 무효화 — 경로 매칭', () => {
  const a = 'workspace/p1/outs/씬 1/1.png';
  const b = 'workspace/p1/inpaints/변형/2.png';
  const registry = new Map<string, string>([
    [a, 'A'],
    [b, 'B'],
  ]);

  test('단건·일괄 detail 에서 등록된 경로의 값만 고른다', () => {
    expect(pickInvalidatedEntries(registry, { path: a })).toEqual(['A']);
    expect(pickInvalidatedEntries(registry, { path: 'x/y.png', paths: ['x/y.png', b] })).toEqual(['B']);
    expect(pickInvalidatedEntries(registry, { path: a, paths: [a, b] })).toEqual(['A', 'B']);
  });

  test('등록되지 않은 경로·경로 없는 detail 은 아무것도 고르지 않는다(전체 다시 읽기 없음)', () => {
    expect(pickInvalidatedEntries(registry, { path: 'workspace/p1/outs/씬 2/1.png' })).toEqual([]);
    expect(pickInvalidatedEntries(registry, undefined)).toEqual([]);
    expect(pickInvalidatedEntries(registry, null)).toEqual([]);
    expect(pickInvalidatedEntries(registry, {})).toEqual([]);
    expect(pickInvalidatedEntries(registry, { path: 42 })).toEqual([]);
    expect(pickInvalidatedEntries(new Map(), { path: a })).toEqual([]);
  });

  test('표기 차이(역슬래시·./·NFD)는 정규화해 찾는다', () => {
    expect(pickInvalidatedEntries(registry, { path: a.replace(/\//g, '\\') })).toEqual(['A']);
    expect(pickInvalidatedEntries(registry, { path: './' + a })).toEqual(['A']);
    expect(pickInvalidatedEntries(registry, { paths: [b.normalize('NFD')] })).toEqual(['B']);
  });

  test('imageCacheInvalidationPaths 는 중복·빈 값을 뺀다', () => {
    expect(imageCacheInvalidationPaths({ path: a, paths: [a, '', b, 3] })).toEqual([a, b]);
    expect(imageCacheInvalidationPaths(undefined)).toEqual([]);
  });
});

describe('② 그리드 소스 — 리스너 하나, 칸은 마지막 요청만 반영', () => {
  const src = readComp('ResultViewer.tsx');
  const galleryStart = src.indexOf('const ImageGallery = forwardRef');
  const gallery = src.slice(
    galleryStart,
    src.indexOf('const resizeObserver = new ResizeObserver', galleryStart),
  );
  const cell = src.slice(src.indexOf('const Cell = memo('), src.indexOf('const CustomScrollbarsVirtualGrid'));

  test('그리드가 image-cache-invalidated 를 듣고 등록표에서 그 경로의 칸만 다시 읽는다', () => {
    expect(gallery).toMatch(
      /pickInvalidatedEntries\(\s*refreshImageFuncs\.current,\s*\(e as CustomEvent\)\.detail,?\s*\)/,
    );
    expect(gallery).toMatch(/imageService\.addEventListener\('image-cache-invalidated', onInvalidated\)/);
    expect(gallery).toMatch(/imageService\.removeEventListener\('image-cache-invalidated', onInvalidated\)/);
    // 무효화에 전체 칸을 다시 읽지 않는다
    const listener = gallery.slice(gallery.indexOf('const onInvalidated'), gallery.indexOf("addEventListener('image-cache-invalidated'"));
    expect(listener).not.toMatch(/forEach/);
    // 무효화 다시 읽기는 읽기 실패 때 이전 그림을 둔다(WebP 변환·휴지통 이동 중 빈 칸 방지)
    expect(listener).toMatch(/refresh\(\{ keepOnError: true \}\)/);
  });

  test('칸마다 무효화 리스너를 달지 않는다', () => {
    expect(cell).not.toMatch(/image-cache-invalidated/);
  });

  test('칸의 다시 읽기는 마지막 요청만 반영하고 이전 그림을 비우지 않는다', () => {
    expect(cell).toMatch(/const seq = \+\+requestSeq;/);
    expect((cell.match(/if \(cancelled \|\| seq !== requestSeq\) return;/g) || []).length).toBe(2);
    expect(cell).toMatch(/if \(opts\?\.keepOnError\) return;\n\s*setImage\(undefined\);/);
    // 원본이 없어 null 이 돌아온 경우도 이전 그림을 둔다(fetchImageSmall 은 이때 던지지 않는다)
    expect(cell).toMatch(/if \(!base64Image && opts\?\.keepOnError\) return;\n\s*setImage\(base64Image!\);/);
    const refresh = cell.slice(cell.indexOf('const refreshImage = async'), cell.indexOf('const dispose = reaction'));
    // await 앞에서 그림을 비우지 않는다(깜빡임 없음)
    expect(refresh.slice(0, refresh.indexOf('await'))).not.toMatch(/setImage\(/);
  });
});

describe('③ 이미지 캐시 초기화 대상', () => {
  const scene = (type: 'scene' | 'inpaint', name: string) => ({ type, name }) as any;
  const session = {
    getScenes: (type: 'scene' | 'inpaint') =>
      type === 'scene'
        ? [scene('scene', '씬 1'), scene('scene', '나쁜')]
        : [scene('inpaint', '변형 1')],
  };
  const outputDir = (s: any) => {
    if (s.name === '나쁜') throw new Error('잘못된 경로 세그먼트');
    return (s.type === 'scene' ? 'workspace/p/outs/' : 'workspace/p/inpaints/') + s.name;
  };

  test('이미지생성 씬·변형 씬의 fastcache 가 들고, 관문이 던진 씬만 건너뛴다', () => {
    expect(collectProjectFastcacheDirs(session, outputDir)).toEqual([
      'workspace/p/outs/씬 1/fastcache',
      'workspace/p/inpaints/변형 1/fastcache',
    ]);
  });

  test('돌려주는 경로는 모두 fastcache 폴더(빈 폴더 경로는 버림)', () => {
    const dirs = collectProjectFastcacheDirs(
      { getScenes: (t) => (t === 'scene' ? [scene('scene', 'a'), scene('scene', 'b')] : []) },
      (s: any) => (s.name === 'a' ? '' : 'workspace/p/outs/b/'),
    );
    expect(dirs).toEqual(['workspace/p/outs/b/fastcache']);
    for (const d of dirs) expect(d.endsWith('/fastcache')).toBe(true);
  });

  test('ConfigScreen 은 Map 을 Object.values 로 훑지 않고 공용 목록을 지운다', () => {
    const src = readComp('ConfigScreen.tsx');
    expect(src).not.toMatch(/Object\.values\(curSession\.scenes\)/);
    const fn = src.slice(src.indexOf('const clearImageCache = async'), src.indexOf("'이미지 캐시 초기화 완료'"));
    expect(fn).toMatch(/collectProjectFastcacheDirs\(session, \(scene\) =>\s*imageService\.getOutputDir\(session, scene\),?\s*\)/);
    expect(fn).toMatch(/await backend\.deleteDir\(dir\);/);
    expect(fn).toContain("'이미지 캐시 초기화 시작'");
  });
});
