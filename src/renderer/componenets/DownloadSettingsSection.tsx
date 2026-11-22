// 환경설정 「저장·이미지」 탭(PC, 종전 「저장 경로」)의 「이미지 다운로드」 구획(2026-11-19 — 종전 다운로드 창 「고급 설정」·「변경」에서 이전).
// 값은 config `downloadSettings`(형식 불변)에 imageDownloadService.updateSettings 로 즉시 저장한다 — 환경설정 [저장]은
// 최신 config 를 다시 읽어(`...old`) 이 키를 건드리지 않으므로 서로 덮어쓰지 않는다. 모바일은 폴더 선택이 없어 그리지 않는다.
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { imageDownloadService } from '../models';
import { platform } from '../models/platform';
import { appState } from '../models/AppService';
import { IMAGE_DOWNLOAD_TEXT } from '../models/ImageDownloadService';
import { SettingField, SettingGroup, SettingSwitchRow } from './SettingControls';

const TextSetting = ({
  id,
  label,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) => {
  // 글자마다 config 를 쓰지 않도록 칸을 벗어날 때(또는 Enter) 한 번 저장한다
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div>
      <label htmlFor={id} className="block text-sm gray-label mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="gray-input w-full"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
};

export const DownloadSettingsSection = observer(() => {
  if (platform.isMobile) return null;
  const settings = imageDownloadService.settings;
  const changeFolder = async () => {
    const newPath = await imageDownloadService.changeSavePath();
    if (newPath) appState.pushMessage(IMAGE_DOWNLOAD_TEXT.folderChanged(newPath));
  };
  // 묶음 상자(2026-11-20 UI 정돈 그룹 1-a) — 제목 「이미지 다운로드」는 묶음 제목 한 번만. 체크 3곳은 즉시 저장이라 스위치 줄.
  // data-download-settings 는 묶음 바깥 감싸개(탭 흐름 단위).
  return (
    <div data-download-settings="">
     <SettingGroup title="이미지 다운로드">
      <SettingField className="space-y-3">
        <div>
          <p className="text-xs text-muted mb-2">
            이미지 그리드·이미지 우클릭의 「다운로드」가 저장하는 폴더와 파일명 규칙입니다. 바꾸면 바로 저장됩니다.
          </p>
          <p className="text-xs text-muted mb-2">
            여러 장을 받으면 씬 이름으로 폴더를 만들어 그 안에 저장합니다(같은 이름이 있으면 「씬이름 (2)」처럼 새 이름).
          </p>
          <div className="text-sm text-muted bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 break-all">
            {settings.lastSavePath || '미지정 (처음 다운로드할 때 폴더를 고릅니다)'}
          </div>
        </div>
        <button className="btn w-full back-green py-2 rounded" onClick={changeFolder}>
          다운로드 저장 폴더 변경
        </button>
        <TextSetting
          id="cfgDlPrefix"
          label="기본 접두사"
          value={settings.defaultPrefix || ''}
          placeholder="예: project"
          onCommit={(v) => imageDownloadService.updateSettings({ defaultPrefix: v })}
        />
        <TextSetting
          id="cfgDlSuffix"
          label="기본 접미사"
          value={settings.defaultSuffix || ''}
          placeholder="예: final"
          onCommit={(v) => imageDownloadService.updateSettings({ defaultSuffix: v })}
        />
      </SettingField>
      <SettingSwitchRow
        id="cfgDlTimestamp"
        checked={!!settings.includeTimestamp}
        onChange={(checked) => imageDownloadService.updateSettings({ includeTimestamp: checked })}
        label="파일명에 타임스탬프 포함"
      />
      <SettingSwitchRow
        id="cfgDlAutoNumber"
        checked={!!settings.autoNumbering}
        onChange={(checked) => imageDownloadService.updateSettings({ autoNumbering: checked })}
        label="파일명 중복 시 자동 넘버링"
      />
      <SettingSwitchRow
        id="cfgDlOverwrite"
        checked={!!settings.overwriteExisting}
        // 종전 창과 같이 자동 넘버링이 켜져 있으면 덮어쓰기는 고를 수 없다(넘버링이 우선)
        disabled={!!settings.autoNumbering}
        onChange={(checked) => imageDownloadService.updateSettings({ overwriteExisting: checked })}
        label="기존 파일 덮어쓰기"
      />
     </SettingGroup>
    </div>
  );
});

export default DownloadSettingsSection;
