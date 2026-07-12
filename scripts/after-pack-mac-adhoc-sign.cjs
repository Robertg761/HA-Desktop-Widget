const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPackMacAdhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  // electron-builder creates unsigned x64/arm64 temporary apps before merging a
  // universal build. Signing those intermediates changes CodeResources and makes
  // the merge fail. The hook runs again for the final universal app, which is the
  // package that should receive the ad-hoc signature.
  if (/mac-universal-(?:x64|arm64)-temp$/.test(context.appOutDir)) {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });

  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath], {
    stdio: 'inherit',
  });
};
