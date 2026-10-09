-- Rule 9.6 / 0.6: Transcript and MinutesOfMeeting text is immutable (insert-only).
CREATE OR REPLACE FUNCTION block_text_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Deleting % rows is not allowed', TG_TABLE_NAME; END IF;
  IF NEW.text IS DISTINCT FROM OLD.text THEN RAISE EXCEPTION 'Editing % text is not allowed', TG_TABLE_NAME; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS transcript_immutable ON "Transcript";
CREATE TRIGGER transcript_immutable BEFORE UPDATE OR DELETE ON "Transcript" FOR EACH ROW EXECUTE FUNCTION block_text_mutation();
DROP TRIGGER IF EXISTS mom_immutable ON "MinutesOfMeeting";
CREATE TRIGGER mom_immutable BEFORE UPDATE OR DELETE ON "MinutesOfMeeting" FOR EACH ROW EXECUTE FUNCTION block_text_mutation();
