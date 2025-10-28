/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  roots: ['<rootDir>'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/AppData/',
    '/.vscode/',
    '/.cursor/',
    '/dist/',
    '/build/'
  ],
};

