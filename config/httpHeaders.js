export function httpHeaders({development=false,https=false,asset=false}={}){
 const csp=asset?"default-src 'none'; sandbox; frame-ancestors 'none'":[
  "default-src 'self'",`script-src 'self'${development?" 'unsafe-inline'":''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",`connect-src 'self'${development?' ws: wss:':''}`,
  "object-src 'none'","base-uri 'none'","form-action 'self'","frame-ancestors 'none'"
 ].join('; ')
 return {'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()','Cross-Origin-Resource-Policy':'same-origin','X-DNS-Prefetch-Control':'off',...(https?{'Strict-Transport-Security':'max-age=31536000'}:{})}
}
