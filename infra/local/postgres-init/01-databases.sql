-- Runs once, when the amiri-pgdata volume is first created.
-- amiri: the development database. amiri_test: wiped and rebuilt by the server's tests.
CREATE DATABASE amiri_test;
\connect amiri
CREATE EXTENSION IF NOT EXISTS vector;
\connect amiri_test
CREATE EXTENSION IF NOT EXISTS vector;
