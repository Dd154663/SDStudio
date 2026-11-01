#!/usr/bin/env node
/*
 * SDStudio 부스트 모드 디버그용 로컬 가짜 NovelAI 서버 (2026-11-01, 플랜 2026-10-25-boost-mode.md §11)
 *
 * - Node 내장 모듈만 쓴다(http·zlib·crypto·fs·path). npm 설치 불필요.
 * - 앱(src/renderer/backends/genVendors/nai.ts)이 실제로 부르는 경로·메서드·응답 형식을 그대로 흉내 낸다.
 *     POST /ai/generate-image  → zip(application/x-zip-compressed) 안에 image_0.png 1장
 *     GET  /user/data          → subscription.{active,tier,trainingStepsLeft,usage} (잔량·Opus 할당량·토큰 검증 공용)
 *     GET  /user/subscription  → subscription 만(앱은 부르지 않지만 수동 확인용)
 *     POST /ai/augment-image   → zip 안 PNG(요청 width/height) — 간단 성공
 *     POST /ai/upscale         → zip 안 image_0.png(입력 PNG 크기 ×4, 변마다 4096 상한) — 간단 성공
 *     POST /ai/encode-vibe     → 의미 없는 바이트(앱은 base64 로만 보관) — 간단 성공
 *     POST /user/login         → 400(이메일 로그인 미지원 — 토큰 로그인을 쓴다)
 *   관리용(인증 없음):
 *     GET  /__mock/state       → 계정별 현재 상태(토큰은 앞 6자만)
 *     POST /__mock/reset       → 시나리오 파일 값으로 상태·횟수 초기화(GET 도 받음)
 * - 시나리오 파일(JSON)을 감시해 저장하면 재시작 없이 반영한다(바뀐 값만 덮어씀 — 아래 applyScenario).
 * - 이 PC 안(127.0.0.1)에서만 연다. 실제 NovelAI 와 통신하지 않는다.
 *
 * 실행:  node dev/mock-nai/server.cjs [--port 18080] [--scenario 경로] [--selftest]
 *        환경 변수 MOCK_NAI_PORT, MOCK_NAI_SCENARIO 도 받는다(인자가 우선).
 * 자체 점검: node dev/mock-nai/server.cjs --selftest   (임시 포트에 띄워 응답·PNG·409·차감을 확인하고 끝냄)
 *
 * 실제 NovelAI 오류 본문은 `{"statusCode":N,"message":"..."}` 형태로 흉내 냈다. 409 문구
 * 「Concurrent generation is locked」 는 앱 naiErrors.ts 의 판정 문구와 같다. 402·429 문구는 추정이다
 * (앱 판정은 상태 코드·「anlas」 낱말로 하므로 분류는 실제와 같게 나온다).
 */
'use strict';

const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 18080;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024 * 1024;

// ───────────────────────── CRC32 · PNG · ZIP (의존성 없음) ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** tEXt 청크. 값은 UTF-8 바이트 그대로(프롬프트가 ASCII 면 Latin-1 과 같다). */
function textChunk(keyword, value) {
  return pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(String(value), 'utf8')]));
}

/**
 * RGB 8비트 PNG. 배경 = 계정 색, 시드로 위치가 정해지는 대각선 띠 = 밝은 색(같은 계정이라도 장마다 다르게 보이게).
 * texts: [[키, 값], ...] → tEXt.
 */
function makePng(width, height, rgb, seed, texts) {
  const rowLen = width * 3 + 1;
  const raw = Buffer.alloc(rowLen * height);
  const light = rgb.map((v) => Math.min(255, v + 90));
  const dark = rgb.map((v) => Math.max(0, v - 60));
  const bandWidth = Math.max(8, Math.round(Math.min(width, height) / 10));
  const offset = Number(BigInt.asUintN(32, BigInt(Math.trunc(Number(seed) || 0)))) % (width + height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // 필터 없음
    for (let x = 0; x < width; x++) {
      const d = (x + y + offset) % (width + height);
      const inBand = d < bandWidth;
      const border = x < 4 || y < 4 || x >= width - 4 || y >= height - 4;
      const c = border ? dark : inBand ? light : rgb;
      const p = rowStart + 1 + x * 3;
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // 색 형식 RGB(알파 없음 — 앱의 알파 채널 메타 추출은 조용히 건너뜀)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [pngChunk('IHDR', ihdr)];
  for (const [k, v] of texts || []) chunks.push(textChunk(k, v));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

/** PNG 헤더에서 크기를 읽는다(아니면 null). */
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => buf[i] === v)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 압축 없는(stored) zip. entries: [{ name, data }] */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0; // 00:00:00
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 1; // 2026-11-01
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 필요 버전
    local.writeUInt16LE(0, 6); // 플래그
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // 만든 버전
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ───────────────────────── 시나리오 ─────────────────────────

// 계정 항목의 기본값. 시나리오 파일의 "defaults" 가 이 위에, 각 계정 값이 그 위에 덮인다.
const BUILTIN_DEFAULTS = {
  name: '',
  opusSubscribed: true,
  percent: 100, // 무료 회복형 할당(%) — 시간 회복은 흉내 내지 않는다(/__mock/reset·파일 수정으로 되돌림)
  purchasedPercent: 0, // 추가 충전(Usage Boost, %)
  isNegative: false, // 무료·추가 충전 모두 소진(이후 생성은 Anlas)
  anlas: 1000, // fixedTrainingStepsLeft 자리
  timeUntilNextPercent: 300,
  delayMs: 1500, // 생성 응답까지 걸리는 시간
  delayJitterMs: 0, // ±지연 폭
  usagePerImage: 5, // V5 생성 1장당 차감(%) — 무료분 먼저, 그다음 추가 충전분
  anlasPerImage: 20, // Anlas 로 생성할 때 1장당 차감
  failEvery: 0, // N번째 생성 시도마다 500(0 = 끔)
  rateLimit429Every: 0, // N번째 생성 시도마다 429(0 = 끔)
  conflict409Every: 0, // N번째 생성 시도마다 409 「Concurrent generation is locked」(0 = 끔 — 앱 409 처리 확인용)
  authFail: false, // true = 모든 요청 401(만료 토큰 흉내)
  color: '', // '#rrggbb' — 비우면 이름으로 정함
};

// 바뀌면 현재 상태에 그대로 반영하는 값(나머지는 동작 설정이라 항상 최신 파일 값을 쓴다).
const STATE_FIELDS = ['opusSubscribed', 'percent', 'purchasedPercent', 'isNegative', 'anlas'];

function maskToken(token) {
  return `${String(token).slice(0, 6)}…`;
}

function colorFor(account) {
  const m = /^#?([0-9a-f]{6})$/i.exec(account.color || '');
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const h = crypto.createHash('sha1').update(account.name || account.token).digest();
  // 너무 어둡거나 밝지 않게 60~200 범위
  return [60 + (h[0] % 141), 60 + (h[1] % 141), 60 + (h[2] % 141)];
}

/** 시나리오 JSON → { accounts: Map<token, 설정> } (형식 오류는 throw). */
function parseScenario(json) {
  if (!json || typeof json !== 'object') throw new Error('시나리오는 JSON 객체여야 합니다');
  const list = Array.isArray(json.accounts) ? json.accounts : null;
  if (!list) throw new Error('"accounts" 배열이 없습니다');
  const defaults = { ...BUILTIN_DEFAULTS, ...(json.defaults && typeof json.defaults === 'object' ? json.defaults : {}) };
  const accounts = new Map();
  list.forEach((item, i) => {
    if (!item || typeof item.token !== 'string' || !item.token.trim()) {
      throw new Error(`accounts[${i}].token 이 없습니다`);
    }
    const token = item.token.trim();
    if (!token.startsWith('mock-')) {
      throw new Error(`accounts[${i}].token 은 "mock-" 로 시작해야 합니다(실제 토큰 혼동 방지)`);
    }
    if (accounts.has(token)) throw new Error(`accounts[${i}].token 이 중복입니다`);
    const merged = { ...defaults, ...item, token };
    if (!merged.name) merged.name = `계정${i + 1}`;
    accounts.set(token, merged);
  });
  // strictTokens: true 면 시나리오에 적힌 토큰만 받는다. 기본(false)은 모르는 토큰도 defaults 로 자동 등록
  // (앱에 아무 더미 문자열을 토큰으로 저장해도 바로 쓰이게 — 2026-11-01 사용자 요청).
  return { accounts, defaults, strictTokens: json.strictTokens === true };
}

/** 모르는 토큰용 자동 계정 — 시나리오 defaults 그대로, 이름은 토큰 앞 8자. */
function autoAccount(scenario, token) {
  return { ...scenario.defaults, token, name: `자동(${String(token).slice(0, 8)})`, auto: true };
}

function freshState(account) {
  const state = { attempts: 0, generated: 0, busy: false };
  for (const f of STATE_FIELDS) state[f] = account[f];
  return state;
}

// ───────────────────────── 서버 ─────────────────────────

function createMockServer(options = {}) {
  const log = options.log || ((line) => console.log(line));
  let scenario = { accounts: new Map() };
  const states = new Map(); // token → 실행 상태

  /**
   * 새 시나리오 적용. 처음이거나 reset 이면 상태를 파일 값으로 새로 만든다.
   * 그 밖(파일 수정)에는 이전 파일과 **값이 달라진 STATE_FIELDS 만** 현재 상태에 덮는다
   * — 생성으로 줄어든 percent 를 파일 저장 한 번에 되돌리지 않기 위해.
   */
  function applyScenario(next, { reset = false } = {}) {
    const prev = scenario;
    // 자동 등록 계정은 파일에 없으므로 새 시나리오에도 이어 둔다(reset 이면 버림 — 다음 요청에 다시 등록).
    if (!reset && !next.strictTokens) {
      for (const [token, account] of prev.accounts) {
        if (account.auto && !next.accounts.has(token)) next.accounts.set(token, autoAccount(next, token));
      }
    }
    scenario = next;
    for (const [token, account] of next.accounts) {
      const before = prev.accounts.get(token);
      const state = states.get(token);
      if (reset || !state || !before) {
        const fresh = freshState(account);
        if (state && !reset) fresh.busy = state.busy;
        states.set(token, fresh);
        continue;
      }
      for (const f of STATE_FIELDS) {
        if (before[f] !== account[f]) state[f] = account[f];
      }
    }
    for (const token of [...states.keys()]) {
      if (!next.accounts.has(token)) states.delete(token);
    }
  }

  function setScenarioJson(json, opts) {
    applyScenario(parseScenario(json), opts);
  }

  function accountFromRequest(req) {
    const auth = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const token = m ? m[1].trim() : '';
    let account = token ? scenario.accounts.get(token) : undefined;
    if (!account && token && !scenario.strictTokens) {
      account = autoAccount(scenario, token);
      scenario.accounts.set(token, account);
      states.set(token, freshState(account));
      log(`[${new Date().toTimeString().slice(0, 8)}] 모르는 토큰(${maskToken(token)}) → defaults 로 자동 등록(${account.name})`);
    }
    return { token, account, state: account ? states.get(token) : undefined };
  }

  function corsHeaders() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Expose-Headers': 'x-correlation-id',
      'Access-Control-Max-Age': '600',
    };
  }

  function send(res, status, body, contentType) {
    const headers = {
      ...corsHeaders(),
      'x-correlation-id': `mock-${crypto.randomBytes(4).toString('hex')}`,
    };
    if (body !== undefined) headers['Content-Type'] = contentType;
    res.writeHead(status, headers);
    res.end(body);
  }

  function sendJson(res, status, obj) {
    send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
  }

  function sendError(res, status, message) {
    sendJson(res, status, { statusCode: status, message });
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('본문이 너무 큽니다'));
          req.destroy();
          return;
        }
        parts.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });
  }

  function subscriptionOf(account, state) {
    return {
      tier: state.opusSubscribed ? 3 : 0,
      active: !!state.opusSubscribed,
      expiresAt: 1893456000,
      perks: {
        maxPriorityActions: 1000,
        startPriority: 10,
        moduleTrainingSteps: 10000,
        unlimitedMaxPriority: true,
        voiceGeneration: true,
        imageGeneration: true,
        unlimitedImageGeneration: !!state.opusSubscribed,
        unlimitedImageGenerationLimits: [],
        contextTokens: 8192,
      },
      paymentProcessorData: null,
      trainingStepsLeft: {
        fixedTrainingStepsLeft: Math.max(0, Math.round(state.anlas)),
        purchasedTrainingSteps: 0,
      },
      accountType: 0,
      isGracePeriod: false,
      usage: {
        percent: state.percent,
        purchasedPercent: state.purchasedPercent,
        isNegative: !!state.isNegative,
        timeUntilNextPercent: account.timeUntilNextPercent,
      },
    };
  }

  function userDataOf(account, state) {
    return {
      priority: { maxPriorityActions: 1000, nextRefillAt: 0, taskPriority: 10 },
      subscription: subscriptionOf(account, state),
      keystore: null,
      settings: '',
      information: {
        emailVerified: true,
        emailVerificationLetterSent: true,
        trialActivated: true,
        trialActionsLeft: 0,
        trialImagesLeft: 0,
        accountCreatedAt: 1700000000,
        mockAccountName: account.name,
      },
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
  }

  function delayFor(account) {
    const base = Number(account.delayMs) || 0;
    const jitter = Number(account.delayJitterMs) || 0;
    return base + (jitter ? (Math.random() * 2 - 1) * jitter : 0);
  }

  function clampSize(v, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(64, Math.min(4096, n));
  }

  function isEvery(n, count) {
    const every = Math.round(Number(n) || 0);
    return every > 0 && count % every === 0;
  }

  /**
   * 생성 1장의 비용 처리. 반환 { ok, note } 또는 { ok:false, status, message }.
   * - V5(nai-diffusion-5*): Opus 구독이고 isNegative 가 아니면 무료분 → 추가 충전분 순서로 usagePerImage 차감,
   *   차감 뒤 둘 다 0 이면 isNegative=true. 그 밖(미구독·isNegative)은 Anlas.
   * - V5 아님: Opus 구독 + 1MP 이하 + 28스텝 이하 = 무료(차감 없음), 아니면 Anlas.
   */
  function charge(account, state, model, width, height, steps) {
    const isV5 = /^nai-diffusion-5/.test(String(model || ''));
    const before = `free ${state.percent}% / boost ${state.purchasedPercent}% / anlas ${state.anlas}`;
    let useAnlas;
    if (isV5) {
      useAnlas = !state.opusSubscribed || state.isNegative;
      if (!useAnlas) {
        const cost = Math.max(0, Number(account.usagePerImage) || 0);
        if (state.percent > 0) state.percent = Math.max(0, state.percent - cost);
        else if (state.purchasedPercent > 0) state.purchasedPercent = Math.max(0, state.purchasedPercent - cost);
        else useAnlas = true; // isNegative=false 인데 둘 다 0 인 경계 — Anlas 로
        if (!useAnlas && state.percent <= 0 && state.purchasedPercent <= 0) state.isNegative = true;
      }
    } else {
      useAnlas = !(state.opusSubscribed && width * height <= 1048576 && (Number(steps) || 0) <= 28);
    }
    if (useAnlas) {
      const cost = Math.max(0, Number(account.anlasPerImage) || 0);
      if (state.anlas < cost) {
        // 실제 NovelAI 402 문구는 추정. 앱은 「anlas」 낱말로 할당량 오류(quota)로 분류한다.
        return { ok: false, status: 402, message: 'Not enough Anlas to perform this action.' };
      }
      state.anlas -= cost;
    }
    const after = `free ${state.percent}% / boost ${state.purchasedPercent}% / anlas ${state.anlas}`;
    return { ok: true, note: useAnlas ? `Anlas -${account.anlasPerImage} (${before} → ${after})` : `${before} → ${after}${state.isNegative ? ' [isNegative]' : ''}` };
  }

  function stamp() {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  }

  function logLine(who, method, url, status, extra) {
    log(`[${stamp()}] ${who} ${method} ${url} → ${status}${extra ? ' ' + extra : ''}`);
  }

  // 생성 계열(생성·증강·업스케일) 공통: 인증 → 동시 잠금 → 429 → 지연 → 실패/비용 → 응답.
  async function handleGeneration(req, res, ctx, kind) {
    const { token, account, state } = ctx;
    const who = `${account.name}(${maskToken(token)})`;
    if (state.busy) {
      logLine(who, req.method, req.url, 409, '동시 생성 잠금');
      return sendError(res, 409, 'Concurrent generation is locked');
    }
    state.busy = true;
    try {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      } catch (e) {
        logLine(who, req.method, req.url, 400, 'JSON 오류');
        return sendError(res, 400, 'mock: invalid JSON body');
      }
      state.attempts += 1;
      if (isEvery(account.rateLimit429Every, state.attempts)) {
        logLine(who, req.method, req.url, 429, `시도 ${state.attempts}`);
        return sendError(res, 429, 'Too many requests, please slow down.');
      }
      if (isEvery(account.conflict409Every, state.attempts)) {
        logLine(who, req.method, req.url, 409, `시도 ${state.attempts} 잠금 흉내`);
        return sendError(res, 409, 'Concurrent generation is locked');
      }
      await sleep(delayFor(account));
      if (!scenario.accounts.has(token)) {
        logLine(who, req.method, req.url, 401, '대기 중 시나리오에서 빠짐');
        return sendError(res, 401, 'Unauthorized');
      }
      const live = scenario.accounts.get(token); // 대기 중 파일이 바뀌었으면 새 값
      if (live.authFail) {
        logLine(who, req.method, req.url, 401, 'authFail');
        return sendError(res, 401, 'Unauthorized');
      }
      if (isEvery(live.failEvery, state.attempts)) {
        logLine(who, req.method, req.url, 500, `시도 ${state.attempts} 실패 흉내`);
        return sendError(res, 500, 'mock: simulated server error');
      }

      const params = (body && body.parameters) || {};
      const rgb = colorFor(live);
      if (kind === 'generate') {
        const width = clampSize(params.width, 832);
        const height = clampSize(params.height, 1216);
        const seed = params.seed ?? 0;
        const steps = params.steps ?? 28;
        const result = charge(live, state, body.model, width, height, steps);
        if (!result.ok) {
          logLine(who, req.method, req.url, result.status, `Anlas 부족(${state.anlas})`);
          return sendError(res, result.status, result.message);
        }
        state.generated += 1;
        const comment = {
          prompt: body.input ?? '',
          uc: params.negative_prompt ?? '',
          steps,
          height,
          width,
          scale: params.scale,
          seed,
          sampler: params.sampler,
          noise_schedule: params.noise_schedule,
          cfg_rescale: params.cfg_rescale,
          n_samples: 1,
          v4_prompt: params.v4_prompt,
          v4_negative_prompt: params.v4_negative_prompt,
          request_type: body.action === 'infill' ? 'NativeInfillingRequest' : body.action === 'img2img' ? 'Img2ImgRequest' : 'PromptGenerateRequest',
          mock_account: live.name,
        };
        const png = makePng(width, height, rgb, seed, [
          ['Title', 'NovelAI generated image'],
          ['Description', body.input ?? ''],
          ['Software', 'NovelAI'],
          ['Source', `SDStudio mock NAI (${body.model || 'unknown'})`],
          ['Comment', JSON.stringify(comment)],
        ]);
        logLine(who, req.method, req.url, 200, `${body.action || '?'} ${width}x${height} seed=${seed} #${state.generated} ${result.note}`);
        return send(res, 200, makeZip([{ name: 'image_0.png', data: png }]), 'application/x-zip-compressed');
      }
      if (kind === 'augment') {
        const width = clampSize(body.width, 832);
        const height = clampSize(body.height, 1216);
        const png = makePng(width, height, rgb, Date.now(), [['Software', 'NovelAI'], ['Comment', JSON.stringify({ prompt: body.prompt ?? '', req_type: body.req_type, mock_account: live.name })]]);
        logLine(who, req.method, req.url, 200, `${body.req_type} ${width}x${height}`);
        return send(res, 200, makeZip([{ name: 'image_0.png', data: png }]), 'application/x-zip-compressed');
      }
      // upscale
      const raw = String(body.image || '').replace(/^data:[^,]*,/, '');
      const size = pngSize(Buffer.from(raw, 'base64'));
      if (!size) {
        logLine(who, req.method, req.url, 400, '입력이 PNG 아님');
        return sendError(res, 400, 'mock: upscale input must be PNG');
      }
      const width = Math.min(4096, size.width * 4);
      const height = Math.min(4096, size.height * 4);
      const png = makePng(width, height, rgb, width + height, [['Software', 'NovelAI'], ['Comment', JSON.stringify({ prompt: '', mock_account: live.name, upscaled_from: size })]]);
      logLine(who, req.method, req.url, 200, `${size.width}x${size.height} → ${width}x${height}`);
      return send(res, 200, makeZip([{ name: 'image_0.png', data: png }]), 'application/x-zip-compressed');
    } finally {
      state.busy = false;
    }
  }

  async function handle(req, res) {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    // 관리용
    if (url === '/__mock/state' && req.method === 'GET') {
      const list = [];
      for (const [token, account] of scenario.accounts) {
        const s = states.get(token);
        list.push({
          name: account.name,
          token: maskToken(token),
          ...Object.fromEntries(STATE_FIELDS.map((f) => [f, s[f]])),
          attempts: s.attempts,
          generated: s.generated,
          busy: s.busy,
        });
      }
      return sendJson(res, 200, { accounts: list });
    }
    if (url === '/__mock/reset' && (req.method === 'POST' || req.method === 'GET')) {
      applyScenario(scenario, { reset: true });
      log(`[${stamp()}] /__mock/reset — 모든 계정 상태를 시나리오 값으로 되돌림`);
      return sendJson(res, 200, { ok: true });
    }

    const ctx = accountFromRequest(req);
    const routes = {
      'GET /user/data': 'userdata',
      'GET /user/subscription': 'subscription',
      'POST /ai/generate-image': 'generate',
      'POST /ai/augment-image': 'augment',
      'POST /ai/upscale': 'upscale',
      'POST /ai/encode-vibe': 'vibe',
      'POST /user/login': 'login',
    };
    const route = routes[`${req.method} ${url}`];
    if (!route) {
      logLine('-', req.method, url, 404);
      return sendError(res, 404, 'Not Found');
    }
    if (route === 'login') {
      logLine('-', req.method, url, 400, '이메일 로그인 미지원');
      return sendError(res, 400, 'mock: email login is not supported — use token login');
    }
    if (!ctx.account) {
      logLine(ctx.token ? `알 수 없는 토큰(${maskToken(ctx.token)})` : '토큰 없음', req.method, url, 401);
      return sendError(res, 401, 'Unauthorized');
    }
    const who = `${ctx.account.name}(${maskToken(ctx.token)})`;
    if (ctx.account.authFail) {
      logLine(who, req.method, url, 401, 'authFail');
      return sendError(res, 401, 'Unauthorized');
    }
    if (route === 'userdata') {
      const data = userDataOf(ctx.account, ctx.state);
      logLine(who, req.method, url, 200, `free ${ctx.state.percent}% / boost ${ctx.state.purchasedPercent}% / anlas ${ctx.state.anlas}${ctx.state.isNegative ? ' [isNegative]' : ''}`);
      return sendJson(res, 200, data);
    }
    if (route === 'subscription') {
      logLine(who, req.method, url, 200);
      return sendJson(res, 200, subscriptionOf(ctx.account, ctx.state));
    }
    if (route === 'vibe') {
      await readBody(req).catch(() => Buffer.alloc(0));
      const bytes = crypto.createHash('sha256').update(ctx.token).digest();
      logLine(who, req.method, url, 200, '가짜 바이브 인코딩');
      return send(res, 200, Buffer.concat(Array(32).fill(bytes)), 'application/octet-stream');
    }
    return handleGeneration(req, res, ctx, route);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`[${stamp()}] 처리 오류 ${req.method} ${req.url}: ${e && e.message}`);
      if (!res.headersSent) sendError(res, 500, 'mock: internal error');
      else res.end();
    });
  });

  return {
    server,
    setScenarioJson,
    reset: () => applyScenario(scenario, { reset: true }),
    stateOf: (token) => states.get(token),
  };
}

// ───────────────────────── 실행 ─────────────────────────

function parseArgs(argv) {
  const out = { port: undefined, scenario: undefined, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') out.selftest = true;
    else if (a === '--port') out.port = argv[++i];
    else if (a.startsWith('--port=')) out.port = a.slice(7);
    else if (a === '--scenario') out.scenario = argv[++i];
    else if (a.startsWith('--scenario=')) out.scenario = a.slice(11);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function defaultScenarioPath() {
  const local = path.join(__dirname, 'scenario.local.json');
  return fs.existsSync(local) ? local : path.join(__dirname, 'scenario.json');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('사용: node dev/mock-nai/server.cjs [--port 18080] [--scenario 경로] [--selftest]');
    return;
  }
  if (args.selftest) {
    selfTest().then(
      (ok) => process.exit(ok ? 0 : 1),
      (e) => {
        console.error('자체 점검 오류:', e);
        process.exit(1);
      },
    );
    return;
  }
  const port = Number(args.port ?? process.env.MOCK_NAI_PORT ?? DEFAULT_PORT);
  const scenarioPath = path.resolve(args.scenario ?? process.env.MOCK_NAI_SCENARIO ?? defaultScenarioPath());
  const mock = createMockServer();

  const load = (first) => {
    try {
      const text = fs.readFileSync(scenarioPath, 'utf8').replace(/^﻿/, '');
      mock.setScenarioJson(JSON.parse(text));
      if (!first) console.log(`[${new Date().toTimeString().slice(0, 8)}] 시나리오 다시 읽음: ${scenarioPath}`);
      return true;
    } catch (e) {
      console.error(`시나리오를 읽지 못했습니다(${scenarioPath}): ${e.message}${first ? '' : ' — 이전 값 유지'}`);
      return false;
    }
  };
  if (!load(true)) process.exit(1);
  // 파일 감시(Windows 에서도 안정적인 polling 방식, 0.5초)
  fs.watchFile(scenarioPath, { interval: 500 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs) load(false);
  });

  mock.server.listen(port, HOST, () => {
    console.log(`가짜 NovelAI 서버: http://${HOST}:${port}`);
    console.log(`시나리오: ${scenarioPath}`);
    if (path.basename(scenarioPath) === 'scenario.json') {
      console.log('(샘플 파일을 쓰는 중 — 고쳐 쓰려면 scenario.local.json 으로 복사하세요)');
    }
    console.log(`앱 연결: PowerShell 에서 $env:SDSTUDIO_NAI_API_BASE = "http://${HOST}:${port}" 후 SDStudio.exe 실행`);
  });
  mock.server.on('error', (e) => {
    console.error(`서버를 열지 못했습니다: ${e.message}`);
    process.exit(1);
  });
}

// ───────────────────────── 자체 점검 ─────────────────────────

/** stored zip 의 첫 항목을 꺼낸다(자체 점검용). */
function readFirstZipEntry(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 서명 아님');
  const method = buf.readUInt16LE(8);
  const crc = buf.readUInt32LE(14);
  const size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.toString('utf8', 30, 30 + nameLen);
  const data = buf.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size);
  if (method !== 0) throw new Error('stored 가 아님');
  if (crc32(data) !== crc) throw new Error('zip CRC 불일치');
  if (buf.readUInt32LE(buf.length - 22) !== 0x06054b50) throw new Error('zip 끝 레코드 없음');
  return { name, data };
}

/** PNG 전체 검사: 서명·청크 CRC·IHDR·IDAT 해제 크기·tEXt. */
function inspectPng(buf) {
  const size = pngSize(buf);
  if (!size) throw new Error('PNG 서명/IHDR 아님');
  let off = 8;
  const idat = [];
  const texts = {};
  let ended = false;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== crc) throw new Error(`${type} CRC 불일치`);
    if (type === 'IDAT') idat.push(data);
    if (type === 'tEXt') {
      const z = data.indexOf(0);
      texts[data.toString('latin1', 0, z)] = data.toString('utf8', z + 1);
    }
    if (type === 'IEND') {
      ended = true;
      break;
    }
    off += 12 + len;
  }
  if (!ended) throw new Error('IEND 없음');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length !== (size.width * 3 + 1) * size.height) throw new Error('IDAT 크기 불일치');
  return { ...size, texts };
}

function request(port, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = payload.length;
    const req = http.request({ host: HOST, port, method, path: urlPath, headers }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function selfTest() {
  const results = [];
  const check = (name, cond, detail) => {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? '통과' : '실패'}  ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  };
  const mock = createMockServer({ log: () => {} });
  const scenario = {
    defaults: { delayMs: 0 },
    accounts: [
      { token: 'mock-st-a', name: 'A', percent: 10, purchasedPercent: 5, usagePerImage: 5, anlas: 25, anlasPerImage: 20 },
      { token: 'mock-st-b', name: 'B', delayMs: 300 },
      { token: 'mock-st-c', name: 'C', rateLimit429Every: 2 },
      { token: 'mock-st-d', name: 'D', authFail: true },
      { token: 'mock-st-e', name: 'E', failEvery: 1 },
      { token: 'mock-st-g', name: 'G', conflict409Every: 1 },
      { token: 'mock-st-f', name: 'F', opusSubscribed: false, percent: 100 },
    ],
  };
  mock.setScenarioJson(scenario);
  await new Promise((r) => mock.server.listen(0, HOST, r));
  const port = mock.server.address().port;
  const genBody = (seed) => ({
    input: 'test prompt, 1girl',
    model: 'nai-diffusion-5-full',
    action: 'generate',
    parameters: { width: 320, height: 192, seed, steps: 23, scale: 5, sampler: 'k_euler_ancestral', negative_prompt: 'bad' },
  });
  try {
    // 시나리오 검사
    let threw = false;
    try {
      createMockServer({ log: () => {} }).setScenarioJson({ accounts: [{ token: 'pst-real-looking' }] });
    } catch {
      threw = true;
    }
    check('시나리오: mock- 접두 없는 토큰 거부', threw);

    // CORS 사전 요청
    const pre = await request(port, 'OPTIONS', '/user/data');
    check('OPTIONS 204 + CORS 헤더', pre.status === 204 && pre.headers['access-control-allow-origin'] === '*' && /Authorization/.test(pre.headers['access-control-allow-headers'] || ''));

    // 사용자 정보
    const ud = await request(port, 'GET', '/user/data', { token: 'mock-st-a' });
    const udJson = JSON.parse(ud.body.toString('utf8'));
    const sub = udJson.subscription;
    check('GET /user/data 200 + 구독·잔량·할당 형식', ud.status === 200 && sub.active === true && sub.tier === 3 && sub.trainingStepsLeft.fixedTrainingStepsLeft === 25 && sub.usage.percent === 10 && sub.usage.purchasedPercent === 5 && sub.usage.isNegative === false && typeof sub.usage.timeUntilNextPercent === 'number');
    const udF = JSON.parse((await request(port, 'GET', '/user/data', { token: 'mock-st-f' })).body.toString('utf8'));
    check('미구독 계정 = active false·tier 0', udF.subscription.active === false && udF.subscription.tier === 0);
    const udAuto = await request(port, 'GET', '/user/data', { token: 'any-dummy-token' });
    check('모르는 토큰 = defaults 로 자동 등록 200', udAuto.status === 200 && JSON.parse(udAuto.body.toString('utf8')).subscription.usage.percent === 100);
    check('토큰 없음 401', (await request(port, 'GET', '/user/data')).status === 401);
    check('authFail 401', (await request(port, 'GET', '/user/data', { token: 'mock-st-d' })).status === 401);
    check('없는 경로 404', (await request(port, 'GET', '/nope', { token: 'mock-st-a' })).status === 404);

    // 생성 — zip·PNG·메타
    const g1 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-a', body: genBody(12345) });
    check('생성 200 + Content-Type zip', g1.status === 200 && /zip/.test(g1.headers['content-type'] || ''));
    const entry = readFirstZipEntry(g1.body);
    check('zip 항목 이름 image_0.png', entry.name === 'image_0.png');
    let png;
    try {
      png = inspectPng(entry.data);
    } catch (e) {
      png = null;
      check('PNG 유효(서명·CRC·IDAT)', false, e.message);
    }
    if (png) {
      check('PNG 유효(서명·CRC·IDAT)', true);
      check('PNG 크기 = 요청 해상도 320x192', png.width === 320 && png.height === 192);
      let comment = null;
      try {
        comment = JSON.parse(png.texts.Comment);
      } catch {}
      check('tEXt Comment JSON(prompt·seed·steps)', comment && comment.prompt === 'test prompt, 1girl' && comment.seed === 12345 && comment.steps === 23 && comment.uc === 'bad');
      check('tEXt Source·Software', /mock/.test(png.texts.Source || '') && png.texts.Software === 'NovelAI');
    }
    // 앱과 같은 해제 경로(JSZip — 저장소 node_modules 에 있으면)
    let JSZip = null;
    try {
      JSZip = require('jszip');
    } catch {}
    if (JSZip) {
      const zip = await JSZip.loadAsync(g1.body);
      const names = Object.keys(zip.files);
      const b64 = await zip.file(names[0]).async('base64');
      check('JSZip 으로 해제 = 같은 PNG(앱 nai.ts 경로)', names.length === 1 && Buffer.from(b64, 'base64').equals(entry.data));
    } else {
      console.log('건너뜀  JSZip 해제 확인(jszip 모듈 없음)');
    }

    // 차감: A = 무료 10 → 5 → 0(→ 추가 충전 5) → 0 → isNegative → Anlas 25-20=5 → 402
    let s = mock.stateOf('mock-st-a');
    check('1장 뒤 무료 10→5', s.percent === 5 && s.purchasedPercent === 5);
    await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-a', body: genBody(2) });
    check('2장 뒤 무료 0, 추가 충전 5, isNegative false', s.percent === 0 && s.purchasedPercent === 5 && s.isNegative === false);
    await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-a', body: genBody(3) });
    check('3장 뒤 추가 충전 0 → isNegative true', s.purchasedPercent === 0 && s.isNegative === true);
    const g4 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-a', body: genBody(4) });
    check('4장(isNegative) = Anlas 25→5', g4.status === 200 && s.anlas === 5);
    const g5 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-a', body: genBody(5) });
    const g5msg = JSON.parse(g5.body.toString('utf8'));
    check('5장 Anlas 부족 = 402 + statusCode/message(「Anlas」)', g5.status === 402 && g5msg.statusCode === 402 && /anlas/i.test(g5msg.message));
    const udAfter = JSON.parse((await request(port, 'GET', '/user/data', { token: 'mock-st-a' })).body.toString('utf8'));
    check('/user/data 에 차감 반영', udAfter.subscription.usage.isNegative === true && udAfter.subscription.trainingStepsLeft.fixedTrainingStepsLeft === 5);

    // V4.5 Opus 소형 = 무료, 미구독 = Anlas
    const v45 = { ...genBody(9), model: 'nai-diffusion-4-5-full' };
    const sF = mock.stateOf('mock-st-f');
    const anlasF = sF.anlas;
    await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-f', body: v45 });
    check('미구독 V4.5 = Anlas 차감', sF.anlas === anlasF - 20);
    const sB = mock.stateOf('mock-st-b');
    const pB = sB.percent;

    // 409 동시 잠금(B 는 300ms 지연)
    const [r1, r2] = await Promise.all([
      request(port, 'POST', '/ai/generate-image', { token: 'mock-st-b', body: genBody(7) }),
      new Promise((r) => setTimeout(r, 50)).then(() => request(port, 'POST', '/ai/generate-image', { token: 'mock-st-b', body: genBody(8) })),
    ]);
    const lockMsg = (() => {
      try {
        return JSON.parse(r2.body.toString('utf8')).message;
      } catch {
        return '';
      }
    })();
    check('같은 토큰 동시 요청 = 하나 200·하나 409 「Concurrent generation is locked」', r1.status === 200 && r2.status === 409 && lockMsg === 'Concurrent generation is locked');
    check('409 는 차감 안 함(1장분만)', sB.percent === pB - 5);
    const r3 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-b', body: genBody(9) });
    check('잠금은 응답 뒤 풀림', r3.status === 200);
    // 다른 토큰은 동시에 가능
    const [x1, x2] = await Promise.all([
      request(port, 'POST', '/ai/generate-image', { token: 'mock-st-b', body: genBody(10) }),
      request(port, 'POST', '/ai/generate-image', { token: 'mock-st-f', body: v45 }),
    ]);
    check('다른 토큰은 동시에 200', x1.status === 200 && x2.status === 200);

    // 429 / 500 / authFail 생성
    const c1 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-c', body: genBody(1) });
    const c2 = await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-c', body: genBody(1) });
    check('rateLimit429Every=2 → 1번째 200, 2번째 429', c1.status === 200 && c2.status === 429);
    check('conflict409Every=1 → 409', (await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-g', body: genBody(1) })).status === 409);
    check('failEvery=1 → 500', (await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-e', body: genBody(1) })).status === 500);
    check('authFail 생성 401', (await request(port, 'POST', '/ai/generate-image', { token: 'mock-st-d', body: genBody(1) })).status === 401);

    // 증강·업스케일·바이브
    const aug = await request(port, 'POST', '/ai/augment-image', { token: 'mock-st-b', body: { image: 'x', req_type: 'bg-removal', width: 128, height: 96 } });
    check('증강 200 + PNG 128x96', aug.status === 200 && inspectPng(readFirstZipEntry(aug.body).data).width === 128);
    const small = makePng(64, 80, [10, 20, 30], 1, []).toString('base64');
    const up = await request(port, 'POST', '/ai/upscale', { token: 'mock-st-b', body: { image: small, model: 'x', declared_blur_sigma: 0 } });
    const upEntry = readFirstZipEntry(up.body);
    const upPng = inspectPng(upEntry.data);
    check('업스케일 200 + image_0.png ×4(256x320)', up.status === 200 && /^image[^/]*\.png$/.test(upEntry.name) && upPng.width === 256 && upPng.height === 320);
    const vibe = await request(port, 'POST', '/ai/encode-vibe', { token: 'mock-st-b', body: { image: 'x' } });
    check('바이브 인코딩 200 + 바이트', vibe.status === 200 && vibe.body.length > 0);
    check('이메일 로그인 400', (await request(port, 'POST', '/user/login', { body: { key: 'x' } })).status === 400);

    // 시나리오 변경 반영(바뀐 값만) · reset
    s = mock.stateOf('mock-st-a');
    mock.setScenarioJson({ ...scenario, accounts: scenario.accounts.map((a) => (a.token === 'mock-st-a' ? { ...a, anlas: 500 } : a)) });
    check('파일 수정 = 바뀐 값(anlas)만 반영, 줄어든 percent 유지', s.anlas === 500 && s.percent === 0 && s.isNegative === true);
    const rs = await request(port, 'POST', '/__mock/reset');
    s = mock.stateOf('mock-st-a');
    check('/__mock/reset = 시나리오 값으로 초기화', rs.status === 200 && s.percent === 10 && s.purchasedPercent === 5 && s.isNegative === false && s.attempts === 0);
    const st = JSON.parse((await request(port, 'GET', '/__mock/state')).body.toString('utf8'));
    check('/__mock/state 토큰은 앞 6자만', st.accounts.every((a) => a.token.length <= 7) && !JSON.stringify(st).includes('mock-st-a'));

    // 샘플 시나리오 파일 형식
    try {
      const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8'));
      createMockServer({ log: () => {} }).setScenarioJson(sample);
      check('샘플 scenario.json 읽기', true);
    } catch (e) {
      check('샘플 scenario.json 읽기', false, e.message);
    }
  } finally {
    mock.server.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n자체 점검: ${results.length - failed}/${results.length} 통과`);
  return failed === 0;
}

if (require.main === module) main();

module.exports = { createMockServer, makePng, makeZip, crc32, parseScenario };
