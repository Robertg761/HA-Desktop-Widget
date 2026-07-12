/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  collectCoverageFrom: [
    // main.js is the Electron composition root. Its security-sensitive behavior
    // lives in covered src/* helpers, while process wiring is checked separately
    // and every CI run now performs an Electron package smoke build.
    'renderer.js',
    'preload.js',
    'profile-sync-core.js',
    'src/**/*.{js,cjs}'
  ],
  roots: ['<rootDir>'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/AppData/',
    '/.vscode/',
    '/.cursor/',
    '/dist/',
    '/build/'
  ],
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(sortablejs|hls.js)/)'
  ],
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 50,
      functions: 60,
      lines: 60,
    },
    './preload.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
    './src/preload-api.cjs': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
};
