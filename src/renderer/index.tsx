import { createRoot } from 'react-dom/client';

import { App } from './componenets/App';
import { bootstrapApp } from './models/bootstrap';

// 명시적 부트 시퀀스 시작 — App 은 appState.bootReady 로 완료를 감지해 메인 UI 를 연다.
// (bootstrapApp 은 내부에서 실패를 격리하므로 여기서 reject 되지 않는다)
void bootstrapApp();

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
