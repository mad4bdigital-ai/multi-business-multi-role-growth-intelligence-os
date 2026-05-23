-- Sprint 62u: keep GPT turn SQL rows metadata/preview-only.
-- Full turn text belongs in Drive doc/JSONL archives, not gpt_session_turns.content.

ALTER TABLE `gpt_session_turns`
  MODIFY COLUMN `content` TEXT NULL,
  MODIFY COLUMN `storage_mode` ENUM('drive','preview_only','hybrid','inline') NOT NULL DEFAULT 'drive';

-- Preserve a bounded preview before clearing legacy content values.
UPDATE `gpt_session_turns`
   SET `content_preview` = COALESCE(NULLIF(`content_preview`, ''), LEFT(`content`, 512))
 WHERE (`content_preview` IS NULL OR `content_preview` = '')
   AND `content` IS NOT NULL
   AND `content` <> '';

-- Drive and hybrid rows have full-fidelity content in Drive; SQL should keep only metadata and preview.
UPDATE `gpt_session_turns`
   SET `content` = NULL
 WHERE `storage_mode` IN ('drive', 'hybrid', 'preview_only')
   AND `content` IS NOT NULL;

-- Legacy inline rows are converted to preview_only after preserving content_preview above.
UPDATE `gpt_session_turns`
   SET `storage_mode` = 'preview_only',
       `content` = NULL
 WHERE `storage_mode` = 'inline';
