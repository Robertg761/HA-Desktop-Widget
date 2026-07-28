const path = require('path');

async function requireExistingSyncParentDirectory(filePath, fsModule) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Sync file path is not configured');
  }
  const parentPath = path.dirname(path.resolve(filePath));
  let stats;
  try {
    stats = await fsModule.promises.stat(parentPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'The selected sync folder is unavailable. Reconnect the cloud provider or choose the folder again.'
      );
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error('The selected sync folder path is not a directory');
  }
  return parentPath;
}

module.exports = { requireExistingSyncParentDirectory };
