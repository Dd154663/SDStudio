import {
  ExportPresetV2,
  FilenamePattern,
  OutputMode,
  buildExportFileName,
  migrateExportPreset,
  resolveExportTargetFolder,
  sanitizeFilenamePart,
} from '../renderer/models/exportPresetUtils';

describe('exportPresetUtils', () => {
  describe('resolveExportTargetFolder', () => {
    const presetBase: Omit<ExportPresetV2, 'targetFolder' | 'useProjectRelativePath'> = {
      name: 'test',
      menu: 'all',
      filenamePattern: 'project.scene',
      outputMode: 'files',
      opt: 'original',
      imageSize: 0,
      isDefault: false,
    };

    it('returns preset target folder as-is when relative path is disabled', () => {
      const preset: ExportPresetV2 = {
        ...presetBase,
        targetFolder: 'D:/exports',
        useProjectRelativePath: false,
      };
      expect(resolveExportTargetFolder(preset, 'U149/Chie', 'C:/default')).toBe('D:/exports');
    });

    it('appends project folder when relative path is enabled', () => {
      const preset: ExportPresetV2 = {
        ...presetBase,
        targetFolder: 'D:/exports',
        useProjectRelativePath: true,
      };
      expect(resolveExportTargetFolder(preset, 'U149/Chie', 'C:/default')).toBe('D:/exports/U149/Chie');
    });

    it('falls back to default folder when preset has no target folder', () => {
      const preset: ExportPresetV2 = {
        ...presetBase,
        targetFolder: '',
        useProjectRelativePath: true,
      };
      expect(resolveExportTargetFolder(preset, 'U149/Chie', 'C:/default')).toBe('C:/default/U149/Chie');
    });

    it('returns null when neither preset nor default folder is set', () => {
      const preset: ExportPresetV2 = {
        ...presetBase,
        targetFolder: '',
        useProjectRelativePath: true,
      };
      expect(resolveExportTargetFolder(preset, 'U149/Chie', undefined)).toBeNull();
    });

    it('ignores project folder when it is null even if relative path is enabled', () => {
      const preset: ExportPresetV2 = {
        ...presetBase,
        targetFolder: 'D:/exports',
        useProjectRelativePath: true,
      };
      expect(resolveExportTargetFolder(preset, null, 'C:/default')).toBe('D:/exports');
    });
  });

  describe('buildExportFileName', () => {
    it('builds folder.project.scene pattern', () => {
      expect(buildExportFileName('folder.project.scene', 'Chie', 'Sample', 'smile', 1, 'png')).toBe(
        'Chie.Sample.smile.1.png',
      );
    });

    it('builds project.scene pattern', () => {
      expect(buildExportFileName('project.scene', 'Chie', 'Sample', 'smile', 1, 'png')).toBe(
        'Sample.smile.1.png',
      );
    });

    it('uses the provided index', () => {
      expect(buildExportFileName('project.scene', 'Chie', 'Sample', 'smile', 42, 'webp')).toBe(
        'Sample.smile.42.webp',
      );
    });
  });

  describe('sanitizeFilenamePart', () => {
    it('removes invalid Windows filename characters', () => {
      expect(sanitizeFilenamePart('a/b\\c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    });

    it('replaces spaces with underscores', () => {
      expect(sanitizeFilenamePart('happy smile')).toBe('happy_smile');
    });

    it('preserves Korean, Japanese, dots, hyphens and underscores', () => {
      expect(sanitizeFilenamePart('한글.ひらがな_-test')).toBe('한글.ひらがな_-test');
    });

    it('trims leading and trailing dots and spaces', () => {
      expect(sanitizeFilenamePart(' .hello. ')).toBe('hello');
    });
  });

  describe('migrateExportPreset', () => {
    it('migrates old normal preset to project.scene with tar output', () => {
      const old = {
        name: 'old-normal',
        menu: 'all' as const,
        format: 'normal' as const,
        prefix: '',
        opt: 'original' as const,
        imageSize: 0,
        separator: '.',
      };
      const migrated = migrateExportPreset(old);
      expect(migrated.filenamePattern).toBe('project.scene' as FilenamePattern);
      expect(migrated.outputMode).toBe('tar' as OutputMode);
      expect(migrated.useProjectRelativePath).toBe(true);
      expect(migrated.targetFolder).toBe('');
    });

    it('migrates old prefix preset to folder.project.scene with tar output', () => {
      const old = {
        name: 'old-prefix',
        menu: 'fav' as const,
        format: 'prefix' as const,
        prefix: 'Chie',
        opt: 'lossy' as const,
        imageSize: 1024,
        separator: '.',
      };
      const migrated = migrateExportPreset(old);
      expect(migrated.filenamePattern).toBe('folder.project.scene' as FilenamePattern);
      expect(migrated.outputMode).toBe('tar' as OutputMode);
      expect(migrated.useProjectRelativePath).toBe(true);
      expect(migrated.imageSize).toBe(1024);
    });

    it('leaves new-style presets unchanged', () => {
      const preset: ExportPresetV2 = {
        name: 'new',
        menu: 'all',
        filenamePattern: 'project.scene',
        outputMode: 'files',
        targetFolder: 'D:/out',
        useProjectRelativePath: false,
        opt: 'original',
        imageSize: 0,
        isDefault: true,
      };
      expect(migrateExportPreset(preset as any)).toEqual(preset);
    });
  });
});
