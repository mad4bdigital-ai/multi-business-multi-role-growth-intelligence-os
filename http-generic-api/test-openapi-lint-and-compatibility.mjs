#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  buildCompatibilitySnapshot,
  checkCompatibility,
  lintOpenApi,
} from './scripts/openapi-lint-and-compatibility.mjs';

function clone(value) {
  return structuredClone(value);
}

function validDocument() {
  return {
    openapi: '3.1.0',
    info: { title: 'Fixture API', version: '1.0.0' },
    security: [{ bearerAuth: [] }],
    paths: {
      '/widgets/{widgetId}': {
        get: {
          tags: ['widgets'],
          operationId: 'getWidget',
          summary: 'Get a widget',
          parameters: [
            {
              name: 'widgetId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'Widget',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Widget' },
                },
              },
            },
          },
        },
      },
      '/widgets': {
        post: {
          tags: ['widgets'],
          operationId: 'createWidget',
          summary: 'Create a widget',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateWidgetRequest' },
              },
            },
          },
          responses: {
            201: {
              description: 'Created widget',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Widget' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Subject: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        Action: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
        Resource: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        AuthorizationDecisionRequest: {
          type: 'object',
          required: ['subject'],
          properties: {
            subject: { $ref: '#/components/schemas/Subject' },
          },
        },
        AuthorizationDecision: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['allowed', 'denied'] },
          },
        },
        ExecutionEnvelope: {
          type: 'object',
          required: ['envelopeId'],
          properties: { envelopeId: { type: 'string' } },
        },
        ApprovalDecision: {
          type: 'object',
          required: ['state'],
          properties: {
            state: { type: 'string', enum: ['approved', 'rejected'] },
          },
        },
        Execution: {
          type: 'object',
          required: ['executionId'],
          properties: { executionId: { type: 'string' } },
        },
        ExecutionEvidence: {
          type: 'object',
          required: ['evidenceId'],
          properties: { evidenceId: { type: 'string' } },
        },
        CursorPage: {
          type: 'object',
          required: ['hasMore'],
          properties: { hasMore: { type: 'boolean' } },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object' } },
        },
        CreateWidgetRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
        },
        Widget: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['active', 'archived'] },
          },
        },
      },
    },
  };
}

function compatibilityIssues(document, baseline) {
  return checkCompatibility(document, baseline).issues;
}

const document = validDocument();
const lintIssues = lintOpenApi(document);
assert.deepEqual(lintIssues, [], `expected valid fixture, got ${lintIssues.join('\n')}`);

const baseline = buildCompatibilitySnapshot(document, { contractName: 'fixture.yaml' });
assert.deepEqual(compatibilityIssues(document, baseline), []);

const additive = clone(document);
additive.components.schemas.CreateWidgetRequest.properties.optionalNote = { type: 'string' };
additive.components.schemas.Widget.properties.optionalNote = { type: 'string' };
additive.components.schemas.Widget.properties.status.enum.push('paused');
assert.deepEqual(compatibilityIssues(additive, baseline), []);

const removedOperation = clone(document);
delete removedOperation.paths['/widgets/{widgetId}'].get;
assert.match(
  compatibilityIssues(removedOperation, baseline).join('\n'),
  /operation removed: GET \/widgets\/\{widgetId\}/,
);

const changedOperationId = clone(document);
changedOperationId.paths['/widgets'].post.operationId = 'replaceWidget';
assert.match(
  compatibilityIssues(changedOperationId, baseline).join('\n'),
  /operationId changed/,
);

const requiredRequestProperty = clone(document);
requiredRequestProperty.components.schemas.CreateWidgetRequest.required.push('description');
assert.match(
  compatibilityIssues(requiredRequestProperty, baseline).join('\n'),
  /added required request property description/,
);

const removedRequiredResponseProperty = clone(document);
removedRequiredResponseProperty.components.schemas.Widget.required =
  removedRequiredResponseProperty.components.schemas.Widget.required.filter((name) => name !== 'name');
assert.match(
  compatibilityIssues(removedRequiredResponseProperty, baseline).join('\n'),
  /response removed required property name/,
);

const changedType = clone(document);
changedType.components.schemas.Subject.properties.id.type = 'integer';
assert.match(
  compatibilityIssues(changedType, baseline).join('\n'),
  /Subject\.id type changed from string to integer/,
);

const removedEnum = clone(document);
removedEnum.components.schemas.ApprovalDecision.properties.state.enum = ['approved'];
assert.match(
  compatibilityIssues(removedEnum, baseline).join('\n'),
  /ApprovalDecision\.state removed enum value "rejected"/,
);

const duplicateOperationId = clone(document);
duplicateOperationId.paths['/widgets'].post.operationId = 'getWidget';
assert.match(lintOpenApi(duplicateOperationId).join('\n'), /duplicates operationId getWidget/);

const unresolvedRef = clone(document);
unresolvedRef.paths['/widgets'].post.requestBody.content['application/json'].schema.$ref =
  '#/components/schemas/MissingRequest';
assert.match(lintOpenApi(unresolvedRef).join('\n'), /unresolved internal \$ref/);

const missingPathParameter = clone(document);
missingPathParameter.paths['/widgets/{widgetId}'].get.parameters = [];
assert.match(lintOpenApi(missingPathParameter).join('\n'), /path parameter widgetId is not declared/);

const optionalPathParameter = clone(document);
optionalPathParameter.paths['/widgets/{widgetId}'].get.parameters[0].required = false;
assert.match(lintOpenApi(optionalPathParameter).join('\n'), /must set required: true/);

const noSuccessResponse = clone(document);
noSuccessResponse.paths['/widgets'].post.responses = {
  400: { description: 'Bad request' },
};
assert.match(lintOpenApi(noSuccessResponse).join('\n'), /must define an explicit 2xx response/);

console.log('OpenAPI lint and compatibility mutation tests passed.');
