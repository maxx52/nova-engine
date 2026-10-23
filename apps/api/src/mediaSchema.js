export async function initMediaSchema(source){
 const pool=await source.connect()
 try{
 await pool.query('BEGIN')
 await pool.query(`CREATE TABLE IF NOT EXISTS media_files (
  url TEXT PRIMARY KEY, original_name VARCHAR(200) NOT NULL,size BIGINT NOT NULL CHECK(size>=0),
  mime VARCHAR(40) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),deleted_at TIMESTAMPTZ
 )`)
 await pool.query(`CREATE OR REPLACE FUNCTION nova_media_path(candidate TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT split_part(split_part(regexp_replace(candidate,'^https?://[^/]+','','i'),'?',1),'#',1)
 $$`)
 await pool.query(`CREATE OR REPLACE FUNCTION nova_media_check(candidate TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
 DECLARE removed TIMESTAMPTZ; path TEXT;
 BEGIN
  path:=nova_media_path(candidate);
  IF path IS NULL OR path NOT LIKE '/uploads/%' THEN RETURN; END IF;
  SELECT deleted_at INTO removed FROM media_files WHERE url=path FOR SHARE;
  IF NOT FOUND OR removed IS NOT NULL THEN RAISE EXCEPTION 'Изображение удалено или отсутствует. Выберите другой файл.' USING ERRCODE='23514',CONSTRAINT='nova_media_available'; END IF;
 END $$`)
 await pool.query(`CREATE OR REPLACE FUNCTION nova_media_references() RETURNS TRIGGER LANGUAGE plpgsql AS $$
 DECLARE item JSONB; path TEXT;
 BEGIN
  IF TG_TABLE_NAME='products' THEN
   PERFORM nova_media_check(NEW.image_url);
   FOR path IN SELECT jsonb_array_elements_text(NEW.images) LOOP PERFORM nova_media_check(path); END LOOP;
  ELSIF TG_TABLE_NAME='pages' THEN
   FOR item IN SELECT jsonb_array_elements(NEW.sections) LOOP PERFORM nova_media_check(item->>'image_url'); PERFORM nova_media_check(item->>'button_url'); END LOOP;
   FOR path IN SELECT (regexp_matches(NEW.sections::text,'(/uploads/[a-f0-9-]{36}\\.(?:png|jpg|webp))','g'))[1] LOOP PERFORM nova_media_check(path); END LOOP;
  ELSIF TG_TABLE_NAME='site_design' THEN
   PERFORM nova_media_check(NEW.draft->>'hero_image_url'); PERFORM nova_media_check(NEW.published->>'hero_image_url');
   FOR path IN SELECT (regexp_matches((NEW.draft::text || NEW.published::text),'(/uploads/[a-f0-9-]{36}\\.(?:png|jpg|webp))','g'))[1] LOOP PERFORM nova_media_check(path); END LOOP;
  ELSIF TG_TABLE_NAME='posts' THEN PERFORM nova_media_check(NEW.cover_url);
  ELSIF TG_TABLE_NAME='site_settings' THEN
   PERFORM nova_media_check(NEW.logo_url);
   FOR item IN SELECT jsonb_array_elements(NEW.menu) LOOP PERFORM nova_media_check(item->>'url'); END LOOP;
  END IF;
  IF TG_TABLE_NAME IN ('pages','products','posts') THEN PERFORM nova_media_check(NEW.seo->>'image_url'); END IF;
  IF TG_TABLE_NAME='seo_settings' THEN
   PERFORM nova_media_check(NEW.config->'home'->>'image_url'); PERFORM nova_media_check(NEW.config->'catalog'->>'image_url'); PERFORM nova_media_check(NEW.config->'blog'->>'image_url');
  END IF;
  RETURN NEW;
 END $$`)
 for(const [table,columns]of [['products','image_url,images,seo'],['pages','sections,seo'],['posts','cover_url,seo'],['seo_settings','config'],['site_settings','logo_url,menu'],['site_design','draft,published']]){
  await pool.query(`DROP TRIGGER IF EXISTS nova_media_refs ON ${table}`)
  await pool.query(`CREATE TRIGGER nova_media_refs BEFORE INSERT OR UPDATE OF ${columns} ON ${table} FOR EACH ROW EXECUTE FUNCTION nova_media_references()`)
 }
 await pool.query('COMMIT')
 }catch(e){await pool.query('ROLLBACK');throw e}finally{pool.release()}
}
