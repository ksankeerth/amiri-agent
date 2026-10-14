-- 0007 was not enough: Postgres can run a NO ACTION check before another cascade of the
-- same statement has removed the linking rows. These links are checked at commit instead:
-- deleting a whole institution works, deleting an item still in use is still refused
-- (by the API's in_use check, and by this constraint at commit).

ALTER TABLE core.product_segments ALTER CONSTRAINT product_segments_institution_id_segment_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE core.flow_segments ALTER CONSTRAINT flow_segments_institution_id_segment_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE core.exposure_segments ALTER CONSTRAINT exposure_segments_institution_id_segment_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE core.exposure_products ALTER CONSTRAINT exposure_products_institution_id_product_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE core.exposure_flows ALTER CONSTRAINT exposure_flows_institution_id_flow_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE core.exposure_watch_places ALTER CONSTRAINT exposure_watch_places_institution_id_watch_place_id_fkey DEFERRABLE INITIALLY DEFERRED;
