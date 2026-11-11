// Booking & CRM foundation. Data is always scoped through an explicit membership.
export async function migrateBooking(pool) {
 const db=await pool.connect()
 try {
  await db.query('BEGIN')
  await db.query("SELECT pg_advisory_xact_lock(hashtext('nova.booking.migrations'))")
  await db.query('CREATE TABLE IF NOT EXISTS nova_booking_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
  const done=await db.query('SELECT version FROM nova_booking_migrations WHERE version=1')
  if(!done.rows.length){
   await db.query(`CREATE TABLE nova_booking_organizations (id BIGSERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL CHECK(length(trim(name))>0), profile TEXT NOT NULL CHECK(profile IN ('universal','dentistry','beauty','automotive')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
   await db.query(`CREATE TABLE nova_booking_memberships (organization_id BIGINT NOT NULL REFERENCES nova_booking_organizations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','manager','viewer')), PRIMARY KEY(organization_id,user_id))`)
   await db.query('CREATE INDEX nova_booking_memberships_user_idx ON nova_booking_memberships(user_id,organization_id)')
   await db.query(`CREATE TABLE nova_booking_branches (id BIGSERIAL PRIMARY KEY, organization_id BIGINT NOT NULL REFERENCES nova_booking_organizations(id) ON DELETE CASCADE, name VARCHAR(150) NOT NULL CHECK(length(trim(name))>0), timezone VARCHAR(80) NOT NULL, address VARCHAR(300) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(organization_id,id))`)
   await db.query('CREATE INDEX nova_booking_branches_org_idx ON nova_booking_branches(organization_id,id)')
   await db.query('INSERT INTO nova_booking_migrations(version) VALUES(1)')
  }
  await db.query('COMMIT')
 } catch(e) { await db.query('ROLLBACK'); throw e } finally { db.release() }
}
const id=v=>typeof v==='string'&&/^[1-9]\d{0,17}$/.test(v)
const name=v=>typeof v==='string'&&v.trim().length>0&&v.length<=150
const zone=v=>{if(typeof v!=='string'||v.length>80)return false;try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}}
const profiles=['universal','dentistry','beauty','automotive']
export function registerBooking(app,pool,requireAdmin){
 const options={preHandler:requireAdmin,bodyLimit:4096}
 async function access(req,reply,roles){
  if(!id(req.params.orgId)){reply.code(400).send({error:'Неверный идентификатор организации'});return false}
  const m=await pool.query('SELECT role FROM nova_booking_memberships WHERE organization_id=$1 AND user_id=$2',[req.params.orgId,req.novaSession.user_id])
  if(!m.rows.length||roles&&!roles.includes(m.rows[0].role)){reply.code(404).send({error:'Организация не найдена или доступ запрещён'});return false}
  return true
 }
 app.get('/api/admin/booking/organizations',options,async req=>({organizations:(await pool.query(`SELECT o.id::text,o.name,o.profile,m.role FROM nova_booking_organizations o JOIN nova_booking_memberships m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.id LIMIT 100`,[req.novaSession.user_id])).rows}))
 app.post('/api/admin/booking/organizations',options,async(req,reply)=>{
  if(req.novaSession.role!=='owner')return reply.code(403).send({error:'Создавать организации может только владелец NOVA'})
  const {name:label,profile='universal'}=req.body||{}
  if(!name(label)||!profiles.includes(profile))return reply.code(400).send({error:'Проверьте название и профиль'})
  const db=await pool.connect();try{await db.query('BEGIN');const org=(await db.query('INSERT INTO nova_booking_organizations(name,profile) VALUES($1,$2) RETURNING id::text,name,profile',[label.trim(),profile])).rows[0];await db.query("INSERT INTO nova_booking_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[org.id,req.novaSession.user_id]);await db.query('COMMIT');req.novaAuditAction='booking.organization.create';return reply.code(201).send(org)}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 })
 app.get('/api/admin/booking/organizations/:orgId/branches',options,async(req,reply)=>{if(!await access(req,reply))return;return {branches:(await pool.query('SELECT id::text,name,timezone,address FROM nova_booking_branches WHERE organization_id=$1 ORDER BY id LIMIT 100',[req.params.orgId])).rows}})
 app.post('/api/admin/booking/organizations/:orgId/branches',options,async(req,reply)=>{
  if(!await access(req,reply,['owner','manager']))return
  const {name:label,timezone,address=''}=req.body||{}
  if(!name(label)||!zone(timezone)||typeof address!=='string'||address.length>300)return reply.code(400).send({error:'Проверьте название, адрес и часовой пояс IANA'})
  const r=await pool.query('INSERT INTO nova_booking_branches(organization_id,name,timezone,address) VALUES($1,$2,$3,$4) RETURNING id::text,name,timezone,address',[req.params.orgId,label.trim(),timezone,address.trim()]);req.novaAuditAction='booking.branch.create';return reply.code(201).send(r.rows[0])
 })
 app.get('/api/admin/booking/organizations/:orgId/members',options,async(req,reply)=>{if(!await access(req,reply,['owner']))return;return {members:(await pool.query('SELECT a.id::text,a.username,m.role FROM nova_booking_memberships m JOIN admin_accounts a ON a.id=m.user_id WHERE m.organization_id=$1 ORDER BY a.id LIMIT 100',[req.params.orgId])).rows}})
 app.post('/api/admin/booking/organizations/:orgId/members',options,async(req,reply)=>{
  if(!await access(req,reply,['owner']))return
  const {user_id,role}=req.body||{}
  if(!id(user_id)||!['manager','viewer'].includes(role))return reply.code(400).send({error:'Проверьте пользователя и роль'})
  // Do not elevate users who cannot pass NOVA's own role gate.
  const u=await pool.query("SELECT id FROM admin_accounts WHERE id=$1 AND enabled=TRUE AND role IN ('owner','admin','manager')",[user_id])
  if(!u.rowCount)return reply.code(404).send({error:'Доступная учётная запись не найдена'})
  const r=await pool.query("INSERT INTO nova_booking_memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role WHERE nova_booking_memberships.role<>'owner' RETURNING user_id",[req.params.orgId,user_id,role])
  if(!r.rowCount)return reply.code(409).send({error:'Роль владельца изменить нельзя'})
  req.novaAuditAction='booking.membership.save';return {ok:true}
 })
}
