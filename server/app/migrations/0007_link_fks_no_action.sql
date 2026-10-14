-- Links between items were ON DELETE RESTRICT, which Postgres checks before a cascade has
-- removed the linking rows: deleting a whole institution (still in setup) failed. NO ACTION
-- still refuses deleting an item that is in use, but checks at the end of the statement.

ALTER TABLE core.product_segments DROP CONSTRAINT product_segments_institution_id_segment_id_fkey;
ALTER TABLE core.product_segments ADD CONSTRAINT product_segments_institution_id_segment_id_fkey FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE NO ACTION;
ALTER TABLE core.flow_segments DROP CONSTRAINT flow_segments_institution_id_segment_id_fkey;
ALTER TABLE core.flow_segments ADD CONSTRAINT flow_segments_institution_id_segment_id_fkey FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE NO ACTION;
ALTER TABLE core.exposure_segments DROP CONSTRAINT exposure_segments_institution_id_segment_id_fkey;
ALTER TABLE core.exposure_segments ADD CONSTRAINT exposure_segments_institution_id_segment_id_fkey FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE NO ACTION;
ALTER TABLE core.exposure_products DROP CONSTRAINT exposure_products_institution_id_product_id_fkey;
ALTER TABLE core.exposure_products ADD CONSTRAINT exposure_products_institution_id_product_id_fkey FOREIGN KEY (institution_id, product_id) REFERENCES core.products ON DELETE NO ACTION;
ALTER TABLE core.exposure_flows DROP CONSTRAINT exposure_flows_institution_id_flow_id_fkey;
ALTER TABLE core.exposure_flows ADD CONSTRAINT exposure_flows_institution_id_flow_id_fkey FOREIGN KEY (institution_id, flow_id) REFERENCES core.flows ON DELETE NO ACTION;
ALTER TABLE core.exposure_watch_places DROP CONSTRAINT exposure_watch_places_institution_id_watch_place_id_fkey;
ALTER TABLE core.exposure_watch_places ADD CONSTRAINT exposure_watch_places_institution_id_watch_place_id_fkey FOREIGN KEY (institution_id, watch_place_id) REFERENCES core.watch_places ON DELETE NO ACTION;
