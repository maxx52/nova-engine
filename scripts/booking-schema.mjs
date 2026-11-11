// Manage the Booking database schema separately from NOVA's main migrations.
import {config} from 'dotenv'
import pg from 'pg'
import {fileURLToPath} from 'node:url'
import {migrateBooking} from '../apps/api/src/booking/index.js'
config({path:fileURLToPath(new URL('../.env',import.meta.url)),quiet:true})
const operation=process.argv[2]
if(!['status','install','upgrade'].includes(operation)){
 console.error('Usage: node scripts/booking-schema.mjs status|install|upgrade')
 process.exit(2)
}
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required');process.exit(2)}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000})
try{
 const table=await pool.query("SELECT to_regclass('public.nova_booking_migrations') AS name")
 if(operation==='upgrade'&&!table.rows[0].name)throw Error('Module schema is not installed; use install first')
 if(operation!=='status')await migrateBooking(pool)
 const exists=operation!=='status'||table.rows[0].name
 const versions=exists?(await pool.query('SELECT version FROM nova_booking_migrations ORDER BY version')).rows.map(r=>r.version):[]
 if(versions.some((v,i)=>v!==i+1)||versions.some(v=>v>1))throw Error('Booking schema history is incompatible with this module version')
 console.log(JSON.stringify({installed:versions.length>0,schema_version:versions.at(-1)||0,supported_schema_version:1,operation}))
}catch(error){console.error('Booking schema operation failed:',error.message);process.exitCode=1}
finally{await pool.end()}
