import {releaseVersion} from './releases.js'
// A version embedded in the loaded bundle must describe that bundle, even when
// the server has already changed. Refresh only after the updater finishes.
export function adminVersionMismatch(browserVersion,runtimeVersion){
 return !!releaseVersion(browserVersion)&&!!releaseVersion(runtimeVersion)&&browserVersion!==runtimeVersion
}
export function canRefreshAdmin(browserVersion,status,attemptedVersion){
 if(!status||status.active||!adminVersionMismatch(browserVersion,status.current_version))return false
 if(status.installed_version&&status.installed_version!==status.current_version)return false
 return attemptedVersion!==status.current_version
}
export function adminRefreshUrl(href,version){
 if(!releaseVersion(version))throw Error('Invalid admin version')
 const url=new URL(href);url.searchParams.set('nova_version',version);return url.href
}
