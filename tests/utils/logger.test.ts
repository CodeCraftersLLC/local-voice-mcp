import { logger } from '../../src/utils/logger';

describe('logger sanitization', () => {
  const originalEnv = process.env.MCP_MODE;
  
  beforeEach(() => {
    // Mock stderr to capture logs
    jest.spyOn(process.stderr, 'write').mockImplementation();
    process.env.MCP_MODE = 'stdio'; // Ensure MCP mode
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.MCP_MODE = originalEnv;
  });

  it('should remove control characters', () => {
    logger.log('Test\x07with\x0Bcontrol\x01chars');
    
    const logCall = (process.stderr.write as jest.Mock).mock.calls[0][0];
    const logEntry = JSON.parse(logCall);
    
    expect(logEntry.message).toBe('Test with control chars');
  });

  it('should strip ANSI escape sequences', () => {
    logger.log('\u001b[31mRed\u001b[0m \u001b[32mGreen\u001b[0m');
    
    const logCall = (process.stderr.write as jest.Mock).mock.calls[0][0];
    const logEntry = JSON.parse(logCall);
    
    expect(logEntry.message).toBe('Red Green');
  });

  it('should handle unicode injection attempts', () => {
    logger.log('Normal\u202Etampered text\u202C');
    
    const logCall = (process.stderr.write as jest.Mock).mock.calls[0][0];
    const logEntry = JSON.parse(logCall);
    
    // We replace control chars with spaces, so expect spaces instead of control chars
    expect(logEntry.message).toBe('Normal tampered text ');
  });

  it('should preserve valid text', () => {
    const validText = 'This is valid text with numbers 123 and symbols !@#$%^&*()';
    logger.log(validText);
    
    const logCall = (process.stderr.write as jest.Mock).mock.calls[0][0];
    const logEntry = JSON.parse(logCall);
    
    expect(logEntry.message).toBe(validText);
  });

  it('should handle non-string inputs', () => {
    logger.log(String(12345));
    logger.log(JSON.stringify({ key: 'value' }));
    logger.log(String(null));
    
    const logCalls = (process.stderr.write as jest.Mock).mock.calls;
    
    expect(JSON.parse(logCalls[0][0]).message).toBe('12345');
    expect(JSON.parse(logCalls[1][0]).message).toBe('{"key":"value"}');
    expect(JSON.parse(logCalls[2][0]).message).toBe('null');
  });

  it('should handle long strings efficiently', () => {
    const longString = 'a'.repeat(10000) + '\x07' + 'b'.repeat(10000);
    logger.log(longString);
    
    const logCall = (process.stderr.write as jest.Mock).mock.calls[0][0];
    const logEntry = JSON.parse(logCall);
    
    expect(logEntry.message).toHaveLength(20001); // a*10000 + space + b*10000
    expect(logEntry.message).toBe('a'.repeat(10000) + ' ' + 'b'.repeat(10000));
  });
});