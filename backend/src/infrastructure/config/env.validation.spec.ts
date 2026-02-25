import { envSchema, validateEnv } from './env.validation';

describe('env.validation', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '3000',
    DB_PATH: 'database.sqlite',
    GITHUB_TOKEN: 'ghp_abc123',
    GEMINI_API_KEY: 'ai-key-xyz',
    GEMINI_MODEL: 'gemini-2.0-flash-lite',
  };

  describe('validateEnv()', () => {
    it('should return parsed config on valid input', () => {
      const result = validateEnv(validEnv);
      expect(result.GITHUB_TOKEN).toBe('ghp_abc123');
      expect(result.GEMINI_API_KEY).toBe('ai-key-xyz');
      expect(result.PORT).toBe(3000); // coerced to number
      expect(result.NODE_ENV).toBe('development');
    });

    it('should throw when GITHUB_TOKEN is missing', () => {
      const { GITHUB_TOKEN, ...rest } = validEnv;
      expect(() => validateEnv(rest)).toThrow('Invalid environment variables');
    });

    it('should throw when GEMINI_API_KEY is missing', () => {
      const { GEMINI_API_KEY, ...rest } = validEnv;
      expect(() => validateEnv(rest)).toThrow('Invalid environment variables');
    });

    it('should throw when NODE_ENV is an invalid value', () => {
      expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
        'Invalid environment variables',
      );
    });

    it('should apply defaults for optional fields', () => {
      const { DB_PATH, GEMINI_MODEL, PORT, ...minimal } = validEnv;
      const result = validateEnv(minimal);
      expect(result.DB_PATH).toBe('database.sqlite');
      expect(result.GEMINI_MODEL).toBe('gemini-2.0-flash-lite');
      expect(result.PORT).toBe(3000);
    });

    it('should coerce PORT string to number', () => {
      const result = validateEnv({ ...validEnv, PORT: '8080' });
      expect(result.PORT).toBe(8080);
      expect(typeof result.PORT).toBe('number');
    });

    it('should accept production as NODE_ENV', () => {
      const result = validateEnv({ ...validEnv, NODE_ENV: 'production' });
      expect(result.NODE_ENV).toBe('production');
    });
  });

  describe('envSchema', () => {
    it('should accept all valid environments', () => {
      for (const env of ['development', 'test', 'production'] as const) {
        const result = envSchema.safeParse({ ...validEnv, NODE_ENV: env });
        expect(result.success).toBe(true);
      }
    });

    it('should reject empty GITHUB_TOKEN', () => {
      const result = envSchema.safeParse({ ...validEnv, GITHUB_TOKEN: '' });
      expect(result.success).toBe(false);
    });
  });
});
