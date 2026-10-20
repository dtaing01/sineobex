import { describe, expect, it } from 'vitest';
import { camel, generateDart, pascal, type OpenApiDocument } from '../scripts/dart.ts';

const doc: OpenApiDocument = {
  info: { title: 'Test', version: '1' },
  components: {
    schemas: {
      Status: { type: 'string', enum: ['new', 'ongoing', 'resolved'] },
      Problem: {
        type: 'object',
        required: ['id', 'status', 'notes', 'recordedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { $ref: '#/components/schemas/Status' },
          notes: { type: 'array', items: { type: 'string' } },
          recordedAt: { type: 'string', format: 'date-time' },
          resolvedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          code: { type: 'string' },
          data: {},
          counts: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
    },
  },
  paths: {
    '/v1/patients/{patientId}/problems': {
      get: {
        operationId: 'listProblems',
        parameters: [
          { name: 'patientId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/Status' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Problem' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'addProblem',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
        responses: { '204': { description: 'done' } },
      },
    },
  },
};

describe('Dart generator', () => {
  const out = generateDart(doc);

  it('names things the Dart way and avoids reserved words', () => {
    expect(pascal('get_health')).toBe('GetHealth');
    expect(camel('new')).toBe('newValue');
    expect(camel('2+')).toBe('v2');
    expect(camel('program_admin')).toBe('programAdmin');
  });

  it('emits enums with an unknown fallback', () => {
    expect(out).toContain('enum Status {');
    expect(out).toContain("newValue('new')");
    expect(out).toContain('orElse: () => Status.unknown');
  });

  it('maps required, optional and nullable fields', () => {
    expect(out).toContain('final DateTime recordedAt;');
    expect(out).toContain('final DateTime? resolvedAt;');
    expect(out).toContain('final String? code;');
    expect(out).toContain('final Object? data;');
    expect(out).toContain('final Map<String, int>? counts;');
    expect(out).toContain("if (code != null) 'code': code!,");
    expect(out).toContain("'recordedAt': recordedAt.toUtc().toIso8601String(),");
  });

  it('always sends an untyped field, because null is one of its values', () => {
    expect(out).toContain("        'data': data,");
    expect(out).not.toContain("if (data != null) 'data'");
  });

  it('builds client methods with path, query and body parameters', () => {
    expect(out).toContain(
      'Future<List<Problem>> listProblems({required String patientId, Status? status}) async {',
    );
    expect(out).toContain("'/v1/patients/${Uri.encodeComponent(patientId)}/problems'");
    expect(out).toContain("if (status != null) 'status': (status.toJson()).toString()");
    expect(out).toContain('Future<void> addProblem({required Problem body}) async {');
  });

  it('merges allOf (Zod extend) into one class', () => {
    const extended = generateDart({
      ...doc,
      paths: {
        '/x': {
          put: {
            operationId: 'changeIt',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      allOf: [
                        { $ref: '#/components/schemas/Problem' },
                        {
                          type: 'object',
                          required: ['direction'],
                          properties: { direction: { type: 'string', enum: ['up', 'down'] } },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(extended).toContain('Future<ChangeItResponse> changeIt() async {');
    expect(extended).toMatch(
      /class ChangeItResponse \{[\s\S]*final ChangeItResponseDirection direction;[\s\S]*final DateTime recordedAt;/,
    );
  });

  it('is deterministic', () => {
    expect(generateDart(doc)).toBe(out);
  });

  it('fails loudly on schema shapes it does not support', () => {
    const bad: OpenApiDocument = {
      ...doc,
      components: { schemas: { Weird: { type: 'object', properties: { x: { type: 'file' } } } } },
      paths: {},
    };
    expect(() => generateDart(bad)).toThrow(/Unsupported schema type/);
  });
});
