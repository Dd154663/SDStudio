import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const queueWorkflow = jest.fn(async () => {});
const queueI2IWorkflow = jest.fn(async () => {});
const capture = jest.fn(async () => ({ model: 'snapshot' }));
const batch = jest.fn(async (run: () => Promise<void>) => run());
const state = { samples: 2, selectedScenes: new Set<string>(), pushMessage: jest.fn(), pushDialog: jest.fn() };
const outputs = jest.fn((_session: any, scene: any) => scene.outputs);
jest.mock('..', () => ({
  imageService: { getOutputs: outputs },
  taskQueueService: { captureGenerationSnapshot: capture, withProgressBatch: batch },
  promptService: { findMissingPieces: () => [] },
}));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../TaskQueueService', () => ({ queueWorkflow, queueI2IWorkflow }));
jest.mock('../PromptService', () => ({}));
jest.mock('../types', () => ({}));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove() {} }) } }));
import { addScenesToQueue } from '../sceneQueueActions';
import SceneQueueMenu from '../../componenets/SceneQueueMenu';

let scenes: any[];
let session: any;
beforeEach(() => {
  jest.clearAllMocks();
  state.selectedScenes.clear();
  scenes = [
    { name: 'empty', type: 'scene', outputs: [], mains: [] },
    { name: 'ordinary', type: 'scene', outputs: ['a.png'], mains: [] },
    { name: 'favorite', type: 'scene', outputs: ['b.png'], mains: ['b.png'] },
  ];
  session = { name: 'project', getScenes: jest.fn(() => scenes), selectedWorkflow: 'workflow' };
});

test.each([
  ['all', ['empty', 'ordinary', 'favorite']],
  ['empty', ['empty']],
  ['no-favorites', ['empty', 'ordinary']],
] as const)('%s uses the shared snapshot and batch only for matching scenes', async (filter, names) => {
  await addScenesToQueue(session, 'scene', false, filter);
  expect(queueWorkflow.mock.calls.map((args: any) => args[2].name)).toEqual(names);
  expect(capture).toHaveBeenCalledTimes(1);
  expect(batch).toHaveBeenCalledTimes(1);
});
test('selection intersects the condition and empty matches do not capture or queue', async () => {
  state.selectedScenes.add('favorite');
  await addScenesToQueue(session, 'scene', true, 'no-favorites');
  expect(queueWorkflow).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  state.selectedScenes.add('ordinary');
  await addScenesToQueue(session, 'scene', true, 'no-favorites');
  expect(queueWorkflow).toHaveBeenCalledTimes(1);
  expect((queueWorkflow.mock.calls[0] as any)[2].name).toBe('ordinary');
});
test('inpaint filtering uses output images, not the input image', async () => {
  scenes = [{ name: 'paint', type: 'inpaint', workflowType: 'test', preset: { image: 'input' }, outputs: [], mains: [] }];
  await addScenesToQueue(session, 'inpaint', false, 'empty');
  expect(queueI2IWorkflow).toHaveBeenCalledTimes(1);
  expect(session.getScenes).toHaveBeenCalledWith('inpaint');
});
test('hover does not open; arrow opens options; option reserves once; Escape closes', async () => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SceneQueueMenu session={session} type="scene" selectedOnly={false}><button>calendar</button></SceneQueueMenu>));
    const hover = new Event('pointerover', { bubbles: true });
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
    await act(async () => container.querySelector('span')!.dispatchEvent(hover));
    expect(document.querySelector('[aria-label="부분 일괄 예약"]')).toBeNull();
    await act(async () => (container.querySelector('[aria-label="부분 일괄 예약 옵션"]') as HTMLButtonElement).click());
    expect(document.querySelector('[aria-label="부분 일괄 예약"]')).not.toBeNull();
    expect(queueWorkflow).not.toHaveBeenCalled();
    const option = document.querySelector('[aria-label="부분 일괄 예약"] button') as HTMLButtonElement;
    await act(async () => option.click());
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    const toggle = container.querySelector('[aria-label="부분 일괄 예약 옵션"]') as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(document.activeElement?.textContent).toBe('빈 씬만 일괄 예약');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[aria-label="부분 일괄 예약"]')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
