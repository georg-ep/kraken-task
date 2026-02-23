import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { ClassDeclaration, Project, TypeFormatFlags } from 'ts-morph';

/**
 * Interface representing a dependency's public method signature.
 */
export interface DependencyMethod {
  name: string;
  parameters: string;
  returnType: string;
}

/**
 * Interface representing a class dependency.
 */
export interface DependencyContext {
  name: string;
  methods: DependencyMethod[];
}

@Injectable()
export class DependencyAnalyzerService {
  private readonly logger = new Logger(DependencyAnalyzerService.name);
  private readonly project: Project;

  constructor() {
    this.project = new Project({
      tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Analyzes a source file to extract its dependencies and their public method signatures.
   * Handles both NestJS classes (constructor injection) and plain module usage (top-level imports).
   */
  async analyze(sourceFilePath: string, repoRoot: string): Promise<DependencyContext[]> {
    try {
      this.logger.log(`Analyzing dependencies for ${sourceFilePath}...`);
      const sourceFile = this.project.addSourceFileAtPath(sourceFilePath);
      const dependencies: Map<string, DependencyContext> = new Map();

      // 1. Analyze Classes (NestJS style)
      for (const targetClass of sourceFile.getClasses()) {
        const constructor = targetClass.getConstructors()[0];
        if (constructor) {
          for (const param of constructor.getParameters()) {
            const depContext = this.analyzeType(param.getType());
            if (depContext) dependencies.set(depContext.name, depContext);
          }
        }
      }

      // 2. Analyze top-level imports usage (Plain module style)
      // We look for usage of imported identifiers
      const imports = sourceFile.getImportDeclarations();
      for (const imp of imports) {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        
        // Special Case: Prisma
        if (moduleSpecifier.includes('prisma') || moduleSpecifier.includes('Prisma')) {
          dependencies.set('prisma', {
            name: 'prisma',
            methods: [
              { name: 'findUnique', parameters: 'options: any', returnType: 'Promise<any>' },
              { name: 'findMany', parameters: 'options: any', returnType: 'Promise<any[]>' },
              { name: 'create', parameters: 'options: any', returnType: 'Promise<any>' },
              { name: 'update', parameters: 'options: any', returnType: 'Promise<any>' },
              { name: 'delete', parameters: 'options: any', returnType: 'Promise<any>' },
              { name: 'count', parameters: 'options: any', returnType: 'Promise<number>' },
            ]
          });
        }
      }

      return Array.from(dependencies.values());
    } catch (error) {
      this.logger.error(`Failed to analyze dependencies for ${sourceFilePath}:`, error);
      return [];
    }
  }

  private analyzeType(type: any): DependencyContext | null {
    const typeSymbol = type.getSymbol();
    if (!typeSymbol) return null;

    const typeName = typeSymbol.getName();
    const skipTypes = ['Logger', 'ConfigService', 'EventEmitter2', 'Repository'];
    if (skipTypes.includes(typeName)) return null;

    const declarations = typeSymbol.getDeclarations();
    if (declarations.length === 0) return null;

    const declaration = declarations[0];
    if (!(declaration instanceof ClassDeclaration)) return null;

    const methods: DependencyMethod[] = [];
    for (const method of declaration.getMethods().filter(m => !m.getScope() || m.getScope() === 'public')) {
      methods.push({
        name: method.getName(),
        parameters: method.getParameters().map(p => `${p.getName()}: ${p.getType().getText(undefined, TypeFormatFlags.NoTruncation)}`).join(', '),
        returnType: method.getReturnType().getText(undefined, TypeFormatFlags.NoTruncation),
      });
    }

    return { name: typeName, methods };
  }

  /**
   * Formats the dependency context into a readable string for the AI prompt.
   */
  formatContext(dependencies: DependencyContext[]): string {
    if (dependencies.length === 0) return '';

    let output = '\nINJECTED DEPENDENCY SIGNATURES (Use these for mocking):\n';
    output += 'NOTE: If a type definition is missing or too complex, you are encouraged to use `any` for mocks to ensure the test compiles.\n';
    
    for (const dep of dependencies) {
      output += `\nClass ${dep.name} {\n`;
      for (const method of dep.methods) {
        output += `  ${method.name}(${method.parameters}): ${method.returnType};\n`;
      }
      output += '}\n';
    }
    return output;
  }
}
