const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadEnsure() {
  const start = mainSource.indexOf('function ensureFollowOmarchyDefault');
  const end = mainSource.indexOf('function getProfileSyncConfig', start);
  const context = {};
  vm.runInNewContext(mainSource.slice(start, end), context);
  return context.ensureFollowOmarchyDefault;
}

describe('Follow Omarchy theme default', () => {
  const ensure = loadEnsure();

  it('is on for a new profile', () => {
    expect(ensure({ ui: {} })).toEqual({
      ui: { followOmarchy: true },
      omarchyThemeDefaultApplied: true,
    });
  });

  it('turns on the unticked default that earlier versions saved, once', () => {
    const config = ensure({ ui: { followOmarchy: false, theme: 'dark' } });
    expect(config.ui).toEqual({ followOmarchy: true, theme: 'dark' });
    expect(config.omarchyThemeDefaultApplied).toBe(true);
  });

  it('keeps a choice made after the default was applied', () => {
    const config = { ui: { followOmarchy: false }, omarchyThemeDefaultApplied: true };
    expect(ensure(config).ui.followOmarchy).toBe(false);
    const missing = { ui: {}, omarchyThemeDefaultApplied: true };
    expect(ensure(missing).ui.followOmarchy).toBe(true);
  });

  it('is part of the shipped defaults and every config load path', () => {
    expect(mainSource).toMatch(
      /enableInteractionDebugLogs: false,\n[^\n]*\n\s+followOmarchy: true,/
    );
    expect(mainSource.match(/ensureFollowOmarchyDefault\(config\);/g)).toHaveLength(2);
  });
});
