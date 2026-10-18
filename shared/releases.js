export const RELEASE_REPOSITORY='maxx52/nova-engine'
export const RELEASES_URL='https://github.com/'+RELEASE_REPOSITORY+'/releases'
export function releaseVersion(value){return typeof value==='string'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)}
export function compareVersions(a,b){if(!releaseVersion(a)||!releaseVersion(b))throw Error('Некорректная версия');const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0}
export function publicRelease(row){
 const version=typeof row?.tag_name==='string'?row.tag_name.replace(/^v/,''):''
 if(!releaseVersion(version)||row.tag_name!=='v'+version||row.draft||row.prerelease||row.html_url!==RELEASES_URL+'/tag/v'+version)return null
 return {version,title:String(row.name||row.tag_name).slice(0,200),notes:String(row.body||'').slice(0,8000),url:row.html_url,published_at:typeof row.published_at==='string'?row.published_at:null}
}
