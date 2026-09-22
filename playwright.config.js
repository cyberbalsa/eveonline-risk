import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.js',fullyParallel:true,workers:2,
  use:{baseURL:'http://127.0.0.1:8090',trace:'retain-on-failure'},
  webServer:{command:'python3 -m http.server 8090',url:'http://127.0.0.1:8090',reuseExistingServer:!process.env.CI},
});
