-- Context Kernel connection ownership backfill.
-- Safety: workspace ownership is personal/company only; brand scope is never inferred;
-- only unique workspace mappings are persisted; legacy provider identity is never invented;
-- all backfilled connection ownership rows remain unclassified until governed reconnect.

UPDATE `workspace_registry` AS `wr`
JOIN (
  SELECT
    `source_workspace`.`workspace_id`,
    CASE
      WHEN `source_workspace`.`linked_brand_key` IS NOT NULL
        OR `source_workspace`.`workspace_type` = 'brand'
        OR COALESCE(`membership_stats`.`active_members`, 0) > 1
        OR COALESCE(`grant_stats`.`active_grantees`, 0) > 1
        THEN 'company'
      WHEN COALESCE(`source_workspace`.`workspace_type`, '') <> 'brand'
        AND `source_workspace`.`linked_brand_key` IS NULL
        AND COALESCE(`membership_stats`.`active_members`, 0) = 1
        AND COALESCE(`membership_stats`.`active_owner_members`, 0) = 1
        AND COALESCE(`grant_stats`.`active_grantees`, 0) <= 1
        AND (`grant_stats`.`sole_grantee_candidate` IS NULL
          OR BINARY `grant_stats`.`sole_grantee_candidate` = BINARY `membership_stats`.`sole_owner_candidate`)
        THEN 'personal'
      ELSE NULL
    END AS `proposed_ownership_type`,
    CASE
      WHEN COALESCE(`source_workspace`.`workspace_type`, '') <> 'brand'
        AND `source_workspace`.`linked_brand_key` IS NULL
        AND COALESCE(`membership_stats`.`active_members`, 0) = 1
        AND COALESCE(`membership_stats`.`active_owner_members`, 0) = 1
        AND COALESCE(`grant_stats`.`active_grantees`, 0) <= 1
        AND (`grant_stats`.`sole_grantee_candidate` IS NULL
          OR BINARY `grant_stats`.`sole_grantee_candidate` = BINARY `membership_stats`.`sole_owner_candidate`)
        THEN `membership_stats`.`sole_owner_candidate`
      ELSE NULL
    END AS `proposed_owner_user_id`
  FROM `workspace_registry` AS `source_workspace`
  LEFT JOIN (
    SELECT `tenant_id`,
      COUNT(DISTINCT CASE WHEN `status`='active' THEN `user_id` END) AS `active_members`,
      COUNT(DISTINCT CASE WHEN `status`='active' AND `role`='owner' THEN `user_id` END) AS `active_owner_members`,
      MIN(CASE WHEN `status`='active' AND `role`='owner' THEN `user_id` END) AS `sole_owner_candidate`
    FROM `memberships` GROUP BY `tenant_id`
  ) AS `membership_stats`
    ON BINARY `membership_stats`.`tenant_id` = BINARY `source_workspace`.`tenant_id`
  LEFT JOIN (
    SELECT `grant_workspace`.`workspace_id`, `grant_workspace`.`tenant_id`,
      COUNT(DISTINCT CASE WHEN `workspace_grant`.`status`='active'
        AND `workspace_grant`.`resource_type`='workspace'
        AND (BINARY `workspace_grant`.`resource_ref` = BINARY `grant_workspace`.`workspace_id`
          OR BINARY `workspace_grant`.`resource_ref` = BINARY `grant_workspace`.`tenant_id`)
        THEN `workspace_grant`.`grantee_user_id` END) AS `active_grantees`,
      MIN(CASE WHEN `workspace_grant`.`status`='active'
        AND `workspace_grant`.`resource_type`='workspace'
        AND (BINARY `workspace_grant`.`resource_ref` = BINARY `grant_workspace`.`workspace_id`
          OR BINARY `workspace_grant`.`resource_ref` = BINARY `grant_workspace`.`tenant_id`)
        THEN `workspace_grant`.`grantee_user_id` END) AS `sole_grantee_candidate`
    FROM `workspace_registry` AS `grant_workspace`
    LEFT JOIN `workspace_resource_grants` AS `workspace_grant`
      ON BINARY `workspace_grant`.`tenant_id` = BINARY `grant_workspace`.`tenant_id`
    GROUP BY `grant_workspace`.`workspace_id`, `grant_workspace`.`tenant_id`
  ) AS `grant_stats`
    ON BINARY `grant_stats`.`workspace_id` = BINARY `source_workspace`.`workspace_id`
) AS `proposed`
  ON BINARY `proposed`.`workspace_id` = BINARY `wr`.`workspace_id`
SET `wr`.`workspace_ownership_type` = `proposed`.`proposed_ownership_type`,
    `wr`.`owner_user_id` = `proposed`.`proposed_owner_user_id`,
    `wr`.`ownership_revision` = COALESCE(`wr`.`ownership_revision`,0) + 1
WHERE `wr`.`workspace_ownership_type` IS NULL
  AND `proposed`.`proposed_ownership_type` IN ('personal','company');

INSERT INTO `connection_ownership_scopes` (
  `ownership_id`,`connection_id`,`tenant_id`,`workspace_id`,`brand_id`,
  `owner_scope_type`,`owner_scope_ref`,`owner_user_id`,`connected_by_user_id`,
  `provider_key`,`provider_account_ref`,`provider_account_binding_hash`,
  `provider_account_binding_version`,`authorization_revision`,`connection_revision`,`status`
)
SELECT UUID(), `legacy_connection`.`connection_id`, `legacy_connection`.`tenant_id`, `resolved`.`workspace_id`, NULL,
  CASE WHEN `resolved_workspace`.`workspace_ownership_type`='personal' THEN 'personal_workspace' ELSE 'company_workspace' END,
  `resolved`.`workspace_id`,
  CASE WHEN `resolved_workspace`.`workspace_ownership_type`='personal' THEN `resolved_workspace`.`owner_user_id` ELSE NULL END,
  `legacy_connection`.`user_id`, `legacy_connection`.`app_key`, NULL, NULL, NULL, 1, 1, 'unclassified'
FROM `user_app_connections` AS `legacy_connection`
JOIN (
  SELECT `candidate`.`connection_id`, MIN(`candidate`.`workspace_id`) AS `workspace_id`
  FROM (
    SELECT DISTINCT `connection_candidate`.`connection_id`, `workspace_candidate`.`workspace_id`
    FROM `user_app_connections` AS `connection_candidate`
    JOIN `workspace_registry` AS `workspace_candidate`
      ON BINARY `workspace_candidate`.`tenant_id` = BINARY `connection_candidate`.`tenant_id`
      AND `workspace_candidate`.`workspace_ownership_type` IN ('personal','company')
    LEFT JOIN `workspace_app_links` AS `explicit_link`
      ON BINARY `explicit_link`.`connection_id` = BINARY `connection_candidate`.`connection_id`
      AND BINARY `explicit_link`.`workspace_id` = BINARY `workspace_candidate`.`workspace_id`
      AND `explicit_link`.`status`='active'
    WHERE `explicit_link`.`connection_id` IS NOT NULL
      OR (`workspace_candidate`.`workspace_ownership_type`='personal'
          AND BINARY `workspace_candidate`.`owner_user_id` = BINARY `connection_candidate`.`user_id`)
      OR (`workspace_candidate`.`workspace_ownership_type`='company' AND EXISTS (
        SELECT 1 FROM `workspace_resource_grants` AS `company_grant`
        WHERE BINARY `company_grant`.`tenant_id` = BINARY `connection_candidate`.`tenant_id`
          AND BINARY `company_grant`.`grantee_user_id` = BINARY `connection_candidate`.`user_id`
          AND `company_grant`.`resource_type`='workspace' AND `company_grant`.`status`='active'
          AND (BINARY `company_grant`.`resource_ref` = BINARY `workspace_candidate`.`workspace_id`
            OR BINARY `company_grant`.`resource_ref` = BINARY `workspace_candidate`.`tenant_id`)
      ))
  ) AS `candidate`
  GROUP BY `candidate`.`connection_id`
  HAVING COUNT(DISTINCT `candidate`.`workspace_id`) = 1
) AS `resolved`
  ON BINARY `resolved`.`connection_id` = BINARY `legacy_connection`.`connection_id`
JOIN `workspace_registry` AS `resolved_workspace`
  ON BINARY `resolved_workspace`.`workspace_id` = BINARY `resolved`.`workspace_id`
  AND BINARY `resolved_workspace`.`tenant_id` = BINARY `legacy_connection`.`tenant_id`
  AND `resolved_workspace`.`workspace_ownership_type` IN ('personal','company')
WHERE NOT EXISTS (
  SELECT 1 FROM `connection_ownership_scopes` AS `existing_ownership`
  WHERE BINARY `existing_ownership`.`connection_id` = BINARY `legacy_connection`.`connection_id`
);
