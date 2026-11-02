import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Exercise the actual dropdown click handler without initializing the application's
// full editor/service graph. AST selection keeps the fixture tied to the UI button.
test('A 활성 중 B의 그림체 복제는 B 내용과 이름을 사용하며 활성 선택은 유지한다', () => {
  const source = ts.createSourceFile('PreSetEdtior.tsx', fs.readFileSync(
    path.join(__dirname, '../../componenets/PreSetEdtior.tsx'), 'utf8',
  ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(a =>
      ts.isJsxAttribute(a) && a.name.getText(source) === 'content' &&
      a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text === '그림체 복제',
    )) {
      const button = node.children.find(ts.isJsxElement)!;
      const attr = button.openingElement.attributes.properties.find(a =>
        ts.isJsxAttribute(a) && a.name.getText(source) === 'onClick',
      ) as ts.JsxAttribute;
      expression = (attr.initializer as ts.JsxExpression).expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(expression).toBeDefined();
  const preset = { name: 'A', toJSON: () => ({ name: 'A', prompt: 'A prompt' }) };
  const option = { name: 'B', toJSON: () => ({ name: 'B', prompt: 'B prompt', refs: [{ strength: 0.5 }] }) };
  const presets: any[] = [preset, option, { name: 'B copy 1' }];
  const curSession = { selectedWorkflow: { presetName: 'A' }, addPreset: jest.fn(p => presets.push(p)) };
  const workFlowService = { presetFromJSON: jest.fn(data => JSON.parse(JSON.stringify(data))) };
  const code = ts.transpileModule(`return (${expression!.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  // 되돌리기 기록(U3b, editPresetList)은 감싸기만 — 여기서는 복제 대상·이름 계산을 본다
  const editPresetList = jest.fn((_s: unknown, _label: string, fn: () => unknown) => fn());
  const UNDO_TEXT = { presetDuplicate: (n: string) => `dup ${n}` };
  const handler = new Function('preset', 'option', 'presets', 'curSession', 'workFlowService', 'editPresetList', 'UNDO_TEXT', code)(
    preset, option, presets, curSession, workFlowService, editPresetList, UNDO_TEXT,
  );
  const stopPropagation = jest.fn();
  handler({ stopPropagation });
  expect(curSession.addPreset).toHaveBeenLastCalledWith({ name: 'B copy 2', prompt: 'B prompt', refs: [{ strength: 0.5 }] });
  handler({ stopPropagation });
  expect(curSession.addPreset.mock.calls[1][0].name).toBe('B copy 3');
  expect(curSession.selectedWorkflow.presetName).toBe('A');
  expect(option.name).toBe('B');
  expect(stopPropagation).toHaveBeenCalledTimes(2);
  expect(editPresetList).toHaveBeenLastCalledWith(curSession, 'dup B copy 3', expect.any(Function));
});
