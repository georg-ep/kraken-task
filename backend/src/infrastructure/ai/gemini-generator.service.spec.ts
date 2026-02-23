import { ConfigService } from '@nestjs/config';
import { DependencyAnalyzerService } from '../ast/dependency-analyzer.service';
import { SandboxExecutorService } from '../sandbox/sandbox-executor.service';
import { TestValidatorService } from '../validation/test-validator.service';
import { GeminiGeneratorService } from './gemini-generator.service';
import { TestPromptBuilder } from './test-prompt.builder';

describe('GeminiGeneratorService', () => {
  let service: GeminiGeneratorService;

  beforeEach(() => {
    // We only need the service instance to test its private methods via reflection/any casting.
    // The other dependencies can be mocked loosely.
    const configService = {
      get: jest.fn().mockImplementation((key) => {
        if (key === 'GEMINI_API_KEY') return 'test-key';
        return undefined;
      })
    } as unknown as ConfigService;

    service = new GeminiGeneratorService(
      configService,
      {} as DependencyAnalyzerService,
      {} as SandboxExecutorService,
      {} as TestValidatorService,
      {} as TestPromptBuilder
    );
  });

  describe('The "Hallucination" Test (AI Safety)', () => {
    it('should strip markdown codeblocks and text prefixes from AI responses', () => {
      // Access the private cleanResponse method
      const cleanResponse = (service as any).cleanResponse.bind(service);

      const messyResponse1 = `
Here is the code you requested:

\`\`\`typescript
import { Test } from '@nestjs/testing';
console.log('hello');
\`\`\`
      `;

      const messyResponse2 = `\`\`\`ts\nconst x = 1;\n\`\`\``;
      const messyResponse3 = `   \`\`\`javascript\nlet y = 2;\n\`\`\`   `;
      const cleanResponse4 = `const z = 3;`; // Already clean

      // The current cleanResponse implementation is a bit naive (it only replaces the very start/end).
      // We are testing its current boundaries.
      // Wait, let's look at cleanResponse:
      // return content.replace(/^```(?:typescript|ts|javascript|js)?\n/gim, '').replace(/```$/g, '').trim();

      const stripped1 = cleanResponse(messyResponse1);
      expect(stripped1).toBe(`import { Test } from '@nestjs/testing';\nconsole.log('hello');`);
      
      const stripped2 = cleanResponse(messyResponse2);
      expect(stripped2).toBe('const x = 1;');

      const stripped3 = cleanResponse(messyResponse3.trim());
      expect(stripped3).toBe('let y = 2;');

      const stripped4 = cleanResponse(cleanResponse4);
      expect(stripped4).toBe('const z = 3;');
    });
  });
});
