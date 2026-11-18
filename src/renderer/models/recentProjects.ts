// 최근 프로젝트 목록(localStorage) — 프로젝트 탐색 창·서랍·선택 상자·새 프로젝트 만들기 흐름이 함께 쓴다.
// 종전에는 컴포넌트 파일(componenets/ProjectBrowser.tsx)에 있었다. 그 파일은 기존 import 호환을 위해 다시 내보낸다.

const RECENT_KEY = 'sdstudio-recent-projects';
const RECENT_MAX = 5;

export function pushRecentProject(name: string) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    let list: string[] = raw ? JSON.parse(raw) : [];
    list = list.filter((n) => n !== name);
    list.unshift(name);
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
