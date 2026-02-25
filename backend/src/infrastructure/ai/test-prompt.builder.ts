import { Injectable } from '@nestjs/common';

@Injectable()
export class TestPromptBuilder {
  buildSystemInstruction(targetCoverage: number): string {
    return `
You are a Senior TypeScript QA Engineer. Your goal is to generate robust, compiling Jest tests.

CONSTRAINTS:
1. MANDATORY: Mock all external infrastructure (Databases, Redis, external APIs).
2. CRITICAL: Aggressively mock database clients (Prisma, Mongoose, TypeORM). Use { virtual: true } in jest.mock if the library is native or potentially missing.
3. If the source file exports no default, DO NOT use a default import.
4. Route Testing: If testing Express/HTTP routes, use \`supertest\`. 
   - Create a small temporary Express app in the test, mount the router/handler.
   - ENSURE HANDLES ARE CLOSED: If you start a server or a complex async process, close it in \`afterAll\`.
   - USE \`jest.resetModules()\` and import the router inside \`beforeEach\` if the router has side effects.
   - MOCK ALL CONTROLLERS: Use \`jest.mock('../path/to/controller')\` at the top level.
5. USE THE PROVIDED SIGNATURES: For injected dependencies, only use the methods listed in the context.
6. Explicit Imports: ALWAYS use explicit imports for jest globals: import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
7. COMPILABILITY (CRITICAL): To prevent TSC errors like "Type 'number' is not assignable to type 'Decimal'", aggressively cast mock return objects using \`as any\`. Avoid \`toBeInstanceOf\` on virtual mocks. 
8. MOCKING SYNTAX: If you get 'never' type errors with Prisma mocks, cast the mock to \`any\` or use \`jest.mocked(prisma.wallet, { shallow: true })\`. DO NOT pass a boolean to jest.mocked.
9. COVERAGE TARGET: Aim for at least ${targetCoverage}% statement coverage. If you fail the coverage target, you will receive information about uncovered statements to help you repair the test.
10. RETURN ONLY RAW TS CODE. No markdown wrappers.
    `.trim();
  }

  buildPrompt(
    sourcePath: string,
    testPath: string,
    code: string,
    pkgs: string,
    importPath: string,
    signatures: string,
    lastError: string,
  ): string {
    const errorSection = lastError
      ? `LAST VALIDATION ATTEMPT FAILED WITH ERROR:\n${lastError}\n\nPlease analyze the error and repair the code below.`
      : 'Please generate the initial test suite now.';

    return `
GENERATE TEST FOR: ${sourcePath}
SAVE PATH: ${testPath}
IMPORT PATH: "${importPath}"

SOURCE CODE:
${code}

INSTALLED PACKAGES:
${pkgs}
${signatures}

${errorSection}
    `.trim();
  }
}
