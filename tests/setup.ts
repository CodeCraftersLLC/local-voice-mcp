// Jest setup file
import fs from 'fs';
import path from 'path';
import os from 'os';

// Create test temp directory
const TEST_TEMP_DIR = path.join(os.tmpdir(), 'local-voice-mcp-test');

beforeAll(() => {
  if (!fs.existsSync(TEST_TEMP_DIR)) {
    fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
  }
});

afterAll(() => {
  // Clean up test temp directory
  if (fs.existsSync(TEST_TEMP_DIR)) {
    fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
};
