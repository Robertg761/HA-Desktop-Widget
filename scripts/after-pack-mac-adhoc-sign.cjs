const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPackMacAdhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
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
