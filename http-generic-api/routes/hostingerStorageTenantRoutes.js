import { Router } from 'express';
import {
  isCanonicalHostingerStorageAuthorizedDependencyInjectionController,
  isCanonicalHostingerStorageMountedRuntimeResolution,
} from '../hostingerStorageAuthorizedDependencyInjection.js';

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const REASON_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SHA_RE = /^(?:[0-9a-f]{7,64}|sha256-[0-9a-f]{32,128})$/u;
const ALLOWED_BODY_FIELDS = Object.freeze(['expected_sha', 'operation_id']);
const ROUTE_PATH = '/tenant/storage-operations/apply-plan';
const DEPENDENCY_KEY = 'tenantStorageRuntime';

function requireTenantPrincipal(req, res, next) {
  if (req.auth?.mode !== 'user_jwt'
    || req.auth?.is_admin === true
    || !req.auth?.tenant_id
    || !req.auth?.user_id) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'tenant_user_jwt_required',
        message: 'A signed tenant user JWT with tenant_id and user_id is required.',
      },
      secrets_included: false,
    });
  }
  return next();
}

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function snapshotRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw fail(400, 'storage_tenant_request_body_invalid', 'A JSON object request body is required.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(body);
  const fields = Object.keys(descriptors).sort();
  const unexpected = fields.filter((field) => !ALLOWED_BODY_FIELDS.includes(field));
  if (unexpected.length) {
    throw fail(400, 'storage_tenant_request_field_forbidden', 'Only operation_id and expected_sha are accepted.', { fields: unexpected });
  }
  const result = {};
  for (const field of ALLOWED_BODY_FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || typeof descriptor.value !== 'string') {
      throw fail(400, 'storage_tenant_request_field_invalid', 'operation_id and expected_sha must be owned string values.', { field });
    }
    result[field] = descriptor.value.trim();
  }
  if (!TOKEN_RE.test(result.operation_id)) {
    throw fail(400, 'storage_tenant_operation_id_invalid', 'A bounded operation_id is required.');
  }
  result.expected_sha = result.expected_sha.toLowerCase();
  if (!SHA_RE.test(result.expected_sha)) {
    throw fail(400, 'storage_tenant_expected_sha_invalid', 'A bounded expected_sha is required.');
  }
  return Object.freeze(result);
}

function safeReasonCodes(error) {
  const sources = [
    error?.reasonCodes,
    error?.details?.reason_codes,
    error?.details?.reasonCodes,
    error?.details?.mismatch_fields,
    error?.details?.mismatchFields,
    error?.details?.mismatches,
  ];
  return [...new Set(sources
    .flatMap((source) => Array.isArray(source) ? source : [])
    .map((value) => String(value || '').trim())
    .filter((value) => REASON_RE.test(value)))]
    .sort()
    .slice(0, 16);
}

function safeErrorResponse(error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  const code = String(error?.code || 'storage_tenant_runtime_failed').slice(0, 160);
  const reasonCodes = safeReasonCodes(error);
  const publicMessages = {
    storage_tenant_runtime_unavailable: 'Tenant storage runtime is not mounted.',
    storage_tenant_request_body_invalid: 'A JSON object request body is required.',
    storage_tenant_request_field_forbidden: 'Only operation_id and expected_sha are accepted.',
    storage_tenant_request_field_invalid: 'operation_id and expected_sha must be owned string values.',
    storage_tenant_operation_id_invalid: 'A bounded operation_id is required.',
    storage_tenant_expected_sha_invalid: 'A bounded expected_sha is required.',
  };
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message: publicMessages[code] || 'Tenant storage operation was rejected by a governed runtime check.',
        ...(reasonCodes.length ? { reason_codes: reasonCodes } : {}),
      },
      secrets_included: false,
    },
  };
}

function validateTenantStorageRuntime(runtime) {
  return Boolean(runtime
    && typeof runtime.execute === 'function'
    && runtime.synthetic_only === true
    && runtime.provider_dispatch_allowed === false
    && runtime.production_ready === false);
}

function resolveTenantStorageRuntime({ tenantStorageRuntime, tenantStorageRuntimeMount }) {
  if (tenantStorageRuntimeMount !== null && tenantStorageRuntimeMount !== undefined) {
    if (!isCanonicalHostingerStorageAuthorizedDependencyInjectionController(tenantStorageRuntimeMount)) {
      throw fail(503, 'storage_tenant_runtime_unavailable', 'Tenant storage runtime mount controller is invalid.');
    }
    try {
      const resolution = tenantStorageRuntimeMount.resolveMountedRuntime({
        route_path: ROUTE_PATH,
        dependency_key: DEPENDENCY_KEY,
      });
      if (!isCanonicalHostingerStorageMountedRuntimeResolution(resolution)) {
        throw fail(503, 'storage_tenant_runtime_unavailable', 'Tenant storage runtime mount readback is invalid.');
      }
      return resolution.tenantStorageRuntime;
    } catch (error) {
      if (error?.code === 'STORAGE_AUTHORIZED_DEPENDENCY_NOT_MOUNTED') {
        throw fail(503, 'storage_tenant_runtime_unavailable', 'Tenant storage runtime is not mounted.');
      }
      throw error;
    }
  }
  return tenantStorageRuntime;
}

export function buildHostingerStorageTenantRoutes({
  tenantStorageRuntime = null,
  tenantStorageRuntimeMount = null,
} = {}) {
  const router = Router();

  router.post(ROUTE_PATH, requireTenantPrincipal, async (req, res) => {
    try {
      const runtime = resolveTenantStorageRuntime({ tenantStorageRuntime, tenantStorageRuntimeMount });
      if (!validateTenantStorageRuntime(runtime)) {
        throw fail(503, 'storage_tenant_runtime_unavailable', 'Tenant storage runtime is not mounted.');
      }
      const body = snapshotRequestBody(req.body);
      const result = await runtime.execute({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        operationId: body.operation_id,
        expectedSha: body.expected_sha,
      });
      return res.status(200).json(result);
    } catch (error) {
      const response = safeErrorResponse(error);
      return res.status(response.status).json(response.body);
    }
  });

  return router;
}

export const _testingHostingerStorageTenantRoutes = Object.freeze({
  requireTenantPrincipal,
  snapshotRequestBody,
  safeReasonCodes,
  validateTenantStorageRuntime,
  resolveTenantStorageRuntime,
});
