-- Staging-local safety alignment: widen bounded runtime dispatch certification text domains
-- before the first migration writers whose literals exceed the historical widths.
-- Additive and non-destructive; preserves nullability and certification default semantics.

ALTER TABLE `runtime_dispatch_certification_registry`
  MODIFY COLUMN `smoke_strategy` TEXT NOT NULL,
  MODIFY COLUMN `certification_status` VARCHAR(256) NOT NULL DEFAULT 'baseline_registered';
