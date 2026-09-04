import fs from 'fs';
import path from 'path';

describe('ProjectDrawer 닫힘 상태 성능 가드', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../componenets/ProjectDrawer.tsx'),
    'utf8',
  );

  test('닫힌 동안 프로젝트 목록과 폴더 목록을 계산하지 않는다', () => {
    expect(source).toContain('const sessionNames = render');
    expect(source).toContain('? templateService.filterVisibleProjects(sessionService.list())');
    expect(source).toContain('const folders = render ? sessionService.getOrderedFolders() : [];');
  });

  test('목록·큐·모바일 터치 구독은 render 생명주기를 따른다', () => {
    expect(source).toMatch(
      /if \(!render\) return;[\s\S]*sessionService\.addEventListener\('listupdated'/,
    );
    expect(source).toMatch(
      /if \(!render \|\| !isMobile\) return;[\s\S]*document\.addEventListener\('touchstart'/,
    );
    expect(source).toMatch(
      /if \(!render\) return;[\s\S]*taskQueueService\.addEventListener\('progress'/,
    );
  });
});
