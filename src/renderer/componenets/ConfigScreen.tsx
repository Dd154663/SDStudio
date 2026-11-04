import { MobileV2Parts, normalizeV2Parts } from '../models/mobileV2';
import { useEffect, useState, useCallback, useRef } from 'react';
import { HScrollHintArrow, useHScrollHint } from './HScrollHint';
import {
  backend,
  imageService,
  isMobile,
  localAIService,
  loginService,
  sessionService,
} from '../models';
import { Config, ImageEditor, RemoveBgQuality, UiThemeConfig, UiToolbarConfig } from '../../main/config';
import { defaultLayoutTemplateId } from '../models/layoutTemplates';
import {
  MODERN_COMPANION_DEFAULTS,
} from '../models/companionSlots';
import { observer } from 'mobx-react-lite';
import { appState } from '../models/AppService';
import { validateName } from '../models/nameInput';
import { deleteConfirmText } from '../models/deleteFlowRules';
import {
  REQUEST_DELAY_DEFAULT_MS,
  REQUEST_DELAY_JITTER_DEFAULT_MS,
  REQUEST_DELAY_TEXT,
  resolveRequestDelaySettings,
  shouldWarnShortRequestDelay,
  withRequestDelaySettings,
} from '../models/requestTiming';
import {
  FaUser,
  FaFolder,
  FaTimes,
  FaKeyboard,
  FaWrench,
  FaPalette,
  FaSlidersH,
  FaThLarge,
  FaColumns,
  FaPen,
  FaGoogleDrive,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { useBackLayer } from '../models/BackStackService';
import { useBackdropClose } from './backdropClose';
import OpusUsageMeter, { OpusUsageHelp } from './OpusUsageMeter';
import { useOpusUsage } from './OpusUsageBadge';
import OpusUsageQuietToggle from './OpusUsageQuietToggle';
import { OPUS_USAGE_TEXT } from '../models/opusUsageRules';
import { DRIVE_SYNC_TEXT } from '../models/driveSync';
import { INSIDE_INSTALL_DIR_CODE, INSTALL_DIR_TEXT } from '../../shared/installDir';
import { runSaveLocationChange } from '../models/saveLocationChangeFlow';
import DriveSettingsTab from './DriveSettingsTab';
import KeyBindingsTab from './ConfigKeyBindingsTab';
import PersonalTab from './ConfigPersonalTab';
import SystemTab from './ConfigSystemTab';
import StorageImageTab, { RecoveryTab } from './ConfigStorageTab';
import CustomizationTab from './ConfigThemeTab';
import LayoutTab, { ToolbarTab } from './ConfigLayoutTab';
import type {
  LoginTokenProfile,
  LoginTokenUsageCheck,
} from '../models/LoginService';
import {
  minimumTokenRotateTarget,
  normalizeTokenRotateBalance,
  normalizeTokenRotateTarget,
  normalizeTokenRotateWarning,
  TOKEN_ROTATE_BALANCE_MAX,
  TOKEN_ROTATE_BALANCE_MIN,
  TOKEN_ROTATE_TARGET_MAX,
  TOKEN_ROTATE_WARNING_MAX,
  TOKEN_ROTATE_WARNING_MIN,
} from '../models/tokenAutoRotation';
import {
  BOOST_ACCOUNT_SCOPES,
  BOOST_SCOPE_LABEL,
  BOOST_TEXT,
  BoostActiveMode,
  BoostSettings,
  boostActiveModeOf,
  boostParticipantPreviewText,
  boostSettingsLock,
  boostSettingsToConfig,
  isBoostEnabled,
  needsBoostWarning,
  resolveBoostSettings,
  sameBoostSettings,
} from '../models/boostMode';
import { useBoostAccountLock } from './boostAccountLock';

interface ConfigScreenProps {
  onSave: () => void;
  onClose: () => void;
}

/* ── 탭 1: 로그인 ── */
const LoginTab = ({
  accessToken, setAccessToken,
  loggedIn, loginWithToken, roundTag,
  multiTokenAutoRotate, setMultiTokenAutoRotate,
  multiTokenRotateWarning, setMultiTokenRotateWarning,
  multiTokenRotateTarget, setMultiTokenRotateTarget,
  multiTokenBalanceRotate, setMultiTokenBalanceRotate,
  multiTokenRotateBalance, setMultiTokenRotateBalance,
  boostSettings, setBoostSettings,
  boostModeChoice, setBoostModeChoice,
}: any) => {
  const currentUsage = useOpusUsage();
  // 부스트 다중 계정 실행 중이면 계정 전환·토큰 로그인·토큰 삭제를 막는다(B3 — 서비스도 같은 조건으로 거부).
  const switchLocked = useBoostAccountLock();
  const [profiles, setProfiles] = useState<LoginTokenProfile[]>([]);
  const [profileToken, setProfileToken] = useState('');
  const [profilesReady, setProfilesReady] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  // Esc 로 편집을 취소한 뒤 따라오는 blur 가 확정하지 않도록(인라인 규칙 — D2)
  const profileRenameCancelledRef = useRef(false);
  const [checkingProfileUsages, setCheckingProfileUsages] = useState(false);
  const [profileUsageChecks, setProfileUsageChecks] = useState<
    Record<string, LoginTokenUsageCheck>
  >({});
  const rotateTargetMin = minimumTokenRotateTarget(multiTokenRotateWarning);
  const boost = boostSettings as BoostSettings;
  const boostOn = isBoostEnabled(boost);
  // D12 상호 배타 + 토큰 2개 조건 — 켜려는 쪽만 막는다(상대를 자동으로 끄지 않음).
  const boostLock = boostSettingsLock({
    boostOn,
    rotationOn: !!multiTokenAutoRotate,
    profileCount: profilesReady ? profiles.length : 0,
  });
  const [boostBusy, setBoostBusy] = useState(false);
  const [boostPreview, setBoostPreview] = useState<
    { activeName?: string; names: string[] } | 'error' | undefined
  >(undefined);

  const changeRotateWarning = (value: number) => {
    const warning = normalizeTokenRotateWarning(value);
    setMultiTokenRotateWarning(warning);
    setMultiTokenRotateTarget((current: number) =>
      normalizeTokenRotateTarget(current, warning),
    );
  };

  const syncProfiles = useCallback(() => {
    setProfiles(loginService.listTokenProfiles());
    setProfilesReady(true);
  }, []);

  useEffect(() => {
    const onChange = () => syncProfiles();
    loginService.addEventListener('token-profiles-change', onChange);
    loginService
      .loadTokenProfiles()
      .then(syncProfiles)
      .catch((e: any) => {
        setProfilesReady(true);
        appState.pushMessage(e.message || '토큰 프리셋을 불러오지 못했습니다');
      });
    return () =>
      loginService.removeEventListener('token-profiles-change', onChange);
  }, [syncProfiles]);

  // 부스트 참여 후보 미리보기(이름만, 할당량 조회 없음) — 토큰 목록·로그인이 바뀌면 다시 읽는다.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      loginService
        .getBoostParticipantPreview()
        .then((preview) => {
          if (!cancelled) setBoostPreview(preview);
        })
        .catch(() => {
          if (!cancelled) setBoostPreview('error');
        });
    };
    load();
    loginService.addEventListener('token-profiles-change', load);
    loginService.addEventListener('change', load);
    return () => {
      cancelled = true;
      loginService.removeEventListener('token-profiles-change', load);
      loginService.removeEventListener('change', load);
    };
  }, []);

  // 부스트 켜기/끄기. 켤 때(끄기 → 켜기)는 D11 경고 창 — 확인 버튼 클릭으로만 켜지고(Enter 무시), 취소·Esc·뒤로 가기는
  // 켜지 않는다. 「다시 보지 않음」은 확인했을 때만 기기별 config(boostWarningDismissed)에 바로 저장(동기화 제외).
  // 이번 앱 세션에서 한 번 확인했으면 다시 묻지 않는다(LoginService.boostWarningAccepted — 앱 재실행 시 다시).
  const toggleBoost = async (next: boolean) => {
    if (boostBusy) return;
    if (!next) {
      setBoostSettings((cur: BoostSettings) => ({ ...cur, mode: 'off' }));
      return;
    }
    if (boostOn || boostLock.boostBlocked) return;
    setBoostBusy(true);
    try {
      let dismissed = false;
      try {
        dismissed = (await backend.getConfig()).boostWarningDismissed === true;
      } catch (e) {}
      if (
        needsBoostWarning({
          wasOn: boostOn,
          nextOn: true,
          dismissed,
          acceptedThisSession: loginService.boostWarningAccepted,
        })
      ) {
        let dontShowAgain = false;
        const ok = await appState.confirmAsync({
          text: BOOST_TEXT.warningText(boost.scope),
          confirmText: BOOST_TEXT.warningConfirm,
          danger: true,
          requireClick: true,
          confirmCheck: {
            label: BOOST_TEXT.warningDismiss,
            onChange: (checked: boolean) => {
              dontShowAgain = checked;
            },
          },
        });
        if (!ok) return;
        loginService.boostWarningAccepted = true;
        if (dontShowAgain) {
          try {
            const latest = await backend.getConfig();
            await backend.setConfig({ ...latest, boostWarningDismissed: true });
          } catch (e) {
            appState.pushMessage('「다시 보지 않음」 설정을 저장하지 못했습니다', 'error');
          }
        }
      }
      setBoostSettings((cur: BoostSettings) => ({ ...cur, mode: boostModeChoice }));
    } finally {
      setBoostBusy(false);
    }
  };

  const chooseBoostMode = (mode: BoostActiveMode) => {
    setBoostModeChoice(mode);
    if (boostOn) setBoostSettings((cur: BoostSettings) => ({ ...cur, mode }));
  };

  // 다중 계정 위험 경고(순회·부스트 공용 문구) — 순회 또는 부스트가 켜져 있을 때 각 영역에 표시.
  const multiAccountWarning = (
    <div className="back-orange rounded-lg p-3 text-xs">
      다중 계정 사용은 NovelAI 정책에 따라 제재 또는 계정 제한 위험이 있을 수
      있으며, 사용에 대한 책임은 사용자에게 있습니다.
    </div>
  );

  const saveProfile = async () => {
    if (profileBusy) return;
    setProfileBusy(true);
    try {
      await loginService.saveToken(profileToken);
      setProfileToken('');
      appState.pushMessage('토큰을 저장했습니다');
    } catch (e: any) {
      appState.pushMessage(e.message || '토큰 프리셋 저장에 실패했습니다');
    } finally {
      setProfileBusy(false);
    }
  };

  const activateProfile = async (profile: LoginTokenProfile) => {
    if (profileBusy) return;
    setProfileBusy(true);
    try {
      await loginService.activateTokenProfile(profile.id);
      appState.pushMessage(`${profile.name} 계정으로 전환했습니다`);
    } catch (e: any) {
      appState.pushMessage(e.message || '계정 전환에 실패했습니다');
    } finally {
      setProfileBusy(false);
    }
  };

  const startProfileRename = (profile: LoginTokenProfile) => {
    if (profileBusy) return;
    profileRenameCancelledRef.current = false;
    setEditingProfileId(profile.id);
    setProfileNameDraft(profile.name);
  };

  const cancelProfileRename = () => {
    profileRenameCancelledRef.current = true;
    setEditingProfileId(null);
  };

  // 확정(Enter → blur, 칸 밖 클릭 blur). 실패하면 편집을 유지하고 입력을 보존한다(D2 인라인 규칙).
  const commitProfileRename = async (profile: LoginTokenProfile) => {
    if (profileRenameCancelledRef.current) return;
    if (editingProfileId !== profile.id || profileBusy) return;
    const nextName = profileNameDraft.trim();
    if (nextName === profile.name) {
      setEditingProfileId(null);
      return;
    }
    const problem = validateName(nextName, {
      kind: 'token',
      current: profile.name,
      maxLength: 40,
      existing: (n) =>
        profiles.some((p) => p.id !== profile.id && p.name.toLowerCase() === n.toLowerCase()),
    });
    if (problem) {
      appState.pushMessage(problem, 'error');
      return;
    }
    setProfileBusy(true);
    try {
      await loginService.renameTokenProfile(profile.id, nextName);
      setEditingProfileId((cur) => (cur === profile.id ? null : cur));
    } catch (e: any) {
      appState.pushMessage(e.message || '토큰 이름 변경에 실패했습니다', 'error');
    } finally {
      setProfileBusy(false);
    }
  };

  const deleteProfile = (profile: LoginTokenProfile) => {
    appState.pushDialog({
      type: 'confirm',
      // 휴지통이 없다 — 영구 삭제(Enter 무시, 2026-10-03 E1)
      ...deleteConfirmText({
        kind: 'token',
        name: profile.name,
        outcome: 'permanent',
        extra: '현재 로그인 토큰은 삭제하거나 로그아웃하지 않습니다.',
      }),
      callback: async () => {
        setProfileBusy(true);
        try {
          await loginService.deleteTokenProfile(profile.id);
          appState.pushMessage('토큰 프리셋을 삭제했습니다');
        } catch (e: any) {
          appState.pushMessage(e.message || '토큰 프리셋 삭제에 실패했습니다');
        } finally {
          setProfileBusy(false);
        }
      },
    });
  };

  const checkProfileUsages = async () => {
    if (profileBusy || profiles.length === 0) return;
    setProfileBusy(true);
    setCheckingProfileUsages(true);
    try {
      const results = await loginService.checkTokenProfileUsages();
      setProfileUsageChecks(
        Object.fromEntries(results.map((result) => [result.id, result])),
      );
    } catch (e: any) {
      appState.pushMessage(e.message || '저장 토큰 할당량 조회에 실패했습니다');
    } finally {
      setCheckingProfileUsages(false);
      setProfileBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-semibold gray-label mb-2">
          API 토큰으로 로그인
        </label>
        <div className="flex gap-2 mb-2">
          <input className="gray-input block flex-1" type="password"
            placeholder="API 토큰을 붙여넣으세요"
            value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
        </div>
        <div className="flex items-center">
          <p className="flex items-center gap-1">
            <span className="text-sm gray-label">로그인 상태:</span>{' '}
            {loggedIn
              ? <span className={`${roundTag} back-green`}>Yes</span>
              : <span className={`${roundTag} back-red`}>No</span>}
          </p>
          <button className="btn back-sky py-1 px-3 rounded ml-auto"
            disabled={!!switchLocked}
            onClick={loginWithToken}>
            토큰 로그인
          </button>
        </div>
        {switchLocked && (
          <p className="text-xs text-muted mt-2" data-boost-switch-locked>
            {switchLocked}
          </p>
        )}
      </div>
      <hr className="line-color" />
      {/* 토큰 발급/로그인 가이드 */}
      <div className="rounded-lg border line-color bg-gray-50 dark:bg-slate-700/40 p-4 text-sm text-body">
        <p className="font-medium mb-1">토큰 발급 방법</p>
        <ol className="list-decimal list-inside space-y-1 mb-3 leading-relaxed text-body">
          <li>
            <a
              className="text-sky-500 hover:text-sky-400 cursor-pointer underline"
              onClick={() => backend.openWebPage('https://novelai.net')}
            >
              NovelAI 공식 웹사이트
            </a>
            에 로그인
          </li>
          <li>좌측 사이드바의 톱니바퀴 아이콘 (User Settings) 클릭</li>
          <li>Account 탭으로 이동</li>
          <li>"Get Persistent API Token" 버튼 클릭</li>
          <li>프롬프트가 표시됨. 처음 생성해도 "overwrite" 메시지가 뜰 수 있으며 이는 정상</li>
          <li>복사 아이콘으로 토큰을 클립보드에 복사</li>
        </ol>
        <p className="font-medium mb-1">로그인 방법</p>
        <ol className="list-decimal list-inside space-y-1 leading-relaxed text-body">
          <li>위 "API 토큰으로 로그인" 칸에 복사한 토큰을 붙여넣고 [토큰 로그인] 클릭</li>
        </ol>
      </div>

      <hr className="line-color" />
      <div className="space-y-2">
        <p className="text-sm font-semibold gray-label">Opus 할당량 안내</p>
        <div className="rounded-lg border line-color bg-[var(--c-surface-2)] p-3">
          {/* 할당량 상세 창(상단 배지)의 토글과 같은 값 — 바꾸는 즉시 저장된다. */}
          <OpusUsageQuietToggle id="cfgOpusUsageQuiet" />
        </div>
      </div>

      <hr className="line-color" />
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold gray-label">여러 토큰</p>
            <button
              className="btn back-sky rounded px-3 py-1.5 text-xs ml-auto flex-none whitespace-nowrap"
              disabled={profileBusy || profiles.length === 0}
              onClick={checkProfileUsages}
            >
              {checkingProfileUsages ? '조회 중…' : '할당량 새로고침'}
            </button>
          </div>
          <p className="text-xs text-muted mt-1">
            토큰을 개별 저장하고 수동으로 전환하거나, V5 할당량에 따라 보수적으로
            자동 순회할 수 있습니다.
          </p>
        </div>
        <div className="rounded-lg border line-color bg-[var(--c-zone)] p-3 text-xs text-body">
          토큰은 현재 로그인 토큰과 같은 로컬 인증 영역에 저장됩니다. 토큰 값은 목록에
          표시되지 않지만, 공용 기기에서는 저장하지 마세요.
        </div>
        <div className="rounded-lg border line-color bg-[var(--c-surface-2)] p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              id="cfgMultiTokenAutoRotate"
              type="checkbox"
              checked={multiTokenAutoRotate}
              disabled={!profilesReady || profiles.length < 2 || boostLock.rotationBlocked}
              onChange={(e) => setMultiTokenAutoRotate(e.target.checked)}
            />
            <label
              htmlFor="cfgMultiTokenAutoRotate"
              className="text-sm font-medium text-default"
            >
              V5 할당량 기반 자동 순회
            </label>
          </div>
          {boostLock.rotationBlocked && (
            <p className="text-xs text-muted" data-boost-rotation-locked>
              {BOOST_TEXT.rotationLocked}
            </p>
          )}
          <p className="text-xs text-muted">
            정상 Opus 토큰이 2개 이상 저장된 경우에만 동작합니다. 무료 할당량 대상
            V5 생성에서 한 장이 끝난 뒤 다음 장을 시작하기 전에 전환합니다.
          </p>
          <p className="text-xs text-muted" data-opus-rotation-rule>
            {OPUS_USAGE_TEXT.rotationRule}
          </p>
          <div className={multiTokenAutoRotate ? 'space-y-3' : 'space-y-3 opacity-50'}>
            <div>
              <label className="block text-xs text-body mb-1">
                경고 임계값 — {multiTokenRotateWarning}% 이하에서 전환 시도
              </label>
              <input
                type="range"
                min={TOKEN_ROTATE_WARNING_MIN}
                max={TOKEN_ROTATE_WARNING_MAX}
                step={1}
                value={multiTokenRotateWarning}
                disabled={!multiTokenAutoRotate}
                onChange={(e) => changeRotateWarning(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-body mb-1">
                사용 토큰 여유값 — {multiTokenRotateTarget}% 이상인 토큰만 사용
              </label>
              <input
                type="range"
                min={rotateTargetMin}
                max={TOKEN_ROTATE_TARGET_MAX}
                step={1}
                value={multiTokenRotateTarget}
                disabled={!multiTokenAutoRotate}
                onChange={(e) =>
                  setMultiTokenRotateTarget(
                    normalizeTokenRotateTarget(
                      Number(e.target.value),
                      multiTokenRotateWarning,
                    ),
                  )
                }
                className="w-full"
              />
              <p className="text-xs text-faint mt-1">
                반복 전환을 막기 위해 경고 임계값보다 항상 5%p 이상 높게 유지됩니다.
              </p>
            </div>
            <div className="border-t line-color pt-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="cfgMultiTokenBalanceRotate"
                  type="checkbox"
                  checked={multiTokenBalanceRotate}
                  disabled={!multiTokenAutoRotate}
                  onChange={(e) => setMultiTokenBalanceRotate(e.target.checked)}
                />
                <label
                  htmlFor="cfgMultiTokenBalanceRotate"
                  className="text-xs font-medium text-default"
                >
                  여유 할당량 균형 순회
                </label>
              </div>
              <p className="text-xs text-muted">
                느리게 회복된 다른 계정의 무료 할당량이 현재 계정보다 5%p 이상 여유로울 때 전환합니다.
                후보 조회와 계정 전환은 최대 30분에 한 번만 수행합니다.
              </p>
              <div className={multiTokenBalanceRotate ? '' : 'opacity-50'}>
                <label className="block text-xs text-body mb-1">
                  균형 순회 여유 기준 — {multiTokenRotateBalance}% 이상
                </label>
                <input
                  type="range"
                  min={TOKEN_ROTATE_BALANCE_MIN}
                  max={TOKEN_ROTATE_BALANCE_MAX}
                  step={1}
                  value={multiTokenRotateBalance}
                  disabled={!multiTokenAutoRotate || !multiTokenBalanceRotate}
                  onChange={(e) =>
                    setMultiTokenRotateBalance(
                      normalizeTokenRotateBalance(Number(e.target.value)),
                    )
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>
          {multiTokenAutoRotate && multiAccountWarning}
          {profilesReady && profiles.length < 2 && (
            <p className="text-xs text-muted">
              자동 순회를 사용하려면 토큰을 2개 이상 저장해 주세요.
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="gray-input flex-1"
            type="password"
            autoComplete="off"
            placeholder="저장할 API 토큰을 붙여넣으세요"
            value={profileToken}
            onChange={(e) => setProfileToken(e.target.value)}
          />
          <button
            className="btn back-sky rounded px-3 py-2 text-sm"
            disabled={profileBusy || !profileToken.trim()}
            onClick={saveProfile}
          >
            입력 토큰 저장
          </button>
        </div>
        {!profilesReady ? (
          <p className="text-sm text-muted">토큰 프리셋을 불러오는 중…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-muted">저장된 토큰 프리셋이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {switchLocked && (
              <p className="text-xs text-muted" data-boost-switch-locked>
                {switchLocked}
              </p>
            )}
            {profiles.map((profile) => {
              const active = loginService.activeProfileId === profile.id;
              const usageCheck = profileUsageChecks[profile.id];
              const useCurrent = active && currentUsage.fetchedAt > (usageCheck?.checkedAt ?? 0);
              const status = useCurrent ? currentUsage.status : usageCheck?.usage;
              const checkedAt = useCurrent ? currentUsage.fetchedAt : usageCheck?.checkedAt ?? 0;
              const error = useCurrent
                ? currentUsage.state === 'error' ? '조회 실패' : undefined
                : usageCheck?.validity === 'invalid' ? '로그인 실패'
                  : usageCheck?.validity === 'error' ? '조회 실패' : undefined;
              return (
                <div
                  key={profile.id}
                  className="rounded-lg r-card border line-color bg-[var(--c-surface-2)] p-3 space-y-3"
                  style={active ? { borderColor: 'var(--c-sky-bg)' } : undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                  {editingProfileId === profile.id ? (
                    <input
                      autoFocus
                      className="gray-input min-w-0 flex-1 py-1 text-sm"
                      value={profileNameDraft}
                      maxLength={40}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      onBlur={() => void commitProfileRename(profile)}
                      // Esc = 이름 편집 취소(창 닫기 아님) — 닫기 관문 규칙
                      data-esc-cancel
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') cancelProfileRename();
                      }}
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-default cursor-text"
                      title="더블클릭하여 이름 변경"
                      onDoubleClick={() => startProfileRename(profile)}
                    >
                      {profile.name}
                    </span>
                  )}
                  {editingProfileId !== profile.id && (
                    <button
                      className="btn btn-ghost rounded p-1 text-muted flex-none"
                      title="토큰 이름 변경"
                      aria-label={`${profile.name} 이름 변경`}
                      disabled={profileBusy}
                      onClick={() => startProfileRename(profile)}
                      onDoubleClick={() => startProfileRename(profile)}
                    >
                      <FaPen size={11} />
                    </button>
                  )}
                  {active && (
                    <span className={`${roundTag} back-green flex-none`}>사용 중</span>
                  )}
                  <button
                    className="btn back-sky rounded px-3 py-1 text-xs flex-none"
                    disabled={profileBusy || active || !!switchLocked}
                    onClick={() => activateProfile(profile)}
                  >
                    전환
                  </button>
                  <button
                    className="btn back-red rounded px-3 py-1 text-xs flex-none"
                    disabled={profileBusy || !!switchLocked}
                    onClick={() => deleteProfile(profile)}
                  >
                    삭제
                  </button>
                  </div>
                  <OpusUsageMeter status={status} checkedAt={checkedAt}
                    warningPercent={multiTokenRotateWarning}
                    loading={checkingProfileUsages || (active && currentUsage.refreshing)}
                    stale={useCurrent && currentUsage.state === 'stale'} error={error} />
                </div>
              );
            })}
          </div>
        )}
        <OpusUsageHelp />
      </div>

      <hr className="line-color" />
      {/* 부스트 모드(B3, PC·모바일 공통) — 값은 다른 다중 토큰 설정처럼 「저장」 때 config 에 쓴다(경고 창의
          「다시 보지 않음」만 즉시 저장). 판정·문구 단일 출처 models/boostMode.ts. */}
      <div className="space-y-3" data-boost-settings>
        <div>
          <p className="text-sm font-semibold gray-label">{BOOST_TEXT.settingsTitle}</p>
          <p className="text-xs text-muted mt-1">{BOOST_TEXT.settingsDescription}</p>
        </div>
        <div className="rounded-lg border line-color bg-[var(--c-surface-2)] p-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              id="cfgBoostMode"
              type="checkbox"
              checked={boostOn}
              disabled={boostBusy || (!boostOn && !!boostLock.boostBlocked)}
              onChange={(e) => void toggleBoost(e.target.checked)}
            />
            <label htmlFor="cfgBoostMode" className="text-sm font-medium text-default">
              {BOOST_TEXT.settingsToggle}
            </label>
          </div>
          {boostLock.boostBlocked === 'rotation' && (
            <p className="text-xs text-muted" data-boost-locked="rotation">
              {BOOST_TEXT.boostLockedByRotation}
            </p>
          )}
          {profilesReady && profiles.length < 2 && (
            <p className="text-xs text-muted" data-boost-locked="profiles">
              {BOOST_TEXT.profilesRequired}
            </p>
          )}
          {(() => {
            // 켤 수 없는 상태(토큰 부족·순회 켜짐)면 방식·범위도 고를 수 없다. 꺼져 있어도 고를 수는 있다(켜면 그 값으로).
            const areaDisabled = !boostOn && !!boostLock.boostBlocked;
            return (
              <div
                className={'space-y-3 ' + (boostOn ? '' : 'opacity-60')}
                aria-disabled={areaDisabled || undefined}
              >
                <fieldset className="space-y-1.5" disabled={areaDisabled}>
                  <legend className="text-xs font-medium text-body mb-1">
                    {BOOST_TEXT.modeHeading}
                  </legend>
                  {(['replicate', 'split'] as BoostActiveMode[]).map((mode) => (
                    <label key={mode} className="flex items-start gap-2 text-xs text-default cursor-pointer">
                      <input
                        type="radio"
                        name="cfgBoostActiveMode"
                        className="mt-0.5 flex-none"
                        checked={boostModeChoice === mode}
                        onChange={() => chooseBoostMode(mode)}
                      />
                      <span className="min-w-0">
                        <span className="block">{BOOST_TEXT.modeLabel[mode]}</span>
                        <span className="block text-muted">{BOOST_TEXT.modeHint[mode]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="space-y-1.5 border-t line-color pt-3" disabled={areaDisabled}>
                  <legend className="text-xs font-medium text-body mb-1">
                    {BOOST_TEXT.scopeHeading}
                  </legend>
                  {BOOST_ACCOUNT_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-start gap-2 text-xs text-default cursor-pointer">
                      <input
                        type="radio"
                        name="cfgBoostScope"
                        className="mt-0.5 flex-none"
                        checked={boost.scope === scope}
                        onChange={() =>
                          setBoostSettings((cur: BoostSettings) => ({ ...cur, scope }))
                        }
                      />
                      <span className="min-w-0">
                        <span className="block">{BOOST_SCOPE_LABEL[scope]}</span>
                        <span className="block text-muted">{BOOST_TEXT.scopeHint[scope]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="border-t line-color pt-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      id="cfgBoostVariantTasks"
                      type="checkbox"
                      checked={boost.variantTasks}
                      disabled={areaDisabled}
                      onChange={(e) =>
                        setBoostSettings((cur: BoostSettings) => ({
                          ...cur,
                          variantTasks: e.target.checked,
                        }))
                      }
                    />
                    <label htmlFor="cfgBoostVariantTasks" className="text-xs font-medium text-default">
                      {BOOST_TEXT.variantToggle}
                    </label>
                  </div>
                  <p className="text-xs text-muted">{BOOST_TEXT.variantHint}</p>
                </div>
                <p className="text-xs text-body border-t line-color pt-3" data-boost-preview>
                  {boostPreview === 'error'
                    ? '참여 후보를 불러오지 못했습니다.'
                    : boostPreview
                      ? boostParticipantPreviewText(boostPreview)
                      : '참여 후보를 불러오는 중…'}
                </p>
              </div>
            );
          })()}
          {boostOn && multiAccountWarning}
        </div>
      </div>
    </div>
  );
};

const ConfigScreen = observer(({ onSave, onClose }: ConfigScreenProps) => {
  const { curSession } = appState;
  const [activeTab, setActiveTab] = useState(0);

  // 모바일 탭 바 가로 스크롤 힌트 — 각 방향에 가려진 탭이 있을 때만 양 끝에
  // 옅은 화살표를 띄운다(스크롤 가능함을 알리는 표시 전용, 클릭 무반응).
  // 구현은 공용 HScrollHint(씬 툴바와 공유).
  const {
    ref: tabBarRef,
    hint: tabScrollHint,
    onScroll: updateTabScrollHint,
  } = useHScrollHint<HTMLDivElement>();

  // state
  const [imageEditor, setImageEditor] = useState('');
  const [useGPU, setUseGPU] = useState(false);
  const [whiteMode, setWhiteMode] = useState(false);
  const [requestDelayMs, setRequestDelayMs] = useState(REQUEST_DELAY_DEFAULT_MS);
  const [requestDelayJitterMs, setRequestDelayJitterMs] = useState(REQUEST_DELAY_JITTER_DEFAULT_MS);
  const [classicSceneCard, setClassicSceneCard] = useState(false);
  const [legacyProjectMode, setLegacyProjectMode] = useState(false);
  const [legacySceneEditor, setLegacySceneEditor] = useState(false);
  const [legacyWorkflowMode, setLegacyWorkflowMode] = useState(false);
  const [sceneToolbarLegacyText, setSceneToolbarLegacyText] = useState(false);
  const [storageWriteGuard, setStorageWriteGuard] = useState(true);
  const [fullWordAc, setFullWordAc] = useState(appState.fullWordAutoComplete);
  const [trueDark, setTrueDark] = useState(false);
  const [exportConcurrency, setExportConcurrency] = useState(isMobile ? 2 : 4);
  const [useLocalBgRemoval, setUseLocalBgRemoval] = useState(false);
  const [refreshImage, setRefreshImage] = useState(false);
  const [autoConvertWebp, setAutoConvertWebp] = useState(false);
  const [autoWebpQuality, setAutoWebpQuality] = useState(80);
  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState('');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState(0);
  const [accessToken, setAccessToken] = useState('');
  const [saveLocation, setSaveLocation] = useState('');
  const [dataRoot, setDataRoot] = useState('');
  const [defaultExportFolder, setDefaultExportFolder] = useState('');
  const [syncFolder, setSyncFolder] = useState('');
  const [uiTheme, setUiTheme] = useState<UiThemeConfig>({});
  const [uiThemePresets, setUiThemePresets] = useState<
    NonNullable<Config['uiThemePresets']>
  >([]);
  const [uiToolbar, setUiToolbar] = useState<UiToolbarConfig>({});
  const [quickMenuCfg, setQuickMenuCfg] = useState<string[] | undefined>(undefined);
  const [quickMenuButton, setQuickMenuButton] = useState(false);
  const [uiLayoutTemplate, setUiLayoutTemplate] = useState(defaultLayoutTemplateId(isMobile));
  const [uiMobileV2Parts, setUiMobileV2Parts] = useState<MobileV2Parts>(normalizeV2Parts(undefined));
  const [uiPresetIconRow, setUiPresetIconRow] = useState(false);
  // 모던 해제 확인(② A 2차 피드백 후속 1): 모던 → 다른 템플릿 전환 시 "배치 초기화"에
  // 동의했는지. true 면 저장 시 버튼(툴바·동반)·레이아웃 배치를 기본값으로 되돌린다.
  const [modernExitReset, setModernExitReset] = useState(false);
  const [uiFloatViewMode, setUiFloatViewMode] = useState<'cover' | 'center'>('cover');
  const [uiFont, setUiFont] = useState<'pretendard' | 'system'>('system');
  const [uiClassicFinish, setUiClassicFinish] = useState(false);
  const [uiPillButtons, setUiPillButtons] = useState(false);
  const [allowDuplicateProjectOpen, setAllowDuplicateProjectOpen] = useState(false);
  const [multiTokenAutoRotate, setMultiTokenAutoRotate] = useState(false);
  const [multiTokenRotateWarning, setMultiTokenRotateWarning] = useState(10);
  const [multiTokenRotateTarget, setMultiTokenRotateTarget] = useState(25);
  const [multiTokenBalanceRotate, setMultiTokenBalanceRotate] = useState(false);
  const [multiTokenRotateBalance, setMultiTokenRotateBalance] = useState(80);
  // 부스트 모드(B3) — config 키 boostMode·boostAccountScope·boostVariantTasks(저장 때). 방식 선택은 꺼져 있을 때도 기억.
  const [boostSettings, setBoostSettings] = useState<BoostSettings>(resolveBoostSettings(undefined));
  const [boostModeChoice, setBoostModeChoice] = useState<BoostActiveMode>(boostActiveModeOf('off'));
  // 미저장 변경 감지 기준 — 로드/저장 시점의 config 스냅샷 (#17)
  const [savedCfg, setSavedCfg] = useState<Config | null>(null);
  const mobileMode = isMobile;

  // 설정 파일 → 화면 로컬 상태. 마운트 때 한 번 + 환경설정 불러오기 적용 뒤 다시(드라이브
  // 동기화 ③ — 이 화면은 저장 때 로컬 상태 전체를 쓰므로, 불러온 값을 로컬에 다시 읽어 두지
  // 않으면 이어서 「저장」할 때 불러오기 전 값으로 되돌아간다).
  const loadConfig = async () => {
    const config = await backend.getConfig();
    const actualDataRoot = await backend
      .getDataRoot()
      .catch(() => config.saveLocation ?? '');
    setWhiteMode(config.whiteMode ?? false);
    setImageEditor(config.imageEditor ?? 'photoshop');
    setUseGPU(config.useCUDA ?? false);
    setQuality(config.removeBgQuality ?? 'normal');
    setRefreshImage(config.refreshImage ?? false);
    setAutoConvertWebp(config.autoConvertWebp ?? false);
    setAutoWebpQuality(config.autoConvertWebpQuality ?? 80);
    setUseLocalBgRemoval(config.useLocalBgRemoval ?? false);
    // 새 키가 없으면 옛 delayTime 을 ×7.5·×1.5 로 환산(5.4.0 이하), 그것도 없으면 기본값(T3b —
    // 실행 루프와 같은 resolveRequestDelaySettings).
    {
      const delay = resolveRequestDelaySettings(config);
      setRequestDelayMs(delay.baseMs);
      setRequestDelayJitterMs(delay.jitterMs);
    }
    setClassicSceneCard(config.classicSceneCard ?? false);
    setLegacyProjectMode(config.legacyProjectMode ?? false);
    setLegacySceneEditor(config.legacySceneEditor ?? false);
    setLegacyWorkflowMode(config.legacyWorkflowMode ?? false);
    setSceneToolbarLegacyText(config.sceneToolbarLegacyText ?? false);
    setStorageWriteGuard(config.storageWriteGuard ?? true);
    setTrueDark(config.trueDark ?? false);
    setExportConcurrency(config.exportConcurrency ?? (isMobile ? 2 : 4));
    setSaveLocation(config.saveLocation ?? '');
    setDataRoot(actualDataRoot);
    setDefaultExportFolder(config.defaultExportFolder ?? '');
    setSyncFolder(config.syncFolder ?? '');
    setUiTheme(config.uiTheme ?? {});
    setUiThemePresets(config.uiThemePresets ?? []);
    setUiToolbar(config.uiToolbar ?? {});
    setQuickMenuCfg(config.quickMenu);
    setQuickMenuButton(config.quickMenuButton ?? false);
    setUiLayoutTemplate(config.uiLayoutTemplate ?? defaultLayoutTemplateId(isMobile));
    setUiMobileV2Parts(normalizeV2Parts(config.uiMobileV2Parts));
    setUiPresetIconRow(config.uiPresetIconRow ?? false);
    setUiFloatViewMode(config.uiFloatViewMode ?? 'cover');
    setUiFont(config.uiFont ?? 'system');
    setUiClassicFinish(config.uiClassicFinish ?? false);
    setUiPillButtons(config.uiPillButtons ?? false);
    setAllowDuplicateProjectOpen(config.allowDuplicateProjectOpen ?? false);
    const rotateWarning = normalizeTokenRotateWarning(
      config.multiTokenRotateWarningPercent,
    );
    setMultiTokenAutoRotate(config.multiTokenAutoRotate ?? false);
    setMultiTokenRotateWarning(rotateWarning);
    setMultiTokenRotateTarget(
      normalizeTokenRotateTarget(
        config.multiTokenRotateTargetPercent,
        rotateWarning,
      ),
    );
    setMultiTokenBalanceRotate(config.multiTokenBalanceRotate ?? false);
    setMultiTokenRotateBalance(
      normalizeTokenRotateBalance(config.multiTokenRotateBalancePercent),
    );
    {
      const boostLoaded = resolveBoostSettings(config);
      setBoostSettings(boostLoaded);
      setBoostModeChoice(boostActiveModeOf(boostLoaded.mode));
    }
    setModernExitReset(false);
    setSavedCfg(config);
  };

  useEffect(() => {
    loadConfig();
    const checkReady = () => setReady(localAIService.ready);
    const onProgress = (e: any) => setProgress(e.detail.percent);
    const onStage = (e: any) => setStage(e.detail.stage);
    checkReady();
    localAIService.addEventListener('updated', checkReady);
    localAIService.addEventListener('progress', onProgress);
    localAIService.addEventListener('stage', onStage);
    return () => {
      localAIService.removeEventListener('updated', checkReady);
      localAIService.removeEventListener('progress', onProgress);
      localAIService.removeEventListener('stage', onStage);
    };
  }, []);

  // Esc·Android 뒤로 가기로 닫기 — 닫기 관문(BackStackService) 한 항목. 이 화면은 열려 있을 때만 마운트된다.
  // 예전엔 window 캡처 Esc 리스너라 위에 뜬 확인 창·작업 로그와 함께 닫혔고, 뒤로 가기는 앱을 최소화했다
  // (SPEC §5 위반). 미저장 배지는 닫기를 막지 않는다(의도 유지). 2026-10-03 U1·X2·X6.
  useBackLayer(true, onClose);
  const configBackdrop = useBackdropClose(onClose);

  // 단축키 시스템에 ConfigScreen 열림 상태 전달
  useEffect(() => {
    appState.configScreenOpen = true;
    return () => { appState.configScreenOpen = false; };
  }, []);

  const roundTag = 'text-white text-xs px-2 py-1 rounded-full';

  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const onChange = () => setLoggedIn(loginService.loggedIn);
    onChange();
    loginService.addEventListener('change', onChange);
    return () => loginService.removeEventListener('change', onChange);
  }, []);

  const loginWithToken = async () => {
    try {
      if (!accessToken.trim()) {
        appState.pushMessage('API 토큰을 입력해주세요.');
        return;
      }
      await loginService.loginWithToken(accessToken.trim());
      appState.pushMessage('토큰으로 로그인 성공!');
      setAccessToken('');
    } catch (err: any) {
      appState.pushMessage('토큰 로그인 실패:' + err.message);
    }
  };

  const clearImageCache = async () => {
    if (!curSession) return;
    appState.pushMessage('이미지 캐시 초기화 시작');
    for (const scene of Object.values(curSession.scenes)) {
      try {
        await backend.deleteDir(imageService.getImageDir(curSession, scene) + '/fastcache');
      } catch (e) {}
    }
    imageService.cache.cache.clear();
    await imageService.refreshBatch(curSession);
    appState.pushDialog({ type: 'yes-only', text: '이미지 캐시 초기화 완료' });
  };

  // 저장 경로 변경(2026-11-04 안전장치): 쓰기 검사(하위 데이터 폴더 포함) → 데이터 미이동·재시작 안내 선택 창
  // → 저장 → 재시작 또는 보류 표시. 흐름 단일 출처 models/saveLocationChangeFlow.ts. 표시하는 데이터 루트는
  // 실제 루트(getDataRoot) 그대로 두고, 새 경로는 saveLocation(「다음 부팅부터」)으로만 보인다.
  const selectFolder = async () => {
    const result = await runSaveLocationChange({ backend, appState });
    if (result.kind === 'same' || result.kind === 'pending' || result.kind === 'restarting') {
      setSaveLocation(result.folder);
    }
  };

  const selectDefaultExportFolder = async () => {
    const folder = await backend.selectDir();
    if (!folder) return;
    setDefaultExportFolder(folder);
  };

  // 드라이브 동기화 폴더(PC 전용) — 내보내기 끝에서 고를 목적지. 저장 경로 지정과
  // 같이 실제 쓰기 가능 여부를 먼저 확인한다.
  const selectSyncFolder = async () => {
    const folder = await backend.selectDir();
    if (!folder) return;
    const check = await backend.checkWritable(folder);
    if (!check.ok && check.code === INSIDE_INSTALL_DIR_CODE) {
      appState.pushDialog({ type: 'yes-only', text: INSTALL_DIR_TEXT.syncFolderRejected });
      return;
    }
    if (!check.ok) {
      appState.pushDialog({
        type: 'yes-only',
        text: DRIVE_SYNC_TEXT.settingNotWritable(check.code),
      });
      return;
    }
    setSyncFolder(folder);
  };

  const stageTexts = ['모델 다운로드 중...', '모델 가중치 다운로드 중...', '모델 압축 푸는 중...'];

  const handleSave = async () => {
    const old = await backend.getConfig();
    // 짧은 지연 경고(T3): 권장 최소값(REQUEST_DELAY_WARNING_BELOW_MS) 미만으로 바꿔 저장하면 저장 전에 묻는다. 선택형 확인 창 —
    // [이해했습니다]=저장, [다시 알리지 않음]=저장+표식, 취소·Esc·뒤로 가기=저장하지 않음.
    let warningDismissed = old.requestDelayWarningDismissed === true;
    if (shouldWarnShortRequestDelay(requestDelayMs, old.requestDelayMs, warningDismissed)) {
      const choice = await appState.pushDialogAsync({
        type: 'select',
        text: REQUEST_DELAY_TEXT.warningText,
        items: [
          { text: REQUEST_DELAY_TEXT.warningOk, value: 'ok' },
          { text: REQUEST_DELAY_TEXT.warningDismiss, value: 'dismiss' },
        ],
      });
      if (choice !== 'ok' && choice !== 'dismiss') return;
      if (choice === 'dismiss') warningDismissed = true;
    }
    const config: Config = {
      ...old,
      imageEditor: imageEditor as ImageEditor,
      useCUDA: useGPU,
      modelType: 'quality',
      removeBgQuality: quality as RemoveBgQuality,
      refreshImage: refreshImage,
      autoConvertWebp: autoConvertWebp,
      autoConvertWebpQuality: autoWebpQuality,
      whiteMode: whiteMode,
      useLocalBgRemoval: useLocalBgRemoval,
      // 요청 지연 새 키 2개 + 옛 키 delayTime 병기(지연 ÷ 7.5 역환산, 0~1000 — 롤백 호환)
      ...withRequestDelaySettings({}, requestDelayMs, requestDelayJitterMs),
      requestDelayWarningDismissed: warningDismissed || undefined,
      classicSceneCard: classicSceneCard,
      legacyProjectMode: legacyProjectMode,
      legacySceneEditor: legacySceneEditor,
      legacyWorkflowMode: legacyWorkflowMode,
      sceneToolbarLegacyText: sceneToolbarLegacyText,
      storageWriteGuard: storageWriteGuard,
      exportConcurrency: exportConcurrency,
      defaultExportFolder: defaultExportFolder || undefined,
      syncFolder: syncFolder || undefined,
      trueDark: trueDark,
      uiTheme: uiTheme,
      uiThemePresets: uiThemePresets.length > 0 ? uiThemePresets : undefined,
      uiToolbar: uiToolbar,
      quickMenu: quickMenuCfg,
      quickMenuButton: quickMenuButton,
      uiLayoutTemplate: uiLayoutTemplate,
      uiMobileV2Parts: uiMobileV2Parts,
      uiPresetIconRow: uiPresetIconRow,
      uiFloatViewMode: uiFloatViewMode,
      uiFont: uiFont,
      uiClassicFinish: uiClassicFinish,
      uiPillButtons: uiPillButtons,
      allowDuplicateProjectOpen: allowDuplicateProjectOpen,
      multiTokenAutoRotate: multiTokenAutoRotate,
      multiTokenRotateWarningPercent: multiTokenRotateWarning,
      multiTokenRotateTargetPercent: multiTokenRotateTarget,
      multiTokenBalanceRotate: multiTokenBalanceRotate,
      multiTokenRotateBalancePercent: multiTokenRotateBalance,
      // 부스트 모드 3키(boostWarningDismissed 는 경고 창이 따로 즉시 저장 — old 에서 그대로 이어진다)
      ...boostSettingsToConfig(boostSettings),
    };
    // 모던 사이드바 "최초 전환" 시(② A 결정 2): 버튼 배치(툴바·동반 슬롯)를 초기화하고
    // 모던 기본 배치+하단 아이콘 행을 강제 적용한다. 이후 재커스텀 자유, 해제(다른
    // 템플릿 복귀) 시엔 배치를 손대지 않는다(초기화 유지 — 이전 커스텀 복원 없음).
    const modernApplied =
      uiLayoutTemplate === 'modern' && old.uiLayoutTemplate !== 'modern';
    // 모바일 V2 "최초 전환" 시: 하단 시트 프롬프트의 공간 확보를 위해 하단 아이콘 행을 켜 준다.
    // 모던과 같은 규칙 — 전환하는 순간에만 켜고, 그 뒤에는 V2 를 쓰는 중에도 사용자가 자유롭게 끌 수 있다.
    // 툴바·동반 슬롯은 건드리지 않는다(모바일은 슬롯을 쓰지 않음). 해제 시에도 되돌리지 않는다(사용자 값 존중).
    const mobileV2Applied =
      uiLayoutTemplate === 'mobile-v2' && old.uiLayoutTemplate !== 'mobile-v2';
    if (mobileV2Applied) {
      config.uiPresetIconRow = true;
    }
    if (modernApplied) {
      config.uiToolbar = {};
      config.uiCompanionSlots = JSON.parse(
        JSON.stringify(MODERN_COMPANION_DEFAULTS),
      );
      config.uiPresetIconRow = true;
    }
    // 모던 해제 + 초기화 동의(② A 2차 피드백 후속 1): 버튼(툴바 개별 배치·동반 슬롯)·
    // 레이아웃(패널 좌/우·생성 위젯)·하단 아이콘 행을 기본값으로. 클래식 툴바 토글은
    // 배치가 아닌 모드라 유지한다.
    const modernExited =
      modernExitReset &&
      uiLayoutTemplate !== 'modern' &&
      old.uiLayoutTemplate === 'modern';
    if (modernExited) {
      config.uiToolbar = { classic: uiToolbar.classic };
      config.uiCompanionSlots = {};
      config.uiLayoutSlots = {};
      config.genWidget = {};
      config.uiPresetIconRow = false;
    }
    await backend.setConfig(config);
    setSavedCfg(config);
    if (old.useCUDA !== useGPU) localAIService.modelChanged();
    appState.classicSceneCard = classicSceneCard;
    appState.legacyProjectMode = legacyProjectMode;
    appState.legacySceneEditor = legacySceneEditor;
    appState.legacyWorkflowMode = legacyWorkflowMode;
    appState.sceneToolbarLegacyText = sceneToolbarLegacyText;
    appState.uiToolbar = uiToolbar;
    appState.quickMenu = quickMenuCfg;
    appState.quickMenuButton = quickMenuButton;
    appState.uiLayoutTemplate = uiLayoutTemplate;
    appState.uiMobileV2Parts = uiMobileV2Parts;
    appState.uiPresetIconRow = uiPresetIconRow;
    appState.uiFloatViewMode = uiFloatViewMode;
    appState.uiFont = uiFont;
    appState.uiClassicFinish = uiClassicFinish;
    appState.uiPillButtons = uiPillButtons;
    appState.allowDuplicateProjectOpen = allowDuplicateProjectOpen;
    appState.storageWriteGuard = storageWriteGuard;
    appState.fullWordAutoComplete = fullWordAc;
    // 모던 전환 강제 배치의 미러·로컬 상태 반영(위의 일괄 미러가 옛 상태 값을 덮으므로
    // 마지막에 덮어써야 한다 — dirty 재계산도 이 로컬 상태와 savedCfg 로 일치).
    if (modernApplied) {
      appState.uiToolbar = {};
      appState.uiCompanionSlots = JSON.parse(
        JSON.stringify(MODERN_COMPANION_DEFAULTS),
      );
      appState.uiPresetIconRow = true;
      setUiToolbar({});
      setUiPresetIconRow(true);
    }
    if (mobileV2Applied) {
      appState.uiPresetIconRow = true;
      setUiPresetIconRow(true);
    }
    if (modernExited) {
      appState.uiToolbar = { classic: uiToolbar.classic };
      appState.uiCompanionSlots = {};
      appState.uiLayoutSlots = {};
      appState.genWidget = {};
      appState.uiPresetIconRow = false;
      setUiToolbar({ classic: uiToolbar.classic });
      setUiPresetIconRow(false);
    }
    // 모던 해제 동의 플래그는 1회성 — 저장이 소비한다(재전환 시 새로 묻는다).
    setModernExitReset(false);
    localStorage.setItem('sdstudio-full-word-autocomplete', fullWordAc ? 'true' : 'false');
    sessionService.configChanged();
    onSave();
  };

  // key 기반 탭 정의(표시 순서 = 배열 순서). 숫자 오프셋 매핑 대신 key 로 콘텐츠를
  // 고르므로, 플랫폼별로 탭을 끼우거나 빼도 매핑이 어긋나지 않는다.
  const tabs = [
    { key: 'login', label: '로그인', icon: <FaUser size={14} /> },
    { key: 'customization', label: '테마', icon: <FaPalette size={14} /> },
    // 툴바 탭은 모바일 전용(② A 2차 피드백 후속 2): PC 는 편집 모드 드래그가 버튼
    // 배치(고정/⋯메뉴/숨김·동반 배정)를 전부 대체해 select UI 를 없애고, 남는 전역
    // 조작(클래식 토글·버튼 배치 초기화·퀵 메뉴 구성)은 레이아웃 탭으로 이관.
    // 모바일은 편집 모드가 없어 기존 select UI 가 유일한 수단이라 탭을 유지한다.
    ...(mobileMode ? [{ key: 'toolbar', label: '툴바', icon: <FaThLarge size={14} /> }] : []),
    { key: 'layout', label: '레이아웃', icon: <FaColumns size={14} /> },
    ...(!mobileMode ? [{ key: 'storage', label: '저장경로', icon: <FaFolder size={14} /> }] : []),
    // 드라이브(드라이브 API ⑤, PC·모바일 공통): Google 드라이브 연동·백업 목록·환경설정 내보내기/불러오기·
    // (PC) 고급 로컬 동기화 폴더. 라벨 축약(저장경로·커스텀·단축키)과 탭 버튼 여백(px-2.5·gap-1)은 PC 설정
    // 창 폭(md:max-w-2xl)에 8탭이 한 줄로 들어가게 하려는 것(2026-10-01 사용자 결정).
    { key: 'drive', label: '드라이브', icon: <FaGoogleDrive size={14} /> },
    { key: 'system', label: '시스템', icon: <ActionIcon id="system-settings" size={14} /> },
    { key: 'personal', label: '커스텀', icon: <FaSlidersH size={14} /> },
    // 복구는 모바일 전용 탭(데스크탑은 '저장경로' 탭 안에 동일 기능 존재)
    ...(mobileMode ? [{ key: 'recovery', label: '복구', icon: <FaWrench size={14} /> }] : []),
    ...(!mobileMode ? [{ key: 'keybindings', label: '단축키', icon: <FaKeyboard size={14} /> }] : []),
  ];

  const getTabContent = (tabIdx: number) => {
    const key = tabs[tabIdx]?.key;
    switch (key) {
      case 'login':
        return <LoginTab {...{ accessToken, setAccessToken, loggedIn, loginWithToken, roundTag, multiTokenAutoRotate, setMultiTokenAutoRotate, multiTokenRotateWarning, setMultiTokenRotateWarning, multiTokenRotateTarget, setMultiTokenRotateTarget, multiTokenBalanceRotate, setMultiTokenBalanceRotate, multiTokenRotateBalance, setMultiTokenRotateBalance, boostSettings, setBoostSettings, boostModeChoice, setBoostModeChoice }} />;
      case 'storage':
        return <StorageImageTab {...{ saveLocation, dataRoot, selectFolder, clearImageCache, refreshImage, setRefreshImage, defaultExportFolder, setDefaultExportFolder, selectDefaultExportFolder, autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality, imageEditor, setImageEditor, useLocalBgRemoval, setUseLocalBgRemoval, ready, stage, progress, stageTexts, useGPU, setUseGPU, quality, setQuality }} />;
      case 'system':
        return <SystemTab {...{ requestDelayMs, setRequestDelayMs, requestDelayJitterMs, setRequestDelayJitterMs, storageWriteGuard, setStorageWriteGuard, exportConcurrency, setExportConcurrency, autoConvertWebp, setAutoConvertWebp, autoWebpQuality, setAutoWebpQuality }} />;
      case 'drive':
        return <DriveSettingsTab active={activeTab === tabIdx} dirty={!!dirty} reloadConfig={loadConfig} syncFolder={syncFolder} setSyncFolder={setSyncFolder} selectSyncFolder={selectSyncFolder} />;
      case 'personal':
        return <PersonalTab {...{ classicSceneCard, setClassicSceneCard, fullWordAc, setFullWordAc, legacyProjectMode, setLegacyProjectMode, legacySceneEditor, setLegacySceneEditor, legacyWorkflowMode, setLegacyWorkflowMode, sceneToolbarLegacyText, setSceneToolbarLegacyText, uiFont, setUiFont, uiClassicFinish, setUiClassicFinish, uiPillButtons, setUiPillButtons, allowDuplicateProjectOpen, setAllowDuplicateProjectOpen }} />;
      case 'customization':
        return <CustomizationTab {...{ uiTheme, setUiTheme, whiteMode, setWhiteMode, trueDark, setTrueDark, uiThemePresets, setUiThemePresets }} />;
      case 'toolbar':
        return <ToolbarTab {...{ uiToolbar, setUiToolbar, quickMenu: quickMenuCfg, setQuickMenu: setQuickMenuCfg, quickMenuButton, setQuickMenuButton }} />;
      case 'layout':
        return <LayoutTab {...{ uiLayoutTemplate, setUiLayoutTemplate, uiMobileV2Parts, setUiMobileV2Parts, setModernExitReset, uiPresetIconRow, setUiPresetIconRow, uiToolbar, setUiToolbar, quickMenu: quickMenuCfg, setQuickMenu: setQuickMenuCfg, quickMenuButton, setQuickMenuButton, uiFloatViewMode, setUiFloatViewMode, mobileMode, onClose }} />;
      case 'recovery':
        return <RecoveryTab />;
      case 'keybindings':
        return <KeyBindingsTab />;
      default:
        return null;
    }
  };

  // 미저장 변경 여부 (#17) — handleSave 가 저장하는 필드만 비교(로드 시와 같은 기본값 적용).
  // saveLocation 은 선택 즉시 저장되므로 제외. 객체(uiTheme/uiToolbar)는 JSON 직렬화 비교.
  const dirty =
    savedCfg != null &&
    (imageEditor !== (savedCfg.imageEditor ?? 'photoshop') ||
      useGPU !== (savedCfg.useCUDA ?? false) ||
      quality !== (savedCfg.removeBgQuality ?? 'normal') ||
      refreshImage !== (savedCfg.refreshImage ?? false) ||
      autoConvertWebp !== (savedCfg.autoConvertWebp ?? false) ||
      autoWebpQuality !== (savedCfg.autoConvertWebpQuality ?? 80) ||
      whiteMode !== (savedCfg.whiteMode ?? false) ||
      useLocalBgRemoval !== (savedCfg.useLocalBgRemoval ?? false) ||
      // 지연은 불러오기와 같은 해석(옛 delayTime 환산 포함) — 환산만으로 미저장 표시가 뜨지 않게.
      requestDelayMs !== resolveRequestDelaySettings(savedCfg).baseMs ||
      requestDelayJitterMs !== resolveRequestDelaySettings(savedCfg).jitterMs ||
      classicSceneCard !== (savedCfg.classicSceneCard ?? false) ||
      legacyProjectMode !== (savedCfg.legacyProjectMode ?? false) ||
      legacySceneEditor !== (savedCfg.legacySceneEditor ?? false) ||
      legacyWorkflowMode !== (savedCfg.legacyWorkflowMode ?? false) ||
      sceneToolbarLegacyText !== (savedCfg.sceneToolbarLegacyText ?? false) ||
      storageWriteGuard !== (savedCfg.storageWriteGuard ?? true) ||
      exportConcurrency !== (savedCfg.exportConcurrency ?? (isMobile ? 2 : 4)) ||
      (defaultExportFolder || '') !== (savedCfg.defaultExportFolder ?? '') ||
      (syncFolder || '') !== (savedCfg.syncFolder ?? '') ||
      trueDark !== (savedCfg.trueDark ?? false) ||
      // fullWordAc 는 config 파일이 아니라 appState+localStorage 저장 — 저장 시 appState 가 갱신되므로 그것과 비교
      fullWordAc !== appState.fullWordAutoComplete ||
      JSON.stringify(uiTheme) !== JSON.stringify(savedCfg.uiTheme ?? {}) ||
      JSON.stringify(uiThemePresets) !== JSON.stringify(savedCfg.uiThemePresets ?? []) ||
      JSON.stringify(uiToolbar) !== JSON.stringify(savedCfg.uiToolbar ?? {}) ||
      JSON.stringify(quickMenuCfg ?? null) !== JSON.stringify(savedCfg.quickMenu ?? null) ||
      quickMenuButton !== (savedCfg.quickMenuButton ?? false) ||
      uiLayoutTemplate !== (savedCfg.uiLayoutTemplate ?? defaultLayoutTemplateId(isMobile)) ||
      JSON.stringify(uiMobileV2Parts) !== JSON.stringify(normalizeV2Parts(savedCfg.uiMobileV2Parts)) ||
      uiPresetIconRow !== (savedCfg.uiPresetIconRow ?? false) ||
      uiFloatViewMode !== (savedCfg.uiFloatViewMode ?? 'cover') ||
      uiFont !== (savedCfg.uiFont ?? 'system') ||
      uiClassicFinish !== (savedCfg.uiClassicFinish ?? false) ||
      uiPillButtons !== (savedCfg.uiPillButtons ?? false) ||
      allowDuplicateProjectOpen !== (savedCfg.allowDuplicateProjectOpen ?? false) ||
      multiTokenAutoRotate !== (savedCfg.multiTokenAutoRotate ?? false) ||
      multiTokenRotateWarning !== normalizeTokenRotateWarning(
        savedCfg.multiTokenRotateWarningPercent,
      ) ||
      multiTokenRotateTarget !== normalizeTokenRotateTarget(
        savedCfg.multiTokenRotateTargetPercent,
        savedCfg.multiTokenRotateWarningPercent,
      ) ||
      multiTokenBalanceRotate !== (savedCfg.multiTokenBalanceRotate ?? false) ||
      multiTokenRotateBalance !== normalizeTokenRotateBalance(
        savedCfg.multiTokenRotateBalancePercent,
      ) ||
      !sameBoostSettings(boostSettings, resolveBoostSettings(savedCfg)));

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      {...configBackdrop}
    >
      <div
        className={'relative w-[90vw] max-w-xl md:max-w-2xl bg-[var(--c-zone)] rounded-xl shadow-2xl flex flex-col overflow-hidden border line-color ' + (mobileMode ? 'max-h-[90vh]' : 'max-h-[85vh]')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 미저장 변경 표시 (#17) — 헤더 중앙 빈 공간 위 절대배치 오버레이.
            흐름에 끼우면 열릴 때마다 내용이 밀리므로 absolute + pointer-events-none 로
            레이아웃·클릭에 영향 0. 닫기를 막지 않는 안내 전용. */}
        {dirty && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shadow-sm bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/80 dark:text-amber-200 dark:border-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
            저장 안 된 변경
          </div>
        )}
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 md:px-5 py-3 border-b line-color flex-none">
          <h1 className="text-base font-semibold text-default">환경설정</h1>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-muted transition-colors"
            aria-label="닫기"
            onClick={onClose}
          >
            <FaTimes size={16} />
          </button>
        </div>
        {/* 탭 바 — 탭이 많아도 줄바꿈 대신 가로 스크롤.
            모바일=스크롤바 숨김(스와이프) + 양 끝 옅은 화살표로 "가려진 탭 있음" 힌트
            / PC=얇은 스크롤바 표기 + Shift 없이 휠로 이동 */}
        <div className="relative flex-none">
          <div
            ref={tabBarRef}
            className={
              'flex flex-nowrap overflow-x-auto border-b line-color px-2 ' +
              (mobileMode ? 'no-scrollbars' : 'thin-hscroll')
            }
            onScroll={updateTabScrollHint}
            onWheel={(e) => {
              if (!mobileMode && e.deltaY) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
          >
            {tabs.map((tab, i) => (
              <button
                key={tab.label}
                className={
                  'flex flex-none items-center gap-1 px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ' +
                  (activeTab === i
                    ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                    : 'border-transparent text-muted hover:text-gray-700 dark:hover:text-gray-200')
                }
                onClick={() => setActiveTab(i)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          {mobileMode && tabScrollHint.left && (
            <HScrollHintArrow side="left" surface="var(--c-zone)" />
          )}
          {mobileMode && tabScrollHint.right && (
            <HScrollHintArrow side="right" surface="var(--c-zone)" />
          )}
        </div>
        {/* 탭 콘텐츠 — CSS Grid로 모든 탭을 같은 셀에 겹쳐 높이 통일 */}
        <div className="flex-1 overflow-auto px-3 py-4 md:p-5 overflow-x-hidden" style={{ minHeight: 0 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gridTemplateRows: '1fr',
          }}>
            {tabs.map((_, i) => (
              <div
                key={i}
                style={{
                  gridRow: 1,
                  gridColumn: 1,
                  visibility: activeTab === i ? 'visible' : 'hidden',
                }}
              >
                {getTabContent(i)}
              </div>
            ))}
          </div>
        </div>
        {/* 저장 버튼 */}
        <div className="flex-none px-3 py-4 md:p-4 border-t line-color">
          <button className="btn w-full back-sky py-2.5 rounded-lg font-medium"
            onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
});

export default ConfigScreen;
