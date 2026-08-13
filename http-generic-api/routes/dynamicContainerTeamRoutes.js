import { Router } from "express";
import { randomUUID } from "node:crypto";
import { createUserJwtMiddleware } from "../userJwtAuth.js";
import {
  listCoWorkspaces,
  listContainerTeam,
  removeContainerTeamMember,
  setContainerTeamMember
} from "../dynamicContainerTeamService.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID());
}

function errorResponse(req,res,error) {
  return res.status(Number(error?.status || 500)).json({
    error:{
      code:error?.code || "container_team_internal_error",
      message:Number(error?.status || 500) >= 500 ? "Container team operation failed." : error.message,
      details:Array.isArray(error?.details) ? error.details : [],
      requestId:requestId(req)
    },
    secretsIncluded:false
  });
}

function createRequireUserJwt() {
  const requireCanonicalUserJwt = createUserJwtMiddleware();
  return function withCanonicalUserJwt(req,res,next) {
    return requireCanonicalUserJwt(req,res,() => {
      req.containerTeamPrincipal={
        userId:String(req.auth.user_id),
        tenantId:req.auth.tenant_id ? String(req.auth.tenant_id) : null,
      };
      return next();
    });
  };
}

const requireUserJwt = createRequireUserJwt();

function assertAllowedKeys(value,allowed,location="body") {
  const unknown=Object.keys(value || {}).filter(key => !allowed.has(key));
  if(unknown.length) {
    const error=new Error(`${location} contains unsupported fields.`);
    error.status=400;
    error.code="validation_error";
    error.details=unknown.map(field => ({ field,issue:"unsupported",location }));
    throw error;
  }
}

function teamContext(req,containerType,paramName) {
  return {
    principalId:req.containerTeamPrincipal.userId,
    containerType,
    containerRef:String(req.params[paramName] || "")
  };
}

function memberInput(req,containerType,paramName,{ includePathUser=false }={}) {
  const allowed=includePathUser
    ? new Set(["role","roleTemplateKey","inheritanceMode","validUntil","metadata"])
    : new Set(["userId","email","role","roleTemplateKey","inheritanceMode","validUntil","metadata"]);
  assertAllowedKeys(req.body,allowed);
  return {
    containerType,
    containerRef:String(req.params[paramName] || ""),
    userId:includePathUser ? String(req.params.userId || "") : req.body?.userId,
    email:includePathUser ? undefined : req.body?.email,
    role:req.body?.role,
    roleTemplateKey:req.body?.roleTemplateKey,
    inheritanceMode:req.body?.inheritanceMode,
    validUntil:req.body?.validUntil,
    metadata:req.body?.metadata
  };
}

function registerTeamRoutes(router,{ prefix,containerType,paramName }) {
  router.get(`${prefix}/team`,requireUserJwt,async (req,res) => {
    try {
      assertAllowedKeys(req.query,new Set(["limit","cursor"]),"query");
      return res.json(await listContainerTeam({
        ...teamContext(req,containerType,paramName),
        limit:req.query.limit,
        cursor:req.query.cursor
      }));
    } catch(error) { return errorResponse(req,res,error); }
  });

  router.post(`${prefix}/team/members`,requireUserJwt,async (req,res) => {
    try {
      const result=await setContainerTeamMember(
        memberInput(req,containerType,paramName),
        {
          actorUserId:req.containerTeamPrincipal.userId,
          idempotencyKey:req.headers["idempotency-key"],
          ifMatch:req.headers["if-match"],
          requireIdempotency:true
        }
      );
      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch(error) { return errorResponse(req,res,error); }
  });

  router.patch(`${prefix}/team/members/:userId`,requireUserJwt,async (req,res) => {
    try {
      const result=await setContainerTeamMember(
        memberInput(req,containerType,paramName,{ includePathUser:true }),
        {
          actorUserId:req.containerTeamPrincipal.userId,
          idempotencyKey:req.headers["idempotency-key"],
          ifMatch:req.headers["if-match"],
          requireIdempotency:false,
          partial:true
        }
      );
      return res.json(result);
    } catch(error) { return errorResponse(req,res,error); }
  });

  router.delete(`${prefix}/team/members/:userId`,requireUserJwt,async (req,res) => {
    try {
      assertAllowedKeys(req.query,new Set([]),"query");
      assertAllowedKeys(req.body,new Set([]));
      const result=await removeContainerTeamMember(
        {
          containerType,
          containerRef:String(req.params[paramName] || ""),
          userId:String(req.params.userId || "")
        },
        { actorUserId:req.containerTeamPrincipal.userId,ifMatch:req.headers["if-match"] }
      );
      return res.json(result);
    } catch(error) { return errorResponse(req,res,error); }
  });
}

export function buildDynamicContainerTeamRoutes() {
  const router=Router();

  router.get("/me/co-workspaces",requireUserJwt,async (req,res) => {
    try {
      assertAllowedKeys(req.query,new Set(["limit","cursor"]),"query");
      const result=await listCoWorkspaces({
        principalId:req.containerTeamPrincipal.userId,
        limit:req.query.limit,
        cursor:req.query.cursor
      });
      return res.json(result);
    } catch(error) { return errorResponse(req,res,error); }
  });

  registerTeamRoutes(router,{ prefix:"/me/workspaces/:workspaceId",containerType:"workspace",paramName:"workspaceId" });
  registerTeamRoutes(router,{ prefix:"/me/brands/:brandRef",containerType:"brand",paramName:"brandRef" });

  return router;
}

export const _testingDynamicContainerTeamRoutes={
  requireUserJwt,assertAllowedKeys,teamContext,memberInput,errorResponse
};
