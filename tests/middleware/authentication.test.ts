import { authenticate } from '../../src/server';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../src/utils/logger';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn()
  }
}));

describe('Authentication Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn()
    };
    nextFunction = jest.fn();
    process.env.API_KEY = 'valid-api-key-123';
  });

  afterEach(() => {
    delete process.env.API_KEY;
    jest.clearAllMocks();
  });

  it('should allow valid single API key', () => {
    mockRequest.headers = { 'x-api-key': 'valid-api-key-123' };
    authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it('should reject multiple API keys in header', () => {
    mockRequest.headers = { 'x-api-key': ['key1', 'key2'] as any };
    authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Multiple API keys provided' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should reject missing API key', () => {
    authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'API key required' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should reject invalid API key', () => {
    mockRequest.headers = { 'x-api-key': 'invalid-key' };
    authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Access denied' });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should handle missing API_KEY environment variable', () => {
    delete process.env.API_KEY;
    mockRequest.headers = { 'x-api-key': 'any-key' };
    authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Server configuration error' });
    expect(logger.error).toHaveBeenCalledWith('API_KEY environment variable not set');
  });
});