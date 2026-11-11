import {resolve} from 'node:path'
import {PRODUCT_VERSION} from '../config/release.js'
import {selectBookingVersion} from '../apps/api/src/booking/package/selection.js'
const [action,store,key,version,...extra]=process.argv.slice(2)
if(!['select','rollback'].includes(action)||!store||!key||extra.length||(action==='select'?!version:!!version)){console.error('Usage: node scripts/booking-select.mjs select STORE TRUSTED_PUBLIC_KEY VERSION | rollback STORE TRUSTED_PUBLIC_KEY');process.exit(2)}
try{console.log(JSON.stringify(await selectBookingVersion({store:resolve(store),keyPath:resolve(key),coreVersion:PRODUCT_VERSION,version,rollback:action==='rollback'})))}catch(e){console.error('Booking selection failed:',e.message);process.exitCode=1}
