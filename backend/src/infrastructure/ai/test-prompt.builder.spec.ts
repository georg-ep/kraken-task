import { TestPromptBuilder } from './test-prompt.builder';

describe('TestPromptBuilder', () => {
  let builder: TestPromptBuilder;

  beforeEach(() => {
    builder = new TestPromptBuilder();
  });

  describe('buildSystemInstruction()', () => {
    it('should embed the target coverage percentage in the returned string', () => {
      const result = builder.buildSystemInstruction(85);
      expect(result).toContain('85%');
    });

    it('should include key constraint keywords', () => {
      const result = builder.buildSystemInstruction(80);
      expect(result).toContain('Mock all external infrastructure');
      expect(result).toContain('RETURN ONLY RAW TS CODE');
      expect(result).toContain('supertest');
    });

    it('should not start or end with extra whitespace', () => {
      const result = builder.buildSystemInstruction(80);
      expect(result).toBe(result.trim());
    });

    it('should work with 0% coverage target', () => {
      const result = builder.buildSystemInstruction(0);
      expect(result).toContain('0%');
    });

    it('should work with 100% coverage target', () => {
      const result = builder.buildSystemInstruction(100);
      expect(result).toContain('100%');
    });
  });

  describe('buildPrompt()', () => {
    const baseArgs = {
      sourcePath: 'src/services/my.service.ts',
      testPath: 'src/services/my.service.test.ts',
      code: 'export class MyService { greet() { return "hello"; } }',
      pkgs: 'jest, ts-jest',
      importPath: './my.service',
      signatures: '',
      lastError: '',
    };

    it('should include source and test paths in the prompt', () => {
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        baseArgs.lastError,
      );
      expect(result).toContain('src/services/my.service.ts');
      expect(result).toContain('src/services/my.service.test.ts');
    });

    it('should include the source code in the prompt', () => {
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        baseArgs.lastError,
      );
      expect(result).toContain('export class MyService');
    });

    it('should include the import path in the prompt', () => {
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        baseArgs.lastError,
      );
      expect(result).toContain('./my.service');
    });

    it('should include "Please generate the initial test suite now." when no prior error exists', () => {
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        '',
      );
      expect(result).toContain('Please generate the initial test suite now.');
      expect(result).not.toContain('LAST VALIDATION ATTEMPT FAILED');
    });

    it('should include the previous error and repair instructions when lastError is set', () => {
      const error = 'TS2345: SomeType is not assignable';
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        error,
      );
      expect(result).toContain('LAST VALIDATION ATTEMPT FAILED WITH ERROR:');
      expect(result).toContain(error);
      expect(result).toContain(
        'Please analyze the error and repair the code below.',
      );
    });

    it('should include dependency signatures when provided', () => {
      const sigs =
        '\nINJECTED DEPENDENCY SIGNATURES:\nClass FooService { bar(): string; }';
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        sigs,
        '',
      );
      expect(result).toContain('FooService');
    });

    it('should not start or end with extra whitespace', () => {
      const result = builder.buildPrompt(
        baseArgs.sourcePath,
        baseArgs.testPath,
        baseArgs.code,
        baseArgs.pkgs,
        baseArgs.importPath,
        baseArgs.signatures,
        baseArgs.lastError,
      );
      expect(result).toBe(result.trim());
    });
  });
});
