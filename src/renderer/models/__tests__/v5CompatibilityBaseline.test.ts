jest.mock('..', () => ({
  workFlowService: {
    presetFromJSON: jest.fn((value) => value),
    sharedFromJSON: jest.fn((value) => value),
  },
}));

import legacyProject from './fixtures/nai-v5/legacy-project.json';
import { ISession, Session } from '../types';

const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('NovelAI V5 도입 전 프로젝트 JSON 호환 기준선', () => {
  test('v5.0.5 프로젝트의 기존 필드를 역직렬화 후 다시 보존한다', () => {
    const restored = Session.fromJSON(legacyProject as ISession);

    expect(jsonValue(restored.toJSON())).toEqual(legacyProject);
  });
});
