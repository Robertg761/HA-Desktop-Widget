const path = require('path');

const ENTITY_ID_KEY_PATTERN = /^[a-z_]+\.[a-zA-Z0-9_]+$/;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isReservedObjectKey(value) {
  return RESERVED_OBJECT_KEYS.has(value);
}

function isPathInsideDirectory(candidatePath, parentDirectory) {
  if (!candidatePath || !parentDirectory) return false;
  const relativePath = path.relative(parentDirectory, candidatePath);
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

async function resolveExistingDirectory(directoryPath, fsModule) {
  const resolvedPath = path.resolve(directoryPath);
  try {
    const stats = await fsModule.promises.stat(resolvedPath);
    if (stats.isDirectory()) {
      return fsModule.promises.realpath(resolvedPath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return resolvedPath;
}

async function resolveFilePathWithRealDirectory(filePath, fsModule) {
  const resolvedPath = path.resolve(filePath);
  const resolvedDirectory = await resolveExistingDirectory(path.dirname(resolvedPath), fsModule);
  return path.join(resolvedDirectory, path.basename(resolvedPath));
}

async function normalizeProfileSyncCopyPath(filePath, defaultFileName, fsModule) {
  const rawPath = typeof filePath === 'string' ? filePath.trim() : '';
  if (!rawPath) {
    throw new Error('Source and destination file paths are required');
  }

  const resolvedPath = await resolveFilePathWithRealDirectory(rawPath, fsModule);
  if (path.basename(resolvedPath) !== defaultFileName) {
    throw new Error(`Profile sync copies are limited to ${defaultFileName}`);
  }
  return resolvedPath;
}

async function normalizeAllowedProfileSyncFolders(folders, fsModule) {
  const normalizedFolders = [];
  for (const folder of folders) {
    if (typeof folder !== 'string' || !folder.trim()) continue;
    normalizedFolders.push(await resolveExistingDirectory(folder.trim(), fsModule));
  }
  return normalizedFolders;
}

async function validateProfileSyncCopyPaths({
  fromPath,
  toPath,
  defaultFileName,
  allowedSourceFolders,
  allowedDestinationFolders,
  fsModule,
}) {
  const sourcePath = await normalizeProfileSyncCopyPath(fromPath, defaultFileName, fsModule);
  const destinationPath = await normalizeProfileSyncCopyPath(toPath, defaultFileName, fsModule);
  const normalizedSourceFolders = await normalizeAllowedProfileSyncFolders(
    allowedSourceFolders || [],
    fsModule
  );
  const normalizedDestinationFolders = await normalizeAllowedProfileSyncFolders(
    allowedDestinationFolders || [],
    fsModule
  );

  if (!normalizedSourceFolders.some((folder) => isPathInsideDirectory(sourcePath, folder))) {
    throw new Error(
      'Profile sync copy source must be inside the configured sync folder or app data folder'
    );
  }

  if (
    !normalizedDestinationFolders.some((folder) => isPathInsideDirectory(destinationPath, folder))
  ) {
    throw new Error(
      'Profile sync copy destination must be a selected sync folder or the app data folder'
    );
  }

  return { sourcePath, destinationPath };
}

function normalizeEntityIdForObjectKey(entityId, normalizeEntityId) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId || !ENTITY_ID_KEY_PATTERN.test(normalizedEntityId)) {
    return '';
  }

  const [domain, objectId] = normalizedEntityId.split('.');
  if (isReservedObjectKey(domain) || isReservedObjectKey(objectId)) {
    return '';
  }
  return normalizedEntityId;
}

function isAllowedHlsProxyPath(pathname) {
  if (typeof pathname !== 'string') return false;
  return (
    pathname.startsWith('/api/hls/') ||
    pathname.startsWith('/api/camera_proxy/') ||
    pathname.startsWith('/api/camera_proxy_stream/')
  );
}

module.exports = {
  isAllowedHlsProxyPath,
  normalizeEntityIdForObjectKey,
  validateProfileSyncCopyPaths,
};
