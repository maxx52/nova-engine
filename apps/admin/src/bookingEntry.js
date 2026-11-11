import {createApp} from 'vue'
import BookingWorkspace from './BookingWorkspace.vue'

// The host provides its authenticated API adapter and the current NOVA role.
export function mountBooking(element,{apiWrite,userRole}){
 if(!element||typeof apiWrite!=='function'||typeof userRole!=='string')throw Error('Invalid Booking host context')
 const app=createApp(BookingWorkspace,{apiWrite,userRole})
 app.mount(element)
 return ()=>app.unmount()
}
