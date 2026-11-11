import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {stageBookingPackage} from '../apps/api/src/booking/package/stage.js'
const [source,store,key,...extra]=process.argv.slice(2)
if(!source||!store||!key||extra.length){console.error('Usage: node scripts/booking-stage.mjs PACKAGE_DIR STAGING_DIR TRUSTED_PUBLIC_KEY');process.exit(2)}
try{console.log(JSON.stringify(await stageBookingPackage({source:resolve(source),store:resolve(store),publicKey:await readFile(resolve(key))})))}catch(e){console.error('Booking staging failed:',e.message);process.exitCode=1}
