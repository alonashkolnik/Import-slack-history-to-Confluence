// Electron end-to-end tests: each spec launches the real app against a local
// mock Confluence Cloud server (see test/helpers).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  workers: 2,
  reporter: [['list']],
});
