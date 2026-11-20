/** Supabase browser authentication and per-user conversation backup. No service-role keys. */
const URL = 'https://uwchgiomkbxltfbvdfeh.supabase.co';
const KEY = 'sb_publishable_wdo1PZUucOIcH42QohAuDw_3erHSCc-';
const TOKEN_KEY = 'astradoc-auth';
const VERIFIER_KEY = 'astradoc-pkce-verifier';
export interface AuthUser { id: string; email?: string }
interface AuthSession { access_token: string; refresh_token: string; expires_at: number; user: AuthUser }
const enc = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random = () => enc(crypto.getRandomValues(new Uint8Array(32)));
function save(session: AuthSession | null) { if(session) sessionStorage.setItem(TOKEN_KEY,JSON.stringify(session)); else sessionStorage.removeItem(TOKEN_KEY); }
function read(): AuthSession | null { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null') as AuthSession | null; } catch { return null; } }
async function request(path: string, init: RequestInit = {}, token?: string) {
 const res = await fetch(URL + path,{...init,headers:{apikey:KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...init.headers}});
 if(!res.ok) throw new Error((await res.json().catch(()=>({}))).msg || 'Supabase request failed ('+res.status+')');
 return res.status===204 ? null : res.json();
}
export async function startGoogleLogin() {
 const verifier=random();sessionStorage.setItem(VERIFIER_KEY,verifier);
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const params=new URLSearchParams({provider:'google',redirect_to:location.origin+location.pathname,code_challenge:enc(hash),code_challenge_method:'s256'});
 location.assign(URL+'/auth/v1/authorize?'+params.toString());
}
export async function currentAuth(): Promise<AuthSession | null> {
 const params=new URLSearchParams(location.search),code=params.get('code');
 if(code) {
   const verifier=sessionStorage.getItem(VERIFIER_KEY);
   if(!verifier) throw new Error('Sign-in session expired. Please try again.');
   const data=await request('/auth/v1/token?grant_type=pkce',{method:'POST',body:JSON.stringify({auth_code:code,code_verifier:verifier})});
   const session:AuthSession={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+data.expires_in*1000,user:data.user};
   save(session);sessionStorage.removeItem(VERIFIER_KEY);
   history.replaceState({},'',location.pathname+location.hash);return session;
 }
 let session=read();if(!session)return null;
 if(session.expires_at>Date.now()+60000)return session;
 try {
   const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});
   session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+data.expires_in*1000,user:data.user};save(session);return session;
 } catch {save(null);return null;}
}
export function signOut(){save(null);}
export async function saveConversation(userId:string,threadId:string|null,items:Array<{question:string;answer:string;sources:unknown;mode:string|null}>) {
 const session=await currentAuth();if(!session||session.user.id!==userId||!items.length)return threadId;
 const headers={Prefer:'return=representation'};
 let id=threadId;
 if(!id){
   const data=await request('/rest/v1/chat_threads',{method:'POST',headers,body:JSON.stringify({user_id:userId,title:items[0].question.slice(0,100)})},session.access_token);
   id=data[0].id as string;
 }
 // Replace the conversation snapshot atomically from the UI's perspective; RLS enforces ownership.
 await request('/rest/v1/chat_messages?thread_id=eq.'+encodeURIComponent(id),{method:'DELETE'},session.access_token);
 const records=items.flatMap(item=>[{thread_id:id,user_id:userId,role:'user',content:item.question},{thread_id:id,user_id:userId,role:'assistant',content:item.answer,sources:item.sources??[]}]);
 await request('/rest/v1/chat_messages',{method:'POST',body:JSON.stringify(records)},session.access_token);
 await request('/rest/v1/chat_threads?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({updated_at:new Date().toISOString()})},session.access_token);
 return id;
}
export async function loadConversations(userId:string){
 const session=await currentAuth();if(!session||session.user.id!==userId)return [];
 return request('/rest/v1/chat_threads?user_id=eq.'+encodeURIComponent(userId)+'&select=id,title,updated_at&order=updated_at.desc&limit=30',{},session.access_token) as Promise<Array<{id:string;title:string;updated_at:string}>>;
}
export async function loadConversation(userId:string,threadId:string){
 const session=await currentAuth();if(!session||session.user.id!==userId)return [];
 return request('/rest/v1/chat_messages?thread_id=eq.'+encodeURIComponent(threadId)+'&select=role,content,sources&order=created_at.asc',{},session.access_token) as Promise<Array<{role:'user'|'assistant';content:string;sources:any[]}>>;
}
