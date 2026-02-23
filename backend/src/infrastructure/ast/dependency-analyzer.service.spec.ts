import * as path from 'path';
import { DependencyAnalyzerService } from './dependency-analyzer.service';

describe('DependencyAnalyzerService', () => {
  let service: DependencyAnalyzerService;

  beforeEach(() => {
    service = new DependencyAnalyzerService();
  });

  describe('The "AST Context" Extraction Test (Accuracy)', () => {
    it('should accurately extract public methods and their types from a source file', async () => {
      // Create a virtual file with ts-morph to avoid writing temp files to disk
      // We can access the private 'project' property to do this safely in tests.
      const project = (service as any).project;
      
      const mockedCode = `
        export class MyMockedDependency {
          private internalState: string;
          
          constructor(private someValue: number) {}
          
          public fetchData(id: string): Promise<any> {
            return Promise.resolve();
          }

          calculateTotal(items: number[]): number {
            return items.reduce((a, b) => a + b, 0);
          }

          protected helperMethod(): void {}
        }

        export class TargetClass {
          constructor(private readonly dependency: MyMockedDependency) {}
        }
      `;

      const mockFilePath = path.join(process.cwd(), 'src', 'mock-source.ts');
      project.createSourceFile(mockFilePath, mockedCode);

      // Analyze the file
      const dependencies = await service.analyze(mockFilePath, process.cwd());

      expect(dependencies).toBeDefined();
      expect(dependencies.length).toBe(1);

      const injectedDep = dependencies[0];
      expect(injectedDep.name).toBe('MyMockedDependency');
      
      // It should extract the 2 public methods, skipping the private/protected ones.
      expect(injectedDep.methods.length).toBe(2);

      const fetchMethod = injectedDep.methods.find(m => m.name === 'fetchData');
      expect(fetchMethod).toBeDefined();
      expect(fetchMethod!.parameters).toBe('id: string');
      expect(fetchMethod!.returnType).toBe('Promise<any>');

      const calcMethod = injectedDep.methods.find(m => m.name === 'calculateTotal');
      expect(calcMethod).toBeDefined();
      expect(calcMethod!.parameters).toBe('items: number[]');
      expect(calcMethod!.returnType).toBe('number');
    });
  });
});
