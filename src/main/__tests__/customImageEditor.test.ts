/**
 * @jest-environment node
 */
// 「사용자 지정」 외부 이미지 편집기 실행(2026-11-22) — 경로 검사와 spawn 인자. 실제 프로그램은 실행하지 않는다
// (spawn·stat 은 모킹만).
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import {
  CUSTOM_IMAGE_EDITOR_ERROR,
  customImageEditorPathProblem,
  launchCustomImageEditor,
} from '../customImageEditor';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { unref: jest.Mock };
  child.unref = jest.fn();
  return child;
}

function deps(opts: { exists?: boolean; isFile?: boolean; fail?: Error; throwSync?: Error } = {}) {
  const child = fakeChild();
  const spawn = jest.fn((_cmd: string, _args: string[], _o: any) => {
    if (opts.throwSync) throw opts.throwSync;
    setImmediate(() => {
      if (opts.fail) child.emit('error', opts.fail);
      else child.emit('spawn');
    });
    return child as any;
  });
  const stat = jest.fn(async (_p: string) => {
    if (opts.exists === false) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isFile: () => opts.isFile !== false };
  });
  return { spawn, stat, child };
}

const IMG = 'C:\\Users\\me\\SDStudio\\outs\\씬 1\\a & b.png';

describe('launchCustomImageEditor — 셸 없이 인자 하나로', () => {
  test.each([
    ['공백', 'C:\\Program Files\\CELSYS\\CLIP STUDIO 1.5\\CLIP STUDIO PAINT\\CLIPStudioPaint.exe'],
    ['&', 'D:\\Tools & Apps\\paint&go.exe'],
    ['한글', 'E:\\그림 도구\\클립 스튜디오\\편집기.EXE'],
    ['슬래시 구분자', 'C:/Apps/Krita (x64)/bin/krita.exe'],
  ])('%s 이 든 실행 파일 경로·이미지 경로를 각각 하나의 인자로 spawn 한다', async (_n, exe) => {
    const d = deps();
    await launchCustomImageEditor(exe, IMG, d);
    expect(d.stat).toHaveBeenCalledWith(exe);
    expect(d.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = d.spawn.mock.calls[0];
    expect(cmd).toBe(exe);
    expect(args).toEqual([IMG]);
    expect(options).toEqual({ detached: true, shell: false, stdio: 'ignore' });
    // 'spawn' 이벤트 뒤 unref
    expect(d.child.unref).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['undefined', undefined, CUSTOM_IMAGE_EDITOR_ERROR.notSet],
    ['빈 문자열', '   ', CUSTOM_IMAGE_EDITOR_ERROR.notSet],
    ['문자열 아님', 42, CUSTOM_IMAGE_EDITOR_ERROR.notSet],
    ['상대 경로', 'tools\\paint.exe', CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute],
    ['점 상대 경로', '.\\paint.exe', CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute],
    ['드라이브 상대 경로', 'C:paint.exe', CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute],
    ['UNC 경로', '\\\\server\\share\\paint.exe', CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute],
    ['POSIX 절대 경로', '/usr/bin/gimp', CUSTOM_IMAGE_EDITOR_ERROR.notAbsolute],
    ['.cmd', 'C:\\Tools\\run.cmd', CUSTOM_IMAGE_EDITOR_ERROR.notExe],
    ['.bat', 'C:\\Tools\\run.bat', CUSTOM_IMAGE_EDITOR_ERROR.notExe],
    ['.exe 뒤 다른 확장자', 'C:\\Tools\\paint.exe.lnk', CUSTOM_IMAGE_EDITOR_ERROR.notExe],
    ['확장자 없음', 'C:\\Tools\\paint', CUSTOM_IMAGE_EDITOR_ERROR.notExe],
  ])('%s 은 거부하고 spawn 하지 않는다', async (_n, exe, message) => {
    expect(customImageEditorPathProblem(exe)).toBe(message);
    const d = deps();
    await expect(launchCustomImageEditor(exe, IMG, d)).rejects.toThrow(message);
    expect(d.stat).not.toHaveBeenCalled();
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('없는 파일·폴더는 거부하고 spawn 하지 않는다', async () => {
    for (const d of [deps({ exists: false }), deps({ isFile: false })]) {
      await expect(launchCustomImageEditor('C:\\Gone\\paint.exe', IMG, d)).rejects.toThrow(
        CUSTOM_IMAGE_EDITOR_ERROR.notFound,
      );
      expect(d.stat).toHaveBeenCalledTimes(1);
      expect(d.spawn).not.toHaveBeenCalled();
    }
  });

  test("'error' 이벤트·동기 예외는 거부(unref 하지 않음)", async () => {
    const d = deps({ fail: new Error('EACCES') });
    await expect(launchCustomImageEditor('C:\\Tools\\paint.exe', IMG, d)).rejects.toThrow(/EACCES/);
    expect(d.child.unref).not.toHaveBeenCalled();
    const d2 = deps({ throwSync: new Error('bad') });
    await expect(launchCustomImageEditor('C:\\Tools\\paint.exe', IMG, d2)).rejects.toThrow(/bad/);
  });
});

describe('main.ts 연결(소스 검사)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(src.indexOf('async function openImageEditor'), src.indexOf("ipcMain.handle('open-image-editor'"));

  test("'custom' + win32 이면 새 모듈로만 실행하고 돌아온다(기존 exec 목록을 거치지 않음)", () => {
    expect(fn).toMatch(
      /if \(editor === 'custom' && os\.platform\(\) === 'win32'\) \{\n\s*await launchCustomImageEditor\(config\.customImageEditorPath, path\.resolve\(inputPath\)\);\n\s*return;\n\s*\}/,
    );
    expect(fn.indexOf('launchCustomImageEditor')).toBeLessThan(fn.indexOf('const runProgram'));
  });

  test('목록에 있는 값일 때만 앞으로 옮긴다(indexOf −1 로 엉뚱한 원소를 지우지 않음)', () => {
    expect(fn).not.toMatch(/editorsToTry\.splice\(editorsToTry\.indexOf\(editor\), 1\)/);
    expect(fn).toMatch(/const editorIdx = editorsToTry\.indexOf\(editor\);\n\s*if \(editorIdx > 0\) \{/);
  });
});
