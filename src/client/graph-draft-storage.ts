import {randomUUID} from './random-uuid';
const databaseName='pm-editor-drafts-v1';
let opened:Promise<IDBDatabase>|undefined;
function database(){return opened||=(new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(databaseName,1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opened=undefined;reject(request.error);};
}));}
export async function readDraftRecord<T>(key:string):Promise<T|undefined>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function writeDraftRecord(key:string,value:unknown){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');if(value===undefined)tx.objectStore('drafts').delete(key);else tx.objectStore('drafts').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本机存储已中断'));});}
const recordSignal=(key:string)=>key+':changed';
export async function writeSharedDraftRecord(key:string,value:unknown){await writeDraftRecord(key,value);try{localStorage.setItem(recordSignal(key),randomUUID());}catch{/* The IndexedDB record remains authoritative. */}}
export function watchDraftRecord(key:string,listener:()=>void){const signal=recordSignal(key),receive=(event:StorageEvent)=>{if(event.key===signal)listener();};window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);}
export async function clearDraftRecords(prefix:string){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(String(cursor.key).startsWith(prefix))cursor.delete();cursor.continue();};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export const editorTabId=randomUUID();
const leaseKey=(key:string)=>'pm-editor-lease:'+key;
export function ownsDraft(key:string,claim=false){try{const old=JSON.parse(localStorage.getItem(leaseKey(key))||'null') as {owner:string;expires:number}|null;if(old&&old.owner!==editorTabId&&old.expires>Date.now())return false;if(claim)localStorage.setItem(leaseKey(key),JSON.stringify({owner:editorTabId,expires:Date.now()+45000}));return true;}catch{return false;}}
export function takeDraft(key:string){localStorage.setItem(leaseKey(key),JSON.stringify({owner:editorTabId,expires:Date.now()+45000}));}
export function releaseDraft(key:string){try{if(ownsDraft(key))localStorage.removeItem(leaseKey(key));}catch{/* A stored lease expires after an interrupted tab. */}}
