#!/usr/bin/env node
/*
 * SDStudio Android 릴리스 APK 서명 스크립트 (키 회전 방식)
 *
 * 목적
 *   Gradle release 빌드는 서명하지 않은 APK(app-release-unsigned.apk)를 만든다.
 *   이 스크립트가 apksigner 로 서명·검증해 배포용 APK 를 만든다.
 *   외부 의존성 없이 Node 단독으로 실행한다.
 *
 * 키 회전 개요 (APK Signature Scheme v3 / v3.1 + lineage)
 *   - 5.4.0 까지는 디버그 키(원래 키)로 서명해 배포했다. 기존 설치본이 삭제 없이
 *     업데이트되려면 새 APK 도 원래 키의 서명을 계속 포함해야 한다.
 *   - v1 / v2 / v3.0 서명 블록 = 원래 키, v3.1 서명 블록 = 새 정식 키 + lineage
 *     (원래 키 → 새 키 이관 증명 파일). rotation-min-sdk-version 은 기본값(33) 유지.
 *   - Android 13(API 33) 이상은 새 키를, 12 이하는 원래 키를 서명자로 인식한다.
 *     어느 쪽이든 기존 설치본 위에 업데이트로 설치된다.
 *   - 따라서 원래 키(디버그 키 사본)·새 키·lineage 세 파일을 영구 보관해야 한다.
 *     하나라도 잃으면 이후 업데이트 서명을 만들 수 없다.
 *
 * 설정 (비밀은 저장소에 두지 않는다)
 *   android/keystore.properties (gitignore) 에 키 경로·별칭·비밀번호를 적는다.
 *   형식과 항목 설명은 android/keystore.properties.example 참고.
 *   비밀번호는 자식 프로세스 환경 변수(SDS_REL_KS_PASS 등)로만 넘기고
 *   apksigner 에는 --ks-pass env:이름, keytool 에는 -storepass:env 이름 형태로 전달한다.
 *   이 스크립트는 비밀번호 값을 명령줄·화면·오류 메시지에 쓰지 않는다.
 *
 * 사용법 (저장소 루트에서)
 *   node sign-apk.cjs check                    도구·설정·키·lineage 사전 점검(서명 안 함)
 *   node sign-apk.cjs sign [--in A] [--out B]  서명 + 검증
 *       기본 --in  = android/app/build/outputs/apk/release/app-release-unsigned.apk
 *       기본 --out = 같은 폴더의 app-release-signed.apk
 *   node sign-apk.cjs sign --dry-run           실행할 명령줄 배열만 출력(아무것도 실행 안 함)
 *   node sign-apk.cjs verify <apk>             서명 검증만
 *   npm run apk:check / npm run apk:sign -- --out <경로>
 *
 * 종료 코드: 0 성공, 1 실패, 2 설정 파일 없음·불완전
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = __dirname;
const PROPS_PATH = path.join(REPO_ROOT, 'android', 'keystore.properties');
const PROPS_EXAMPLE_PATH = path.join(REPO_ROOT, 'android', 'keystore.properties.example');
const DEFAULT_IN = path.join(
  REPO_ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk',
);
const DEFAULT_OUT_NAME = 'app-release-signed.apk';
const MIN_BUILD_TOOLS_MAJOR = 33;
const DEFAULT_ORIGINAL_ALIAS = 'androiddebugkey';
const DEFAULT_LINEAGE_NAME = 'sdstudio.lineage';

// 5.4.0 까지 배포한 APK 의 서명자(원래 키) 인증서 SHA-256. 공개 정보(모든 배포 APK 에 포함)다.
// 원래 키 파일이 이 인증서가 아니면 키 회전 결과가 기존 설치본과 이어지지 않으므로 서명을 막는다.
const KNOWN_ORIGINAL_SHA256 = '45ced549609ddb6cb31503785fd1073ed95311e0084655c451150eb421fababb';

// 비밀번호를 담는 환경 변수 이름. 값은 자식 프로세스 env 로만 전달한다.
const ENV = {
  REL_KS: 'SDS_REL_KS_PASS',
  REL_KEY: 'SDS_REL_KEY_PASS',
  ORIG_KS: 'SDS_ORIG_KS_PASS',
  ORIG_KEY: 'SDS_ORIG_KEY_PASS',
};

const KNOWN_KEYS = [
  'releaseStoreFile', 'releaseStorePassword', 'releaseKeyAlias', 'releaseKeyPassword',
  'originalStoreFile', 'originalStorePassword', 'originalKeyAlias', 'originalKeyPassword',
  'lineageFile',
];

// keytool 출력 로캘을 영어로 고정해 파싱을 안정시킨다(한국어 출력도 파서가 함께 처리).
const KEYTOOL_LOCALE = ['-J-Duser.language=en', '-J-Duser.country=US'];

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/* ───────────────────────── 설정 ───────────────────────── */

/** key=value 형식 파싱. # 또는 ! 로 시작하는 줄은 주석. 값의 \ 는 그대로 둔다. */
function parseProperties(text) {
  const out = {};
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return;
    const eq = line.indexOf('=');
    // 줄 내용은 비밀번호일 수 있으므로 오류 메시지에 넣지 않는다.
    if (eq <= 0) throw new CliError(`keystore.properties ${i + 1}행이 key=value 형식이 아닙니다.`, 2);
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
  return out;
}

function stripQuotes(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function resolvePathValue(v, baseDir) {
  let p = stripQuotes(v);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(baseDir, p);
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * keystore.properties 를 읽어 설정을 만든다.
 * 비밀번호는 config.secrets(환경 변수 이름 → 값)에만 담고 다른 곳으로 복사하지 않는다.
 * requireSecrets=false 는 --dry-run 용(비밀번호 누락을 허용).
 */
function loadConfig({ propsPath = PROPS_PATH, requireSecrets = true } = {}) {
  if (!fs.existsSync(propsPath)) {
    throw new CliError(
      [
        `설정 파일이 없습니다: ${propsPath}`,
        `예시 파일 ${PROPS_EXAMPLE_PATH} 를 복사해 android/keystore.properties 로 저장하고 값을 채우세요.`,
        '이 파일은 .gitignore 대상이며 커밋하지 않습니다.',
      ].join('\n'),
      2,
    );
  }
  const props = parseProperties(fs.readFileSync(propsPath, 'utf8'));
  const baseDir = path.dirname(propsPath);
  const warnings = [];
  for (const key of Object.keys(props)) {
    if (!KNOWN_KEYS.includes(key)) warnings.push(`알 수 없는 항목(오타 확인): ${key}`);
  }

  const missing = [];
  const need = (key) => {
    const v = props[key];
    if (v === undefined || v === '') missing.push(key);
    return v || '';
  };
  const releaseStoreFileRaw = need('releaseStoreFile');
  const originalStoreFileRaw = need('originalStoreFile');
  const relKsPass = requireSecrets ? need('releaseStorePassword') : props.releaseStorePassword || '';
  const origKsPass = requireSecrets ? need('originalStorePassword') : props.originalStorePassword || '';
  if (missing.length) {
    throw new CliError(`keystore.properties 에 필수 항목이 없습니다: ${missing.join(', ')}`, 2);
  }

  const releaseStoreFile = resolvePathValue(releaseStoreFileRaw, baseDir);
  const originalStoreFile = resolvePathValue(originalStoreFileRaw, baseDir);
  const lineageFile = props.lineageFile
    ? resolvePathValue(props.lineageFile, baseDir)
    : path.join(path.dirname(releaseStoreFile), DEFAULT_LINEAGE_NAME);

  // 공개 저장소 보호: 키 파일은 저장소 밖에 있어야 한다.
  for (const [key, p] of [['releaseStoreFile', releaseStoreFile], ['originalStoreFile', originalStoreFile]]) {
    if (isInside(REPO_ROOT, p)) {
      throw new CliError(`${key} 가 저장소 안을 가리킵니다. 키 파일은 저장소 밖으로 옮기세요: ${p}`, 2);
    }
  }
  if (isInside(REPO_ROOT, lineageFile)) {
    warnings.push(`lineageFile 이 저장소 안에 있습니다(비밀은 아니나 키와 함께 저장소 밖 보관 권장): ${lineageFile}`);
  }

  const secrets = {
    [ENV.REL_KS]: relKsPass,
    [ENV.REL_KEY]: props.releaseKeyPassword || relKsPass,
    [ENV.ORIG_KS]: origKsPass,
    [ENV.ORIG_KEY]: props.originalKeyPassword || origKsPass,
  };

  return {
    propsPath,
    releaseStoreFile,
    releaseKeyAlias: props.releaseKeyAlias ? stripQuotes(props.releaseKeyAlias) : null,
    originalStoreFile,
    originalKeyAlias: props.originalKeyAlias ? stripQuotes(props.originalKeyAlias) : DEFAULT_ORIGINAL_ALIAS,
    lineageFile,
    secrets,
    warnings,
  };
}

/* ───────────────────────── 도구 탐색 ───────────────────────── */

function exeName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function findJava() {
  const homes = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    homes.push({ home: path.join(pf, 'Android', 'Android Studio', 'jbr'), source: 'Android Studio JBR' });
  } else if (process.platform === 'darwin') {
    homes.push({ home: '/Applications/Android Studio.app/Contents/jbr/Contents/Home', source: 'Android Studio JBR' });
  } else {
    homes.push({ home: '/opt/android-studio/jbr', source: 'Android Studio JBR' });
  }
  if (process.env.JAVA_HOME) homes.push({ home: process.env.JAVA_HOME.replace(/"/g, ''), source: 'JAVA_HOME' });

  for (const { home, source } of homes) {
    const java = path.join(home, 'bin', exeName('java'));
    const keytool = path.join(home, 'bin', exeName('keytool'));
    if (fs.existsSync(java) && fs.existsSync(keytool)) return { home, java, keytool, source };
  }
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (!probe.error && probe.status === 0) return { home: null, java: 'java', keytool: 'keytool', source: 'PATH' };
  return null;
}

function parseVersion(name) {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-rc(\d+))?$/.exec(name);
  if (!m) return null;
  // 정식판이 같은 번호의 rc 보다 높게 정렬되도록 rc 없음 = 무한대
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0), m[4] ? Number(m[4]) : Infinity];
}

function compareVersion(a, b) {
  for (let i = 0; i < 4; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function sdkRoots() {
  const roots = [];
  if (process.env.ANDROID_SDK_ROOT) roots.push(process.env.ANDROID_SDK_ROOT);
  if (process.env.ANDROID_HOME) roots.push(process.env.ANDROID_HOME);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  } else if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'));
  } else {
    roots.push(path.join(os.homedir(), 'Android', 'Sdk'));
  }
  return roots;
}

/** SDK 루트 순서대로 build-tools 33 이상 중 최신(apksigner·zipalign 모두 있는 것)을 고른다. */
function findBuildTools() {
  for (const root of sdkRoots()) {
    const btDir = path.join(root, 'build-tools');
    let names;
    try {
      names = fs.readdirSync(btDir);
    } catch {
      continue;
    }
    const candidates = names
      .map((name) => ({ name, ver: parseVersion(name), dir: path.join(btDir, name) }))
      .filter((c) => c.ver && c.ver[0] >= MIN_BUILD_TOOLS_MAJOR)
      .filter((c) => fs.existsSync(path.join(c.dir, exeName('zipalign'))))
      .filter((c) => fs.existsSync(path.join(c.dir, 'lib', 'apksigner.jar'))
        || fs.existsSync(path.join(c.dir, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')))
      .sort((a, b) => compareVersion(b.ver, a.ver));
    if (candidates.length) {
      const c = candidates[0];
      return {
        sdkRoot: root,
        version: c.name,
        dir: c.dir,
        apksignerJar: path.join(c.dir, 'lib', 'apksigner.jar'),
        apksignerScript: path.join(c.dir, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'),
        zipalign: path.join(c.dir, exeName('zipalign')),
      };
    }
  }
  return null;
}

/**
 * 실행에 쓸 도구 묶음. apksigner 는 가능하면 java -jar apksigner.jar 로 직접 실행한다
 * (.bat 를 cmd.exe 로 감싸는 인자 인용 문제를 피함). jar 가 없을 때만 스크립트 폴백.
 */
function resolveTools({ allowMissing = false } = {}) {
  const java = findJava();
  const bt = findBuildTools();
  const problems = [];
  if (!java) problems.push('Java(keytool 포함)를 찾지 못했습니다. Android Studio JBR 또는 JAVA_HOME 을 확인하세요.');
  if (!bt) {
    problems.push(`Android SDK build-tools ${MIN_BUILD_TOOLS_MAJOR} 이상(apksigner·zipalign)을 찾지 못했습니다. `
      + `확인한 SDK 경로: ${sdkRoots().join(', ')}`);
  }
  if (problems.length && !allowMissing) throw new CliError(problems.join('\n'));

  let apksigner = null;
  if (bt && java && fs.existsSync(bt.apksignerJar)) {
    apksigner = { kind: 'jar', java: java.java, jar: bt.apksignerJar, name: 'apksigner' };
  } else if (bt && fs.existsSync(bt.apksignerScript)) {
    apksigner = { kind: process.platform === 'win32' ? 'bat' : 'exe', file: bt.apksignerScript, name: 'apksigner' };
  }
  return {
    java,
    bt,
    problems,
    apksigner: apksigner || { kind: 'placeholder', name: '<apksigner>' },
    zipalign: bt ? { kind: 'exe', file: bt.zipalign, name: 'zipalign' } : { kind: 'placeholder', name: '<zipalign>' },
    keytool: java ? { kind: 'exe', file: java.keytool, name: 'keytool' } : { kind: 'placeholder', name: '<keytool>' },
  };
}

/* ───────────────────────── 외부 실행 ───────────────────────── */

/** cmd.exe 로 .bat 를 부를 때 쓸 인자 인용. 해석될 수 있는 문자는 거부한다. */
function quoteForCmd(arg) {
  if (/["%!\r\n]/.test(arg)) {
    throw new CliError('명령 인자에 cmd.exe 로 안전하게 넘길 수 없는 문자(" % ! 줄바꿈)가 있습니다. 경로를 바꿔 주세요.');
  }
  return `"${arg}"`;
}

/** 도구 + 인자 → spawnSync 호출 정보. display 는 화면 표시용(비밀 없음: 비밀은 env 참조로만 존재). */
function buildCommand(tool, args) {
  const display = [tool.name, ...args];
  switch (tool.kind) {
    case 'jar':
      return { file: tool.java, argv: ['-Xmx1024M', '-jar', tool.jar, ...args], display };
    case 'exe':
      return { file: tool.file, argv: args, display };
    case 'bat': {
      // Node 는 보안 패치 이후 shell 없이 .bat 를 직접 실행하지 못하므로 cmd.exe 로 감싼다.
      const line = [tool.file, ...args].map(quoteForCmd).join(' ');
      return { file: process.env.ComSpec || 'cmd.exe', argv: ['/d', '/s', '/c', `"${line}"`], display, verbatim: true };
    }
    default:
      return { file: null, argv: args, display };
  }
}

function formatDisplay(display) {
  return display.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/**
 * 외부 명령 실행(shell 미사용). secrets 는 환경 변수로만 합쳐서 넘긴다.
 * 반환값의 stdout/stderr 는 도구 출력이며 비밀번호를 포함하지 않는다.
 */
function run(tool, args, { secrets = null, extraEnv = null, echo = true } = {}) {
  const cmd = buildCommand(tool, args);
  if (!cmd.file) throw new CliError(`도구를 찾지 못해 실행할 수 없습니다: ${tool.name}`);
  if (echo) console.log(`  $ ${formatDisplay(cmd.display)}`);
  const env = { ...process.env, ...(extraEnv || {}), ...(secrets || {}) };
  const r = spawnSync(cmd.file, cmd.argv, {
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: Boolean(cmd.verbatim),
    shell: false,
  });
  if (r.error) throw new CliError(`${tool.name} 실행 실패: ${r.error.code || r.error.message}`);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function printToolOutput(r, { indent = '    ' } = {}) {
  const text = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.replace(/\s+$/, '');
  if (text) console.log(text.split(/\r?\n/).map((l) => indent + l).join('\n'));
}

function javaHomeEnv(tools) {
  // 스크립트(.bat) 폴백 시 apksigner 가 같은 JDK 를 쓰도록 JAVA_HOME 지정
  return tools.java && tools.java.home ? { JAVA_HOME: tools.java.home } : null;
}

/* ───────────────────────── keytool ───────────────────────── */

/** keytool -list 출력에서 PrivateKeyEntry 별칭 목록을 뽑는다(요약·-v 형식, 영어·한국어). */
function parseKeytoolAliases(text) {
  const lines = String(text).split(/\r?\n/);
  const summary = [];
  for (const line of lines) {
    // 요약 형식: "key0, Sep 28, 2026, PrivateKeyEntry," / "key0, 2026. 9. 28., PrivateKeyEntry,"
    const m = /^([^,\s][^,]*),\s.*,\s*PrivateKeyEntry\s*,?\s*$/.exec(line.trim());
    if (m) summary.push(m[1].trim());
  }
  if (summary.length) return summary;

  // -v 형식: "Alias name: key0" + "Entry type: PrivateKeyEntry" (한국어: 별칭 이름 / 항목 유형)
  const verbose = [];
  let current = null;
  for (const line of lines) {
    const a = /^\s*(?:Alias name|별칭 이름)\s*:\s*(.+?)\s*$/.exec(line);
    if (a) {
      current = a[1];
      continue;
    }
    const t = /^\s*(?:Entry type|항목 유형)\s*:\s*(\S+)/.exec(line);
    if (t && current !== null) {
      if (t[1] === 'PrivateKeyEntry') verbose.push(current);
      current = null;
    }
  }
  return verbose;
}

const STORETYPE_ORDER = {
  release: [['-storetype', 'PKCS12'], []],
  original: [[], ['-storetype', 'JKS']],
};

/** keytool 을 저장소 형식 후보 순서대로 시도. 마지막 실패는 출력과 함께 오류. */
function keytoolTry(tools, baseArgs, storetypes, secrets, label) {
  let last = null;
  for (const st of storetypes) {
    const r = run(tools.keytool, [...KEYTOOL_LOCALE, ...baseArgs, ...st], { secrets, echo: false });
    if (r.status === 0) return r;
    last = r;
  }
  console.log(`  keytool 실패(${label}):`);
  printToolOutput(last);
  throw new CliError(`${label}: keytool 이 키 저장소를 열지 못했습니다(경로·비밀번호·형식 확인).`);
}

function listAliases(tools, storeFile, envName, storetypes, secrets, label) {
  const base = ['-list', '-keystore', storeFile, '-storepass:env', envName];
  const r = keytoolTry(tools, base, storetypes, secrets, label);
  let aliases = parseKeytoolAliases(r.stdout);
  if (!aliases.length) {
    const rv = keytoolTry(tools, [...base, '-v'], storetypes, secrets, label);
    aliases = parseKeytoolAliases(rv.stdout);
  }
  return aliases;
}

function certDigestsFromPem(pem) {
  const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (!m) return null;
  const der = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  return {
    sha256: crypto.createHash('sha256').update(der).digest('hex'),
    sha1: crypto.createHash('sha1').update(der).digest('hex'),
  };
}

function exportCertDigests(tools, storeFile, alias, envName, storetypes, secrets, label) {
  const base = ['-exportcert', '-rfc', '-alias', alias, '-keystore', storeFile, '-storepass:env', envName];
  const r = keytoolTry(tools, base, storetypes, secrets, label);
  const d = certDigestsFromPem(r.stdout);
  if (!d) throw new CliError(`${label}: 인증서를 읽지 못했습니다(별칭 확인: ${alias}).`);
  return d;
}

function fmtFp(hex) {
  return hex.toUpperCase().match(/.{2}/g).join(':');
}

function normHex(s) {
  return String(s).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

/** 새 키 별칭 결정: 명시값 우선, 없으면 PrivateKeyEntry 가 정확히 1개일 때만 자동 사용. */
function resolveReleaseAlias(tools, config) {
  if (config.releaseKeyAlias) return { alias: config.releaseKeyAlias, detected: false };
  const aliases = listAliases(tools, config.releaseStoreFile, ENV.REL_KS, STORETYPE_ORDER.release,
    config.secrets, '새 키 별칭 감지');
  if (aliases.length !== 1) {
    throw new CliError(
      `새 키 저장소의 개인 키 항목이 ${aliases.length}개입니다(자동 감지는 1개일 때만). `
        + `keystore.properties 에 releaseKeyAlias 를 적어 주세요.${aliases.length ? ` 후보: ${aliases.join(', ')}` : ''}`,
      2,
    );
  }
  return { alias: aliases[0], detected: true };
}

/** 두 키의 인증서 지문을 구하고 원래 키가 5.4.0 서명자인지 확인. */
function loadKeyDigests(tools, config, relAlias) {
  const orig = exportCertDigests(tools, config.originalStoreFile, config.originalKeyAlias, ENV.ORIG_KS,
    STORETYPE_ORDER.original, config.secrets, '원래 키');
  const rel = exportCertDigests(tools, config.releaseStoreFile, relAlias, ENV.REL_KS,
    STORETYPE_ORDER.release, config.secrets, '새 키');
  if (orig.sha256 !== KNOWN_ORIGINAL_SHA256) {
    throw new CliError(
      `원래 키 인증서가 5.4.0 배포 서명자와 다릅니다.\n  기대: ${fmtFp(KNOWN_ORIGINAL_SHA256)}\n  실제: ${fmtFp(orig.sha256)}\n`
        + 'originalStoreFile·originalKeyAlias 를 확인하세요. 다른 키로 회전하면 기존 설치본이 업데이트되지 않습니다.',
    );
  }
  if (rel.sha256 === orig.sha256) throw new CliError('새 키와 원래 키가 같은 인증서입니다. releaseStoreFile 을 확인하세요.');
  return { orig, rel };
}

/* ───────────────────────── apksigner 명령 구성 ───────────────────────── */

function rotateArgs(config, relAlias) {
  return [
    'rotate', '--out', config.lineageFile,
    '--old-signer', '--ks', config.originalStoreFile, '--ks-key-alias', config.originalKeyAlias,
    '--ks-pass', `env:${ENV.ORIG_KS}`, '--key-pass', `env:${ENV.ORIG_KEY}`,
    '--new-signer', '--ks', config.releaseStoreFile, '--ks-key-alias', relAlias,
    '--ks-pass', `env:${ENV.REL_KS}`, '--key-pass', `env:${ENV.REL_KEY}`,
  ];
}

// rotation-min-sdk-version 은 의도적으로 지정하지 않는다(기본값 33 유지).
function signArgs(config, relAlias, inApk, outApk) {
  return [
    'sign',
    '--ks', config.originalStoreFile, '--ks-key-alias', config.originalKeyAlias,
    '--ks-pass', `env:${ENV.ORIG_KS}`, '--key-pass', `env:${ENV.ORIG_KEY}`,
    '--next-signer',
    '--ks', config.releaseStoreFile, '--ks-key-alias', relAlias,
    '--ks-pass', `env:${ENV.REL_KS}`, '--key-pass', `env:${ENV.REL_KEY}`,
    '--lineage', config.lineageFile,
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--v4-signing-enabled', 'false',
    '--out', outApk,
    inApk,
  ];
}

function verifyArgs(apk) {
  return ['verify', '--verbose', '--print-certs', apk];
}

function lineagePrintArgs(file) {
  return ['lineage', '--in', file, '--print-certs'];
}

/* ───────────────────────── 출력 파싱 ───────────────────────── */

function parseSchemes(text) {
  const schemes = {};
  const re = /Verified using (v[\d.]+) scheme[^:\n]*:\s*(true|false)/g;
  let m;
  while ((m = re.exec(text))) schemes[m[1]] = m[2] === 'true';
  return schemes;
}

function parseDigests(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(.*?)certificate SHA-256 digest:\s*([0-9a-fA-F:]+)\s*$/.exec(line.trim());
    if (m) out.push({ label: m[1].trim(), sha256: normHex(m[2]) });
  }
  return out;
}

function printLineage(tools, file) {
  const r = run(tools.apksigner, lineagePrintArgs(file), { extraEnv: javaHomeEnv(tools) });
  printToolOutput(r);
  return r;
}

/* ───────────────────────── 검증 ───────────────────────── */

/**
 * apksigner verify 실행 후 요약. expected 가 있으면 두 서명자 지문이 모두 보이는지 확인.
 * 반환: { ok, reasons[] }
 */
function verifyApk(tools, apk, expected) {
  const reasons = [];
  console.log('\n[검증] apksigner verify');
  const r = run(tools.apksigner, verifyArgs(apk), { extraEnv: javaHomeEnv(tools) });
  // v1 서명의 「META-INF/... not protected by signature」 경고는 AGP 산출물에서 흔하고 무해하므로 개수만 표시
  const noise = /^WARNING: META-INF\/.* not protected by signature/;
  const keep = (s) => s.split(/\r?\n/).filter((l) => !noise.test(l.trim())).join('\n');
  const noiseCount = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => noise.test(l.trim())).length;
  printToolOutput({ stdout: keep(r.stdout), stderr: keep(r.stderr) });
  if (noiseCount) console.log(`    (META-INF 비보호 항목 경고 ${noiseCount}개 생략 — v1 서명 관례상 무해)`);
  if (r.status !== 0) reasons.push(`apksigner verify 종료 코드 ${r.status}`);

  const schemes = parseSchemes(r.stdout);
  const digests = parseDigests(r.stdout);

  // 서명된 APK 에서 lineage 를 읽어 본다(형식 차이 대비, 실패해도 무시).
  console.log('\n[검증] APK 안의 lineage');
  let lineageDigests = [];
  try {
    const lr = run(tools.apksigner, lineagePrintArgs(apk), { extraEnv: javaHomeEnv(tools) });
    if (lr.status === 0) {
      printToolOutput(lr);
      lineageDigests = parseDigests(lr.stdout);
    } else {
      console.log('    (lineage 출력 없음 — 키 회전 없이 서명된 APK 이거나 apksigner 가 지원하지 않음)');
    }
  } catch (e) {
    console.log(`    (lineage 확인 생략: ${e.message})`);
  }

  console.log('\n[요약]');
  const schemeList = Object.keys(schemes);
  console.log(`  서명 방식: ${schemeList.length ? schemeList.map((k) => `${k}=${schemes[k]}`).join(', ') : '(표시 없음)'}`);
  const seen = new Set([...digests, ...lineageDigests].map((d) => d.sha256));
  for (const d of digests) console.log(`  ${d.label || '서명자'} SHA-256 ${fmtFp(d.sha256)}`);

  if (schemes.v3 !== true) reasons.push('v3 서명 검증 결과가 true 가 아닙니다');
  const hasOrig = seen.has(KNOWN_ORIGINAL_SHA256);
  console.log(`  원래 키(5.4.0 서명자) 지문: ${hasOrig ? '확인' : '없음'}`);
  if (expected) {
    if (schemes.v1 !== true) reasons.push('v1 서명 검증 결과가 true 가 아닙니다(minSdk 22 대응 필요)');
    if (schemes.v2 !== true) reasons.push('v2 서명 검증 결과가 true 가 아닙니다');
    if (!hasOrig) reasons.push('원래 키 지문이 서명자 목록에 없습니다');
    const hasRel = seen.has(expected.rel.sha256);
    console.log(`  새 키 지문: ${hasRel ? '확인' : '없음'} (${fmtFp(expected.rel.sha256)})`);
    if (!hasRel) reasons.push('새 키 지문이 서명자·lineage 출력에 없습니다(키 회전 미적용)');
  }
  return { ok: reasons.length === 0, reasons };
}

/* ───────────────────────── zipalign ───────────────────────── */

function isUsageOutput(r) {
  return r.status === 2 || /Usage:\s*zipalign/i.test(`${r.stdout}\n${r.stderr}`);
}

/** 정렬 검사 → 필요하면 정렬 사본 경로 반환(없으면 null). */
function ensureAligned(tools, inApk, tmpApk) {
  console.log('\n[정렬] zipalign 검사');
  let pageOpt = ['-P', '4'];
  let r = run(tools.zipalign, ['-c', ...pageOpt, '4', inApk]);
  if (isUsageOutput(r)) {
    console.log('    (-P 미지원 zipalign — -p 로 재시도)');
    pageOpt = ['-p'];
    r = run(tools.zipalign, ['-c', ...pageOpt, '4', inApk]);
  }
  if (r.status === 0) {
    console.log('    정렬됨');
    return null;
  }
  printToolOutput(r);
  console.log('    정렬되지 않음 — 정렬 사본을 만듭니다');
  const a = run(tools.zipalign, ['-f', ...pageOpt, '4', inApk, tmpApk]);
  if (a.status !== 0) {
    printToolOutput(a);
    throw new CliError(`zipalign 정렬 실패(종료 코드 ${a.status})`);
  }
  return tmpApk;
}

/* ───────────────────────── 하위 명령 ───────────────────────── */

function printTools(tools) {
  console.log('[도구]');
  if (tools.bt) {
    console.log(`  SDK: ${tools.bt.sdkRoot}`);
    console.log(`  build-tools: ${tools.bt.version} (${tools.bt.dir})`);
  }
  if (tools.apksigner.kind === 'jar') console.log(`  apksigner: java -jar ${tools.apksigner.jar}`);
  else if (tools.apksigner.file) console.log(`  apksigner: ${tools.apksigner.file}`);
  if (tools.zipalign.file) console.log(`  zipalign: ${tools.zipalign.file}`);
  if (tools.java) console.log(`  java/keytool: ${tools.java.source} (${tools.java.keytool})`);
  for (const p of tools.problems) console.log(`  문제: ${p}`);
}

function printConfigSummary(config, relAlias) {
  console.log('\n[설정]');
  console.log(`  설정 파일: ${config.propsPath}`);
  console.log(`  새 키: ${config.releaseStoreFile} (별칭 ${relAlias})`);
  console.log(`  원래 키: ${config.originalStoreFile} (별칭 ${config.originalKeyAlias})`);
  console.log(`  lineage: ${config.lineageFile}${fs.existsSync(config.lineageFile) ? '' : ' (없음 — sign 때 1회 생성)'}`);
  console.log(`  비밀번호: 환경 변수 ${Object.values(ENV).join(', ')} 로 전달(값 미표시)`);
  for (const w of config.warnings) console.log(`  주의: ${w}`);
}

function requireFile(p, label) {
  if (!fs.existsSync(p)) throw new CliError(`${label} 파일이 없습니다: ${p}`);
}

/** lineage 파일이 두 키(원래 → 새)를 담고 있는지 확인. */
function checkLineage(tools, config, keys) {
  console.log('\n[lineage]');
  const r = printLineage(tools, config.lineageFile);
  if (r.status !== 0) throw new CliError(`lineage 파일을 읽지 못했습니다(종료 코드 ${r.status}): ${config.lineageFile}`);
  const set = new Set(parseDigests(r.stdout).map((d) => d.sha256));
  if (!set.has(keys.orig.sha256) || !set.has(keys.rel.sha256)) {
    throw new CliError('lineage 파일이 현재 설정의 원래 키·새 키와 맞지 않습니다. 다른 키로 만든 lineage 인지 확인하세요.');
  }
  console.log('  lineage 가 원래 키 → 새 키를 담고 있음 확인');
}

function cmdCheck() {
  const tools = resolveTools({ allowMissing: true });
  printTools(tools);
  const config = loadConfig();
  if (tools.problems.length) throw new CliError('도구가 준비되지 않았습니다.');

  requireFile(config.releaseStoreFile, '새 키(releaseStoreFile)');
  requireFile(config.originalStoreFile, '원래 키(originalStoreFile)');
  const { alias: relAlias, detected } = resolveReleaseAlias(tools, config);
  printConfigSummary(config, `${relAlias}${detected ? ', 자동 감지' : ''}`);

  const origAliases = listAliases(tools, config.originalStoreFile, ENV.ORIG_KS, STORETYPE_ORDER.original,
    config.secrets, '원래 키 별칭 확인');
  if (!origAliases.includes(config.originalKeyAlias)) {
    throw new CliError(`원래 키 저장소에 별칭 ${config.originalKeyAlias} 가 없습니다. 후보: ${origAliases.join(', ') || '(없음)'}`);
  }

  const keys = loadKeyDigests(tools, config, relAlias);
  console.log('\n[인증서 지문] (공개 정보 — Google OAuth Android 클라이언트 등록용 SHA-1 포함)');
  console.log(`  원래 키 SHA-256 ${fmtFp(keys.orig.sha256)}  (5.4.0 서명자와 일치)`);
  console.log(`  원래 키 SHA-1   ${fmtFp(keys.orig.sha1)}`);
  console.log(`  새 키   SHA-256 ${fmtFp(keys.rel.sha256)}`);
  console.log(`  새 키   SHA-1   ${fmtFp(keys.rel.sha1)}`);

  if (fs.existsSync(config.lineageFile)) checkLineage(tools, config, keys);
  else console.log('\n[lineage] 아직 없음 — sign 실행 시 1회 생성합니다(생성 후 키와 함께 백업).');

  console.log(`\n[입력 APK] ${DEFAULT_IN} ${fs.existsSync(DEFAULT_IN) ? '(있음)' : '(없음 — assembleRelease 필요)'}`);
  console.log('\n점검 완료: 서명 준비됨.');
}

function cmdSignDryRun(opts) {
  console.log('[dry-run] 아무것도 실행하지 않고 명령줄 배열만 출력합니다. 비밀번호는 env 참조로만 나타납니다.\n');
  const tools = resolveTools({ allowMissing: true });
  printTools(tools);
  let config;
  try {
    config = loadConfig({ requireSecrets: false });
  } catch (e) {
    if (!(e instanceof CliError) || e.exitCode !== 2) throw e;
    console.log(`\n(설정 파일을 읽지 못해 자리표시자로 대체: ${e.message.split('\n')[0]})`);
    config = {
      releaseStoreFile: '<releaseStoreFile>',
      releaseKeyAlias: null,
      originalStoreFile: '<originalStoreFile>',
      originalKeyAlias: DEFAULT_ORIGINAL_ALIAS,
      lineageFile: '<lineageFile>',
    };
  }
  const relAlias = config.releaseKeyAlias || '<자동 감지 별칭>';
  const inApk = opts.in;
  const outApk = opts.out;
  const show = (title, tool, args) => {
    const cmd = buildCommand(tool, args);
    console.log(`\n${title}`);
    console.log(`  표시: ${formatDisplay(cmd.display)}`);
    console.log(`  실행 파일: ${cmd.file || '(도구 없음)'}`);
    console.log(`  인자 배열: ${JSON.stringify(cmd.argv)}`);
  };
  const lineageExists = config.lineageFile && fs.existsSync(config.lineageFile);
  show(`(a) lineage 생성${lineageExists ? ' — 이미 있어 실제로는 생략' : ' (없을 때 1회)'}`, tools.apksigner, rotateArgs(config, relAlias));
  show('(b) 정렬 검사', tools.zipalign, ['-c', '-P', '4', '4', inApk]);
  show('(c) 서명', tools.apksigner, signArgs(config, relAlias, inApk, outApk));
  show('(d) 검증', tools.apksigner, verifyArgs(outApk));
  console.log(`\n자식 프로세스에 넘길 환경 변수 이름: ${Object.values(ENV).join(', ')} (값 미표시)`);
}

function cmdSign(opts) {
  if (opts.dryRun) return cmdSignDryRun(opts);
  const inApk = opts.in;
  const outApk = opts.out;
  if (path.resolve(inApk) === path.resolve(outApk)) throw new CliError('--in 과 --out 이 같은 파일입니다.');
  requireFile(inApk, '입력 APK');
  if (!fs.existsSync(path.dirname(outApk))) throw new CliError(`출력 폴더가 없습니다: ${path.dirname(outApk)}`);

  const tools = resolveTools();
  printTools(tools);
  const config = loadConfig();
  requireFile(config.releaseStoreFile, '새 키(releaseStoreFile)');
  requireFile(config.originalStoreFile, '원래 키(originalStoreFile)');
  const { alias: relAlias, detected } = resolveReleaseAlias(tools, config);
  printConfigSummary(config, `${relAlias}${detected ? ', 자동 감지' : ''}`);
  const keys = loadKeyDigests(tools, config, relAlias);
  console.log(`\n  원래 키 SHA-256 ${fmtFp(keys.orig.sha256)} (5.4.0 서명자와 일치)`);
  console.log(`  새 키   SHA-256 ${fmtFp(keys.rel.sha256)}`);

  // (a) lineage
  if (!fs.existsSync(config.lineageFile)) {
    console.log('\n[lineage] 없음 — 1회 생성합니다');
    const r = run(tools.apksigner, rotateArgs(config, relAlias), { secrets: config.secrets, extraEnv: javaHomeEnv(tools) });
    printToolOutput(r);
    if (r.status !== 0 || !fs.existsSync(config.lineageFile)) {
      throw new CliError(`apksigner rotate 실패(종료 코드 ${r.status})`);
    }
    console.log(`  lineage 생성됨: ${config.lineageFile}`);
    console.log('  ※ 이 파일을 원래 키·새 키와 함께 반드시 백업하세요(잃으면 이후 업데이트 서명 불가).');
  }
  checkLineage(tools, config, keys);

  // (b) 정렬
  const tmpApk = `${outApk}.aligned-tmp.apk`;
  const cleanup = (removeOut) => {
    for (const p of removeOut ? [tmpApk, outApk] : [tmpApk]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        console.log(`  (임시 파일 삭제 실패: ${p})`);
      }
    }
  };
  try {
    const aligned = ensureAligned(tools, inApk, tmpApk);
    const signInput = aligned || inApk;

    // (c) 서명
    console.log('\n[서명] apksigner sign (원래 키 → 새 키, lineage)');
    const s = run(tools.apksigner, signArgs(config, relAlias, signInput, outApk), {
      secrets: config.secrets, extraEnv: javaHomeEnv(tools),
    });
    printToolOutput(s);
    if (s.status !== 0) throw new CliError(`apksigner sign 실패(종료 코드 ${s.status})`);

    // (d) 검증
    const v = verifyApk(tools, outApk, keys);
    if (!v.ok) throw new CliError(`서명 검증 실패:\n  - ${v.reasons.join('\n  - ')}`);
  } catch (e) {
    cleanup(true);
    console.log(`\n실패 — 출력 파일을 삭제했습니다: ${outApk}`);
    throw e;
  }
  cleanup(false);
  console.log(`\n서명 완료: ${outApk}`);
  return undefined;
}

function cmdVerify(apk) {
  if (!apk) throw new CliError('사용법: node sign-apk.cjs verify <apk>');
  requireFile(apk, 'APK');
  const tools = resolveTools();
  printTools(tools);
  let keys = null;
  if (fs.existsSync(PROPS_PATH)) {
    // 설정이 있으면 새 키 지문까지 대조한다. 실패하면 기본 검증만.
    try {
      const config = loadConfig();
      const { alias } = resolveReleaseAlias(tools, config);
      keys = loadKeyDigests(tools, config, alias);
    } catch (e) {
      console.log(`  (설정으로 새 키 지문을 구하지 못해 기본 검증만 합니다: ${e.message.split('\n')[0]})`);
    }
  }
  const v = verifyApk(tools, apk, keys);
  if (!v.ok) throw new CliError(`검증 실패:\n  - ${v.reasons.join('\n  - ')}`);
  console.log('\n검증 통과');
}

/* ───────────────────────── 진입점 ───────────────────────── */

function usage() {
  return [
    '사용법:',
    '  node sign-apk.cjs check',
    '  node sign-apk.cjs sign [--in <apk>] [--out <apk>] [--dry-run]',
    '  node sign-apk.cjs verify <apk>',
  ].join('\n');
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, in: null, out: null, dryRun: false, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--in' || a === '--out') {
      const v = rest[i + 1];
      if (!v || v.startsWith('--')) throw new CliError(`${a} 뒤에 경로가 필요합니다.\n${usage()}`);
      opts[a.slice(2)] = path.resolve(v);
      i += 1;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '-h' || a === '--help') {
      opts.command = 'help';
    } else if (a.startsWith('-')) {
      throw new CliError(`알 수 없는 옵션: ${a}\n${usage()}`);
    } else {
      opts.positional.push(a);
    }
  }
  if (!opts.in) opts.in = DEFAULT_IN;
  if (!opts.out) opts.out = path.join(path.dirname(opts.in), DEFAULT_OUT_NAME);
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  switch (opts.command) {
    case 'check':
      return cmdCheck();
    case 'sign':
      return cmdSign(opts);
    case 'verify':
      return cmdVerify(opts.positional[0] ? path.resolve(opts.positional[0]) : null);
    case 'help':
    case undefined:
      console.log(usage());
      return undefined;
    default:
      throw new CliError(`알 수 없는 명령: ${opts.command}\n${usage()}`);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`\n오류: ${e.message}`);
      process.exitCode = e.exitCode;
    } else {
      console.error(`\n예상하지 못한 오류: ${e && e.stack ? e.stack : e}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  parseProperties,
  parseKeytoolAliases,
  parseSchemes,
  parseDigests,
  rotateArgs,
  signArgs,
  verifyArgs,
  buildCommand,
  certDigestsFromPem,
  ENV,
  KNOWN_ORIGINAL_SHA256,
};
