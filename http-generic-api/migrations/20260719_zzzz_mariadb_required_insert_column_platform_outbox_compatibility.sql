-- DDL-only compatibility bridge for the historical 20260720 outbox event-type writer.
-- The immutable writer omits producer_key; all existing writers that set it remain unchanged.
ALTER TABLE `platform_outbox_event_types`
  MODIFY COLUMN `producer_key` VARCHAR(120) NOT NULL DEFAULT 'growth_control_plane';

