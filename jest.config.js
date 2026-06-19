module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: [
    "pipeline/**/*.js",
    "server.js",
    "!pipeline/reportExporter.js",
    "!pipeline/obsidianExporter.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary"],
  verbose: true,
  // 每个测试文件 30s 超时
  testTimeout: 30000,
};
